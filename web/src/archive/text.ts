import type { CardError } from "../api";
import { CARD_LIMIT_TEXT, cardFailureText } from "../cards/text";

export const ARCHIVED_HEAD_NOTE = "Archived lists and cards keep their comments, checklists and history.";
export const ARCHIVED_EMPTY_HINT =
  "Archived lists and cards show up here. An owner can bring them back; nothing is deleted.";
export const OWNERS_ONLY_TEXT = "Only board owners can restore archived items.";
export const NO_LIST_TEXT = "Add a list first; the card goes back into it.";
export const UNDO_CARD_CLOSED_TEXT =
  "Undo is only open for a minute after archiving. A board owner can still restore this card.";

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

export const archivedCardText = (key: string) => `Archived ${key}. Its comments and checklist stay.`;
export const restoredCardText = (key: string, listName: string) => `Restored ${key} to ${listName}`;
export const restoredListText = (name: string, cards: number) =>
  `Restored ${name} with its ${plural(cards, "card")}`;
export const archivedBoardText = (name: string) => `Archived ${name}. Nothing is deleted.`;
export const restoredBoardText = (name: string) => `Restored ${name}`;
export const archiveBoardConfirmText = (name: string) =>
  `Archive ${name}? Everyone loses access until an owner or admin restores it from Archived boards on the Boards page.`;

/** A row of the Archived lists section: "3 cards · archived 2h ago". */
export const listRowText = (cards: number, when: string) =>
  `${plural(cards, "card")} · archived ${when}`;
/** A row of the Archived cards section: "from Doing · archived 2h ago". */
export const cardRowText = (listName: string, when: string) => `from ${listName} · archived ${when}`;

/** The board header's button: the number shows only when something is archived. */
export const archivedButtonText = (count: number | null) =>
  count ? `Archived (${count})` : "Archived";

/** The toast for a failed Undo after archiving a card. */
export function undoCardFailureText(kind: CardError): string {
  return kind === "forbidden" ? UNDO_CARD_CLOSED_TEXT : cardFailureText(kind, false);
}

/** The toast for a failed Restore from the Archived view (lists and cards). */
export function restoreFailureText(kind: string): string {
  switch (kind) {
    case "forbidden":
      return OWNERS_ONLY_TEXT;
    case "no_list":
      return NO_LIST_TEXT;
    case "card_limit":
      return CARD_LIMIT_TEXT;
    case "network":
      return "Can't reach Taskboard. Nothing was restored.";
    case "expired":
      return "Your session has ended. Nothing was restored; sign in again.";
    case "card_not_found":
    case "list_not_found":
    case "conflict":
      return "That item was changed by someone else. The list was reloaded.";
    default:
      return "That did not go through. Try again.";
  }
}
