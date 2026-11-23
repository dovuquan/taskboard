import { describe, expect, it } from "vitest";

import type { CardError } from "../api";
import { CARD_LIMIT_TEXT, cardFailureText, cardMovedText, copiedText, movedCardText } from "./text";

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
  ] as [CardError, boolean, string][])("%s (undone %s)", (kind, undone, text) => {
    expect(cardFailureText(kind, undone)).toBe(text);
  });

  it("defaults to the not-saved wording", () => {
    expect(cardFailureText("network")).toBe("Can't reach Taskboard. Your change was not saved.");
  });
});
