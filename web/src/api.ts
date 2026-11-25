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

/** A column of a board, as the lists endpoints return it. */
export type BoardList = { id: number; name: string };

export type ListError = BoardError | "list_limit" | "list_not_found" | "card_limit";
export type ListsResult<T> = { kind: "ok"; data: T } | { kind: ListError };

function listFailure(status: number, body: unknown): ListError {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (status === 404 && detail === "list_not_found") return "list_not_found";
  if (status === 422 && detail === "list_limit") return "list_limit";
  // Restoring a list can be refused when its cards would pass the board's card limit.
  if (status === 422 && detail === "card_limit") return "card_limit";
  return boardFailure(status, body);
}

async function callWith<E extends string, T>(
  map: (status: number, body: unknown) => E,
  method: string,
  url: string,
  body?: unknown,
): Promise<{ kind: "ok"; data: T } | { kind: E }> {
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
  if (!res) return { kind: "network" } as { kind: E };
  if (res.status === 204) return { kind: "ok", data: undefined as T };
  if (res.status === 200 || res.status === 201) {
    return res.body === null ? ({ kind: "server" } as { kind: E }) : { kind: "ok", data: res.body as T };
  }
  return { kind: map(res.status, res.body) };
}

function call<T>(method: string, url: string, body?: unknown): Promise<BoardResult<T>> {
  return callWith<BoardError, T>(boardFailure, method, url, body);
}

function callList<T>(method: string, url: string, body?: unknown): Promise<ListsResult<T>> {
  return callWith<ListError, T>(listFailure, method, url, body);
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

export const getLists = (boardId: number) =>
  callList<BoardList[]>("GET", `/api/boards/${boardId}/lists`);
export const createList = (boardId: number, name: string) =>
  callList<BoardList>("POST", `/api/boards/${boardId}/lists`, { name });
export const renameList = (boardId: number, listId: number, name: string) =>
  callList<BoardList>("PATCH", `/api/boards/${boardId}/lists/${listId}`, { name });
/** `afterId` is the list the moved one should follow; null puts it first. */
export const moveList = (boardId: number, listId: number, afterId: number | null) =>
  callList<BoardList>("POST", `/api/boards/${boardId}/lists/${listId}/move`, { after_id: afterId });
export const archiveList = (boardId: number, listId: number) =>
  callList<BoardList>("POST", `/api/boards/${boardId}/lists/${listId}/archive`);
export const restoreList = (boardId: number, listId: number) =>
  callList<BoardList>("POST", `/api/boards/${boardId}/lists/${listId}/restore`);

/** A card tile as the cards endpoints return it; `key` is the server's TB-n. */
export type Card = {
  id: number;
  key: string;
  list_id: number;
  title: string;
  label_ids: number[];
  member_ids: number[];
  /** The due day as YYYY-MM-DD, or null. */
  due_on: string | null;
  has_description: boolean;
};

/** One card with its description, as `GET` and the card edits return it. */
export type CardDetail = Card & { description: string | null };

/** One of the board's labels; `color` is the suffix of the `--l-<color>` token. */
export type Label = { id: number; name: string; color: string };

/** The change `PATCH` takes: exactly one field. */
export type CardChange = { title: string } | { description: string | null } | { due_on: string | null };

export type CardError =
  | BoardError
  | "card_limit"
  | "card_not_found"
  | "list_not_found"
  | "not_assignable"
  | "label_not_found";
export type CardsResult<T> = { kind: "ok"; data: T } | { kind: CardError };

/** What a drop tells the server: where the card goes and where it was, for the stale check. */
export type CardMove = {
  list_id: number;
  after_id: number | null;
  from_list_id: number;
  from_after_id: number | null;
};

/** The 409 answer: someone else moved the card first; `card` and `after_id` say where it is now. */
export type CardMoved = {
  kind: "card_moved";
  card: Card;
  after_id: number | null;
  moved_by: string | null;
};
export type MoveResult = CardsResult<Card> | CardMoved;

function cardFailure(status: number, body: unknown): CardError {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (status === 404 && detail === "card_not_found") return "card_not_found";
  if (status === 404 && detail === "list_not_found") return "list_not_found";
  if (status === 404 && detail === "label_not_found") return "label_not_found";
  if (status === 422 && detail === "card_limit") return "card_limit";
  if (status === 422 && detail === "not_assignable") return "not_assignable";
  return boardFailure(status, body);
}

function callCard<T>(method: string, url: string, body?: unknown): Promise<CardsResult<T>> {
  return callWith<CardError, T>(cardFailure, method, url, body);
}

export const getCards = (boardId: number) =>
  callCard<Card[]>("GET", `/api/boards/${boardId}/cards`);
export const createCard = (boardId: number, listId: number, title: string) =>
  callCard<Card>("POST", `/api/boards/${boardId}/cards`, { list_id: listId, title });
export const copyCard = (boardId: number, cardId: number) =>
  callCard<Card>("POST", `/api/boards/${boardId}/cards/${cardId}/copy`, {});

export const getLabels = () => callCard<Label[]>("GET", "/api/labels");
export const getCard = (boardId: number, cardId: number) =>
  callCard<CardDetail>("GET", `/api/boards/${boardId}/cards/${cardId}`);
export const patchCard = (boardId: number, cardId: number, change: CardChange) =>
  callCard<CardDetail>("PATCH", `/api/boards/${boardId}/cards/${cardId}`, change);
export const addCardMember = (boardId: number, cardId: number, userId: number) =>
  callCard<CardDetail>("PUT", `/api/boards/${boardId}/cards/${cardId}/members/${userId}`);
export const removeCardMember = (boardId: number, cardId: number, userId: number) =>
  callCard<CardDetail>("DELETE", `/api/boards/${boardId}/cards/${cardId}/members/${userId}`);
export const addCardLabel = (boardId: number, cardId: number, labelId: number) =>
  callCard<CardDetail>("PUT", `/api/boards/${boardId}/cards/${cardId}/labels/${labelId}`);
export const removeCardLabel = (boardId: number, cardId: number, labelId: number) =>
  callCard<CardDetail>("DELETE", `/api/boards/${boardId}/cards/${cardId}/labels/${labelId}`);

export async function moveCard(boardId: number, cardId: number, move: CardMove): Promise<MoveResult> {
  const res = await send(`/api/boards/${boardId}/cards/${cardId}/move`, {
    ...INIT,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      list_id: move.list_id,
      after_id: move.after_id,
      from_list_id: move.from_list_id,
      from_after_id: move.from_after_id,
    }),
  });
  if (!res) return { kind: "network" };
  const body = res.body as {
    detail?: unknown;
    card?: Card;
    after_id?: number | null;
    moved_by?: string | null;
  } | null;
  if (res.status === 200) {
    return body ? { kind: "ok", data: body as unknown as Card } : { kind: "server" };
  }
  if (res.status === 409 && body?.detail === "card_moved" && body.card) {
    return {
      kind: "card_moved",
      card: body.card,
      after_id: body.after_id ?? null,
      moved_by: body.moved_by ?? null,
    };
  }
  return { kind: cardFailure(res.status, res.body) };
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
