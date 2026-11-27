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

export const COMMENT_OPEN_TEXT = "You have an unsent comment. Post or clear it first.";
export const WINDOW_CLOSED_TEXT = "You can only change a comment for 24 hours after posting it.";
export const COMMENT_UPDATED_TEXT = "Comment updated";
export const COMMENT_DELETED_TEXT = "Comment deleted";
export const ITEM_DELETED_TEXT = "Checklist item deleted";
export const UNDO_FAILED_TEXT = "Couldn't undo that. Undo is only open for a minute after deleting.";

/**
 * The toast for a failed checklist change. `undone` is true when the screen already showed the
 * change and has now taken it back.
 */
export function checklistFailureText(kind: CardError, undone = false): string {
  switch (kind) {
    case "checklist_limit":
      return "This card has 100 checklist items, the limit for one card. Delete some to add more.";
    case "item_not_found":
      return "That checklist item was already removed. The card was reloaded.";
    case "forbidden":
      return "You can no longer change the checklist on this card.";
    case "invalid":
      return "That item could not be saved. It needs 1 to 200 characters.";
    default:
      return cardFailureText(kind, undone);
  }
}

export type Deletable = "item" | "comment";

/** The toast for a failed delete: the thing was put back on screen (or is already gone). */
export function deleteFailureText(kind: CardError, what: Deletable): string {
  const noun = what === "item" ? "checklist item" : "comment";
  switch (kind) {
    case "network":
      return `Can't reach Taskboard. The ${noun} was not deleted; it is back.`;
    case "expired":
      return `Your session has ended. The ${noun} was not deleted; it is back. Sign in again.`;
    case "forbidden":
    case "edit_window_closed":
    case "item_not_found":
    case "comment_not_found":
      return what === "item" ? checklistFailureText(kind) : commentFailureText(kind);
    default:
      return `That did not go through. The ${noun} was not deleted; it is back.`;
  }
}

/**
 * What a finished delete means for the screen. The Undo toast is offered only when the server
 * confirmed (`ok`); on any failure the thing goes back, except when the server says it is already
 * gone, where the refetch shows the truth.
 */
export function deleteOutcome(
  kind: "ok" | CardError,
  what: Deletable,
): { putBack: boolean; offerUndo: boolean; text: string } {
  if (kind === "ok") {
    return { putBack: false, offerUndo: true, text: what === "item" ? ITEM_DELETED_TEXT : COMMENT_DELETED_TEXT };
  }
  const gone = kind === "item_not_found" || kind === "comment_not_found";
  return { putBack: !gone, offerUndo: false, text: deleteFailureText(kind, what) };
}

/** The toast for a failed comment change; typed text stays in its box. */
export function commentFailureText(kind: CardError): string {
  switch (kind) {
    case "comment_limit":
      return "This card has 500 comments, the limit for one card. Delete some to add more.";
    case "comment_not_found":
      return "That comment was already deleted. The comments were reloaded.";
    case "edit_window_closed":
      return WINDOW_CLOSED_TEXT;
    case "forbidden":
      return "You can no longer post or change comments on this card.";
    case "invalid":
      return "That comment could not be saved. It needs 1 to 5,000 characters.";
    case "network":
      return "Can't reach Taskboard. Your comment was not saved; the text is still here.";
    case "expired":
      return "Your session has ended. Your comment was not saved; the text is still here. Copy it, then reload the page and sign in again.";
    case "card_not_found":
    case "list_not_found":
    case "conflict":
      return "That card was moved or archived by someone else. Your comment was not saved.";
    default:
      return "That did not go through. Try again.";
  }
}
