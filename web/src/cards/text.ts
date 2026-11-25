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
    case "not_assignable":
      return undone
        ? "That person can't be assigned to this card. Your change was undone."
        : "That person can't be assigned to this card.";
    case "label_not_found":
      return undone
        ? "That label is not available any more. Your change was undone."
        : "That label is not available any more.";
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

export const LINK_COPIED_TEXT = "Link copied";
export const LINK_FAILED_TEXT = "Couldn't copy the link. Copy it from the address bar.";
export const DRAFT_OPEN_TEXT = "You have an unsaved description. Save or cancel it first.";
export const DRAFT_KEPT_TEXT = "Your unsaved description is kept. Open the card to carry on.";

/** An ended session does not reload the page while a description has unsaved text. */
export const EXPIRED_DRAFT_TEXT =
  "Your session has ended. Your unsaved description is still in its box; copy it, then reload the page and sign in again.";

/** Shown above a description that someone who can no longer edit still has open. */
export const DRAFT_READONLY_TEXT =
  "You can no longer change this card. Your unsaved description is shown read-only: copy it, or discard it.";

/** The toast for a failed description save; the text stays in the box except when the card is gone. */
export function descriptionFailureText(kind: CardError): string {
  switch (kind) {
    case "network":
      return "Can't reach Taskboard. Your description was not saved; the text is still here.";
    case "expired":
      return "Your session has ended. Your description was not saved; the text is still here. Copy it, then reload the page and sign in again.";
    case "forbidden":
      return "You can no longer change this card. Your description was not saved; the text is still here.";
    case "card_not_found":
      return "That card was moved or archived by someone else. Your description was not saved.";
    case "invalid":
      return "That description could not be saved. Check its length and try again.";
    default:
      return "That did not go through. Your description was not saved; the text is still here.";
  }
}
