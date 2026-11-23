import { describe, expect, it } from "vitest";

import {
  LIST_LIMIT_TEXT,
  SEEDED_TEXT,
  addedText,
  archivedText,
  changeFailureText,
  movedText,
  renamedText,
  restoreFailureText,
  restoredText,
} from "./text";

describe("list texts", () => {
  it("uses the prototype wording", () => {
    expect(LIST_LIMIT_TEXT).toBe(
      "50 lists is the limit for one board. Archive a list to add another.",
    );
    expect(archivedText("Doing")).toBe("Archived Doing. Nothing is deleted.");
    expect(renamedText("Review")).toBe("Renamed to Review");
    expect(addedText("Ideas")).toBe("Added list Ideas");
    expect(movedText("Doing")).toBe("Moved list Doing");
    expect(restoredText("Doing")).toBe("Restored Doing");
    expect(SEEDED_TEXT).toBe("Added To do, Doing and Done");
  });
});

describe("changeFailureText", () => {
  it("says the change was undone for optimistic changes", () => {
    expect(changeFailureText("network", true)).toBe(
      "Can't reach Taskboard. Your change was undone.",
    );
    expect(changeFailureText("expired", true)).toBe(
      "Your session has ended. Your change was undone; sign in again.",
    );
    expect(changeFailureText("server", true)).toBe(
      "That did not go through. Your change was undone; try again.",
    );
  });

  it("says the change was not saved when nothing was shown first", () => {
    expect(changeFailureText("network", false)).toBe(
      "Can't reach Taskboard. Your change was not saved.",
    );
    expect(changeFailureText("expired", false)).toBe(
      "Your session has ended. Your change was not saved; sign in again.",
    );
    expect(changeFailureText("server", false)).toBe("That did not go through. Try again.");
  });

  it("explains the limit, a vanished list and a changed board", () => {
    expect(changeFailureText("list_limit", false)).toBe(LIST_LIMIT_TEXT);
    expect(changeFailureText("list_not_found", true)).toBe(
      "That list was changed by someone else. The lists were reloaded.",
    );
    expect(changeFailureText("conflict", true)).toBe(
      "That list was changed by someone else. The lists were reloaded.",
    );
    expect(changeFailureText("forbidden", true)).toBe(
      "You can no longer change the lists on this board.",
    );
    expect(changeFailureText("invalid", false)).toBe("That did not go through. Try again.");
  });
});

describe("restoreFailureText", () => {
  it("explains the undo window on 403", () => {
    expect(restoreFailureText("forbidden")).toBe(
      "Undo is only open for a minute after archiving. A board owner can still restore this list.",
    );
  });

  it("falls back to the general text", () => {
    expect(restoreFailureText("network")).toBe("Can't reach Taskboard. Your change was not saved.");
    expect(restoreFailureText("list_limit")).toBe(LIST_LIMIT_TEXT);
  });
});
