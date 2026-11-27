import { describe, expect, it } from "vitest";

import type { CardError } from "../api";
import {
  CARD_LIMIT_TEXT,
  DRAFT_KEPT_TEXT,
  DRAFT_OPEN_TEXT,
  DRAFT_READONLY_TEXT,
  LINK_COPIED_TEXT,
  LINK_FAILED_TEXT,
  cardFailureText,
  cardMovedText,
  copiedText,
  deleteFailureText,
  deleteOutcome,
  descriptionFailureText,
  movedCardText,
} from "./text";

describe("card toasts", () => {
  it("names the person who moved the card and the list it is in", () => {
    expect(cardMovedText("Duc Le", "Done")).toBe(
      "This card moved. Duc Le put it in Done a moment ago; it is shown there now.",
    );
  });

  it("says Someone when the server has no name", () => {
    expect(cardMovedText(null, "Doing")).toBe(
      "This card moved. Someone put it in Doing a moment ago; it is shown there now.",
    );
  });

  it("confirms a move with the key and the list", () => {
    expect(movedCardText("TB-14", "Doing")).toBe("Moved TB-14 to Doing");
  });

  it("confirms a copy with the new key", () => {
    expect(copiedText("TB-21")).toBe("Copied as TB-21");
  });

  it("states the limit in full", () => {
    expect(CARD_LIMIT_TEXT).toBe(
      "This board has reached 1,000 cards, the limit for one board. Archive cards to add new ones.",
    );
  });
});

describe("cardFailureText", () => {
  const CHANGED = "That card or list was changed by someone else. The board was reloaded.";

  it.each([
    ["network", true, "Can't reach Taskboard. Your change was undone."],
    ["network", false, "Can't reach Taskboard. Your change was not saved."],
    ["expired", true, "Your session has ended. Your change was undone; sign in again."],
    ["expired", false, "Your session has ended. Your change was not saved; sign in again."],
    ["forbidden", true, "You can no longer change the cards on this board."],
    ["forbidden", false, "You can no longer change the cards on this board."],
    ["card_limit", true, CARD_LIMIT_TEXT],
    ["card_limit", false, CARD_LIMIT_TEXT],
    ["card_not_found", true, CHANGED],
    ["list_not_found", false, CHANGED],
    ["conflict", true, CHANGED],
    ["server", true, "That did not go through. Your change was undone; try again."],
    ["server", false, "That did not go through. Try again."],
    ["invalid", false, "That did not go through. Try again."],
    ["not_found", true, "That did not go through. Your change was undone; try again."],
    ["not_assignable", true, "That person can't be assigned to this card. Your change was undone."],
    ["not_assignable", false, "That person can't be assigned to this card."],
    ["label_not_found", true, "That label is not available any more. Your change was undone."],
    ["label_not_found", false, "That label is not available any more."],
  ] as [CardError, boolean, string][])("%s (undone %s)", (kind, undone, text) => {
    expect(cardFailureText(kind, undone)).toBe(text);
  });

  it("defaults to the not-saved wording", () => {
    expect(cardFailureText("network")).toBe("Can't reach Taskboard. Your change was not saved.");
  });
});

describe("card dialog texts", () => {
  it("confirms or explains the copied link", () => {
    expect(LINK_COPIED_TEXT).toBe("Link copied");
    expect(LINK_FAILED_TEXT).toBe("Couldn't copy the link. Copy it from the address bar.");
  });

  it("asks to save or cancel a draft before closing, and says when one was kept", () => {
    expect(DRAFT_OPEN_TEXT).toBe("You have an unsaved description. Save or cancel it first.");
    expect(DRAFT_KEPT_TEXT).toBe("Your unsaved description is kept. Open the card to carry on.");
  });

  it("keeps the text when the right to edit goes", () => {
    expect(DRAFT_READONLY_TEXT).toBe(
      "You can no longer change this card. Your unsaved description is shown read-only: copy it, or discard it.",
    );
  });

  it.each([
    ["network", "Can't reach Taskboard. Your description was not saved; the text is still here."],
    [
      "expired",
      "Your session has ended. Your description was not saved; the text is still here. Copy it, then reload the page and sign in again.",
    ],
    ["forbidden", "You can no longer change this card. Your description was not saved; the text is still here."],
    ["card_not_found", "That card was moved or archived by someone else. Your description was not saved."],
    ["invalid", "That description could not be saved. Check its length and try again."],
    ["server", "That did not go through. Your description was not saved; the text is still here."],
  ] as [CardError, string][])("words a failed description save for %s", (kind, text) => {
    expect(descriptionFailureText(kind)).toBe(text);
  });
});

describe("delete toasts and outcome", () => {
  it("offers Undo only when the server confirmed, and puts nothing back then", () => {
    expect(deleteOutcome("ok", "item")).toEqual({ putBack: false, offerUndo: true, text: "Checklist item deleted" });
    expect(deleteOutcome("ok", "comment")).toEqual({ putBack: false, offerUndo: true, text: "Comment deleted" });
  });

  it("offers no Undo and puts the thing back when the delete failed", () => {
    for (const kind of ["network", "expired", "forbidden", "conflict", "edit_window_closed"] as CardError[]) {
      const out = deleteOutcome(kind, "comment");
      expect(out.offerUndo).toBe(false);
      expect(out.putBack).toBe(true);
    }
    expect(deleteOutcome("network", "item")).toMatchObject({ putBack: true, offerUndo: false });
  });

  it("does not put back what the server says is already gone", () => {
    expect(deleteOutcome("item_not_found", "item").putBack).toBe(false);
    expect(deleteOutcome("comment_not_found", "comment").putBack).toBe(false);
  });

  it("words a failed delete as a delete, never as an unsent comment", () => {
    expect(deleteFailureText("network", "comment")).toBe("Can't reach Taskboard. The comment was not deleted; it is back.");
    expect(deleteFailureText("network", "item")).toBe("Can't reach Taskboard. The checklist item was not deleted; it is back.");
    expect(deleteFailureText("expired", "comment")).toContain("not deleted");
    expect(deleteFailureText("server" as CardError, "item")).toContain("not deleted");
    for (const kind of ["network", "expired", "forbidden", "edit_window_closed", "comment_not_found"] as CardError[]) {
      expect(deleteFailureText(kind, "comment")).not.toContain("text is still here");
    }
  });
});
