import type { CardError } from "../api";
import { CARD_LIMIT } from "./limit";

export const CARD_LIMIT_TEXT = `This board has reached ${CARD_LIMIT.toLocaleString("en-US")} cards, the limit for one board. Archive cards to add new ones.`;

const CHANGED = "That card or list was changed by someone else. The board was reloaded.";

/** Someone else moved the card first; the screen already shows it where they put it. */
export const cardMovedText = (name: string | null, listName: string) =>
  `This card moved. ${name ?? "Someone"} put it in ${listName} a moment ago; it is shown there now.`;

export const movedCardText = (key: string, listName: string) => `Moved ${key} to ${listName}`;
export const copiedText = (key: string) => `Copied as ${key}`;

/**
 * The toast for a failed card change. `undone` is true when the screen already showed the change
 * and has now taken it back.
 */
export function cardFailureText(kind: CardError, undone = false): string {
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
      return "You can no longer change the cards on this board.";
    case "card_limit":
      return CARD_LIMIT_TEXT;
    case "card_not_found":
    case "list_not_found":
    case "conflict":
      return CHANGED;
    default:
      return undone
        ? "That did not go through. Your change was undone; try again."
        : "That did not go through. Try again.";
  }
}
