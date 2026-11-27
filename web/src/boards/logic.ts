import type { BoardError, BoardMember, BoardRole, Member } from "../api";

export const LAST_OWNER_TEXT = "A board needs at least one owner. Make someone else an owner first.";

const GENERIC = "That did not go through. Try again.";

export function roleChip(role: BoardRole): string {
  return role === "owner" ? "Owner" : role === "observer" ? "Observer" : "Member";
}

export function roleChangedText(name: string, role: BoardRole): string {
  const phrase = role === "owner" ? "an owner" : role === "member" ? "a member" : "an observer";
  return `${name} is now ${phrase}`;
}

/** Workspace members whose name or email contains the query and who are not on the board yet. */
export function addMatches(query: string, workspace: Member[], onBoard: BoardMember[]): Member[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const taken = new Set(onBoard.map((p) => p.id));
  return workspace
    .filter((m) => !taken.has(m.id) && `${m.name ?? ""} ${m.email}`.toLowerCase().includes(q))
    .slice(0, 6);
}

/** The text to show instead of calling the server when the change would leave no owner. */
export function lastOwnerBlock(
  people: BoardMember[],
  userId: number,
  next: BoardRole | "remove",
): string | null {
  const target = people.find((p) => p.id === userId);
  if (!target || target.role !== "owner" || next === "owner") return null;
  return people.filter((p) => p.role === "owner").length === 1 ? LAST_OWNER_TEXT : null;
}

const TILE_COLORS = ["launch", "bug", "docs", "ops", "marketing", "research", "design"];

export function tileColor(id: number): string {
  return `var(--l-${TILE_COLORS[id % TILE_COLORS.length]})`;
}

export function boardErrorText(kind: BoardError): string {
  switch (kind) {
    case "last_owner":
      return LAST_OWNER_TEXT;
    case "already_member":
      return "That person is already on this board.";
    case "member_not_found":
      return "That person is not a workspace member.";
    case "has_owner":
      return "This board already has an owner.";
    case "forbidden":
      return "Only board owners can change this.";
    case "not_found":
      return "This board isn't here any more.";
    case "network":
      return "Can't reach Taskboard. Your change was not saved.";
    case "expired":
      return "Your session has ended. Your change was not saved; sign in again.";
    case "invalid":
    case "conflict":
    case "server":
      return GENERIC;
  }
}

export type Failure = { expired: boolean; gone: boolean; message: string };

/** What a page does with a failed call: reload on 401, show "not here" on 404, else a toast. */
export function describeFailure(kind: BoardError): Failure {
  return { expired: kind === "expired", gone: kind === "not_found", message: boardErrorText(kind) };
}
