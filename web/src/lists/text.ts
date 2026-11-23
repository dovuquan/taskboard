import type { ListError } from "../api";
import { CARD_LIMIT_TEXT } from "../cards/text";
import { LIST_LIMIT } from "./logic";

export const LIST_LIMIT_TEXT = `${LIST_LIMIT} lists is the limit for one board. Archive a list to add another.`;

const CHANGED = "That list was changed by someone else. The lists were reloaded.";

export const SEEDED_TEXT = "Added To do, Doing and Done";

export const archivedText = (name: string) => `Archived ${name}. Nothing is deleted.`;
export const renamedText = (name: string) => `Renamed to ${name}`;
export const addedText = (name: string) => `Added list ${name}`;
export const movedText = (name: string) => `Moved list ${name}`;
export const restoredText = (name: string) => `Restored ${name}`;

/**
 * The toast for a failed change. `undone` is true when the screen already showed the change and
 * has now taken it back.
 */
export function changeFailureText(kind: ListError, undone: boolean): string {
  switch (kind) {
    case "network":
      return undone
        ? "Can't reach Taskboard. Your change was undone."
        : "Can't reach Taskboard. Your change was not saved.";
    case "expired":
      return undone
        ? "Your session has ended. Your change was undone; sign in again."
        : "Your session has ended. Your change was not saved; sign in again.";
    case "forbidden":
      return "You can no longer change the lists on this board.";
    case "list_limit":
      return LIST_LIMIT_TEXT;
    case "card_limit":
      return CARD_LIMIT_TEXT;
    case "list_not_found":
    case "conflict":
      return CHANGED;
    default:
      return undone
        ? "That did not go through. Your change was undone; try again."
        : "That did not go through. Try again.";
  }
}

/** The toast for a failed Undo after archiving. */
export function restoreFailureText(kind: ListError): string {
  return kind === "forbidden"
    ? "Undo is only open for a minute after archiving. A board owner can still restore this list."
    : changeFailureText(kind, false);
}
