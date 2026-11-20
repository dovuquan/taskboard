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
