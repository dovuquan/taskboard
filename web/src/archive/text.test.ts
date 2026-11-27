import { describe, expect, it } from "vitest";

import {
  ARCHIVED_EMPTY_HINT,
  NO_LIST_TEXT,
  UNDO_CARD_CLOSED_TEXT,
  archiveBoardConfirmText,
  archivedBoardText,
  archivedButtonText,
  archivedCardText,
  cardRowText,
  listRowText,
  restoreFailureText,
  restoredBoardText,
  restoredCardText,
  restoredListText,
  undoCardFailureText,
} from "./text";

describe("archive toasts", () => {
  it("confirms archiving a card with the key", () => {
    expect(archivedCardText("TB-14")).toBe("Archived TB-14. Its comments and checklist stay.");
  });

  it("confirms restoring a card with its list", () => {
    expect(restoredCardText("TB-14", "Doing")).toBe("Restored TB-14 to Doing");
  });

  it("confirms restoring a list with its card count", () => {
    expect(restoredListText("Done", 3)).toBe("Restored Done with its 3 cards");
    expect(restoredListText("Done", 1)).toBe("Restored Done with its 1 card");
    expect(restoredListText("Done", 0)).toBe("Restored Done with its 0 cards");
  });

  it("confirms archiving and restoring a board", () => {
    expect(archivedBoardText("Q4 Launch")).toBe("Archived Q4 Launch. Nothing is deleted.");
    expect(restoredBoardText("Q4 Launch")).toBe("Restored Q4 Launch");
  });

  it("asks before archiving a board, naming who can restore it", () => {
    expect(archiveBoardConfirmText("Q4 Launch")).toBe(
      "Archive Q4 Launch? Everyone loses access until an owner or admin restores it from Archived boards on the Boards page.",
    );
  });

  it("tells the first list to add when there is none", () => {
    expect(NO_LIST_TEXT).toBe("Add a list first; the card goes back into it.");
  });

  it("has the prototype's empty hint", () => {
    expect(ARCHIVED_EMPTY_HINT).toBe(
      "Archived lists and cards show up here. An owner can bring them back; nothing is deleted.",
    );
  });
});

describe("archive row texts", () => {
  it("counts the cards of a list row", () => {
    expect(listRowText(3, "just now")).toBe("3 cards · archived just now");
    expect(listRowText(1, "2h ago")).toBe("1 card · archived 2h ago");
    expect(listRowText(0, "6 Nov")).toBe("0 cards · archived 6 Nov");
  });

  it("names the list a card came from", () => {
    expect(cardRowText("Doing", "45m ago")).toBe("from Doing · archived 45m ago");
  });

  it("shows the Archived button with a number only when something is archived", () => {
    expect(archivedButtonText(0)).toBe("Archived");
    expect(archivedButtonText(5)).toBe("Archived (5)");
    expect(archivedButtonText(null)).toBe("Archived");
  });
});

describe("restore failures", () => {
  it("explains the Undo window for a card", () => {
    expect(undoCardFailureText("forbidden")).toBe(
      "Undo is only open for a minute after archiving. A board owner can still restore this card.",
    );
    expect(undoCardFailureText("forbidden")).toBe(UNDO_CARD_CLOSED_TEXT);
    expect(undoCardFailureText("network")).toBe("Can't reach Taskboard. Your change was not saved.");
  });

  it.each([
    ["forbidden", "Only board owners can restore archived items."],
    ["no_list", NO_LIST_TEXT],
    [
      "card_limit",
      "This board has reached 1,000 cards, the limit for one board. Archive cards to add new ones.",
    ],
    ["network", "Can't reach Taskboard. Nothing was restored."],
    ["expired", "Your session has ended. Nothing was restored; sign in again."],
    ["card_not_found", "That item was changed by someone else. The list was reloaded."],
    ["list_not_found", "That item was changed by someone else. The list was reloaded."],
    ["server", "That did not go through. Try again."],
  ])("words %s from the Archived view", (kind, text) => {
    expect(restoreFailureText(kind)).toBe(text);
  });
});
