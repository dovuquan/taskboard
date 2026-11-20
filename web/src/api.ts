export type Me = {
  id: number;
  email: string;
  name: string | null;
  avatar_url: string | null;
  role: "admin" | "member";
};

export type MeResult =
  | { kind: "user"; user: Me }
  | { kind: "signed_out" }
  | { kind: "expired" }
  | { kind: "error" };

const INIT: RequestInit = { credentials: "same-origin" };

export async function getMe(): Promise<MeResult> {
  try {
    const res = await fetch("/api/me", INIT);
    if (res.status === 200) return { kind: "user", user: (await res.json()) as Me };
    if (res.status === 401) {
      const body: unknown = await res.json().catch(() => null);
      const detail = (body as { detail?: unknown } | null)?.detail;
      return detail === "session_expired" ? { kind: "expired" } : { kind: "signed_out" };
    }
    return { kind: "error" };
  } catch {
    return { kind: "error" };
  }
}

/** Ends the session. Never throws: the caller leaves for Sign in either way. */
export async function signOut(): Promise<void> {
  try {
    await fetch("/auth/logout", { ...INIT, method: "POST" });
  } catch {
    // Offline or refused: the cookie will expire; Sign in is still the right next screen.
  }
}

export async function getConfig(): Promise<string | null> {
  try {
    const res = await fetch("/api/config", INIT);
    if (!res.ok) return null;
    const body = (await res.json()) as { allowed_hd?: unknown };
    return typeof body.allowed_hd === "string" ? body.allowed_hd : null;
  } catch {
    return null;
  }
}

export type Role = "admin" | "member";

export type Member = {
  id: number;
  email: string;
  name: string | null;
  avatar_url: string | null;
  role: Role;
  joined_at: string | null;
  last_seen_at: string | null;
  pending: boolean;
};

export type Refusal = { at: string; email: string | null; reason: string };

type Failure = "forbidden" | "expired" | "network" | "server";
export type ListResult<T> = { kind: "ok"; data: T } | { kind: Failure };
export type RoleResult =
  | { kind: "ok"; data: Member }
  | { kind: Failure | "last_admin" | "own_role" };

async function send(url: string, init: RequestInit): Promise<{ status: number; body: unknown } | null> {
  try {
    const res = await fetch(url, init);
    const body: unknown = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch {
    return null;
  }
}

function failure(status: number): Failure {
  if (status === 401) return "expired";
  if (status === 403) return "forbidden";
  return "server";
}

async function getList<T>(url: string): Promise<ListResult<T[]>> {
  const res = await send(url, INIT);
  if (!res) return { kind: "network" };
  if (res.status === 200) {
    return Array.isArray(res.body) ? { kind: "ok", data: res.body as T[] } : { kind: "server" };
  }
  return { kind: failure(res.status) };
}

export function getMembers(): Promise<ListResult<Member[]>> {
  return getList<Member>("/api/members");
}

export function getRefused(): Promise<ListResult<Refusal[]>> {
  return getList<Refusal>("/api/auth-events/refused");
}

export async function setMemberRole(id: number, role: Role): Promise<RoleResult> {
  const res = await send(`/api/members/${id}`, {
    ...INIT,
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!res) return { kind: "network" };
  if (res.status === 200 && res.body && typeof res.body === "object") {
    return { kind: "ok", data: res.body as Member };
  }
  if (res.status === 409) {
    const detail = (res.body as { detail?: unknown } | null)?.detail;
    if (detail === "last_admin" || detail === "own_role") return { kind: detail };
  }
  return { kind: failure(res.status) };
}

export type BoardRole = "owner" | "member" | "observer";
export type Visibility = "workspace" | "private";

export type BoardPerson = {
  id: number;
  name: string | null;
  email: string;
  avatar_url: string | null;
};

/** One board on the Boards screen. `my_role` is null in the ownerless list. */
export type Tile = {
  id: number;
  name: string;
  visibility: Visibility;
  my_role: BoardRole | null;
  member_count: number;
  members: BoardPerson[];
  updated_at: string;
};

export type BoardDetail = Omit<Tile, "my_role"> & { my_role: BoardRole; created_at: string };

export type BoardMember = BoardPerson & {
  role: BoardRole;
  added_at: string;
  pending: boolean;
};

export type BoardError =
  | Failure
  | "not_found"
  | "member_not_found"
  | "already_member"
  | "last_owner"
  | "has_owner"
  | "invalid"
  | "conflict";

export type BoardResult<T> = { kind: "ok"; data: T } | { kind: BoardError };

const CONFLICTS = ["already_member", "last_owner", "has_owner", "conflict"] as const;

function boardFailure(status: number, body: unknown): BoardError {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (status === 404) return detail === "member_not_found" ? "member_not_found" : "not_found";
  if (status === 409) {
    return CONFLICTS.find((c) => c === detail) ?? "server";
  }
  if (status === 422) return "invalid";
  return failure(status);
}

async function call<T>(method: string, url: string, body?: unknown): Promise<BoardResult<T>> {
  const init: RequestInit =
    body === undefined
      ? { ...INIT, method }
      : {
          ...INIT,
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        };
  const res = await send(url, init);
  if (!res) return { kind: "network" };
  if (res.status === 204) return { kind: "ok", data: undefined as T };
  if (res.status === 200 || res.status === 201) {
    return res.body === null ? { kind: "server" } : { kind: "ok", data: res.body as T };
  }
  return { kind: boardFailure(res.status, res.body) };
}

export const getBoards = () => call<Tile[]>("GET", "/api/boards");
export const getOwnerless = () => call<Tile[]>("GET", "/api/boards/ownerless");
export const getBoard = (id: number) => call<BoardDetail>("GET", `/api/boards/${id}`);
export const createBoard = (name: string, visibility: Visibility) =>
  call<BoardDetail>("POST", "/api/boards", { name, visibility });
export const patchBoard = (id: number, change: { name?: string; visibility?: Visibility }) =>
  call<BoardDetail>("PATCH", `/api/boards/${id}`, change);
export const takeOwnership = (id: number) =>
  call<BoardDetail>("POST", `/api/boards/${id}/take-ownership`);
export const getBoardMembers = (id: number) =>
  call<BoardMember[]>("GET", `/api/boards/${id}/members`);
export const addBoardMember = (id: number, userId: number) =>
  call<BoardMember>("POST", `/api/boards/${id}/members`, { user_id: userId });
export const setBoardRole = (id: number, userId: number, role: BoardRole) =>
  call<BoardMember>("PATCH", `/api/boards/${id}/members/${userId}`, { role });
export const removeBoardMember = (id: number, userId: number) =>
  call<undefined>("DELETE", `/api/boards/${id}/members/${userId}`);

export async function getMemberCount(): Promise<number | null> {
  try {
    const res = await fetch("/api/members", INIT);
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return Array.isArray(body) ? body.length : null;
  } catch {
    return null;
  }
}
