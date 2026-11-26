import { describe, expect, it } from "vitest";

import type { EventEntry } from "../api";
import {
  FEED_FIRST,
  actorName,
  activityText,
  canChangeComment,
  commentUnsent,
  isSubmitKey,
  shownEntries,
  whenText,
  withEntryAt,
} from "./feed";

const ctx = {
  lists: [
    { id: 11, name: "To do" },
    { id: 12, name: "Doing" },
  ],
  people: [
    { id: 1, name: "Ann Lee", email: "ann@example.com" },
    { id: 2, name: null, email: "bo@example.com" },
  ],
};

const event = (kind: string, data: Record<string, unknown> = {}, actor: EventEntry["actor"] = null): EventEntry => ({
  type: "event",
  id: 1,
  at: "2026-11-20T09:00:00Z",
  actor,
  kind,
  data,
});

describe("activityText", () => {
  it.each([
    ["card.created", { key: "TB-3", title: "x", list_id: 11 }, "created this card in To do"],
    ["card.moved", { key: "TB-3", from_list_id: 11, to_list_id: 12 }, "moved this card from To do to Doing"],
    ["card.copied", { key: "TB-4", from_key: "TB-3" }, "copied this card from TB-3"],
    ["card.renamed", { key: "TB-3", from: "Old", to: "New" }, "renamed this card from Old to New"],
    ["card.described", { key: "TB-3", cleared: false }, "changed the description"],
    ["card.described", { key: "TB-3", cleared: true }, "cleared the description"],
    ["card.due_changed", { key: "TB-3", from: null, to: "2026-12-05" }, "set the due date to 5 Dec"],
    ["card.due_changed", { key: "TB-3", from: "2026-12-05", to: null }, "cleared the due date"],
    ["card.due_changed", { key: "TB-3", from: "2026-12-05", to: "2026-12-07" }, "changed the due date to 7 Dec"],
    ["card.member_added", { key: "TB-3", user_id: 1 }, "added Ann Lee to this card"],
    ["card.member_removed", { key: "TB-3", user_id: 1 }, "removed Ann Lee from this card"],
    ["card.label_added", { key: "TB-3", label_id: 2, name: "Bug" }, "added the label Bug"],
    ["card.label_removed", { key: "TB-3", label_id: 2, name: "Bug" }, "removed the label Bug"],
    ["checklist.item_added", { key: "TB-3", item_id: 5, text: "Tape" }, "added Tape to the checklist"],
    ["checklist.item_checked", { key: "TB-3", item_id: 5, text: "Tape" }, "checked Tape"],
    ["checklist.item_unchecked", { key: "TB-3", item_id: 5, text: "Tape" }, "unchecked Tape"],
    ["checklist.item_deleted", { key: "TB-3", item_id: 5, text: "Tape" }, "deleted Tape from the checklist"],
    ["checklist.item_restored", { key: "TB-3", item_id: 5, text: "Tape" }, "restored Tape to the checklist"],
  ])("writes %s as a sentence", (kind, data, text) => {
    expect(activityText(event(kind, data), ctx)).toBe(text);
  });

  it("uses a fallback for a list that is not loaded", () => {
    expect(activityText(event("card.created", { list_id: 99 }), ctx)).toBe("created this card in another list");
    expect(activityText(event("card.moved", { from_list_id: 99, to_list_id: 12 }), ctx)).toBe(
      "moved this card from another list to Doing",
    );
  });

  it("uses the email of a person without a name and a fallback for an unknown person", () => {
    expect(activityText(event("card.member_added", { user_id: 2 }), ctx)).toBe("added bo@example.com to this card");
    expect(activityText(event("card.member_added", { user_id: 99 }), ctx)).toBe("added someone to this card");
  });

  it("keeps working when the data is missing or the wrong type", () => {
    expect(activityText(event("card.created", {}), ctx)).toBe("created this card in another list");
    expect(activityText(event("checklist.item_checked", { text: 5 }), ctx)).toBe("checked an item");
  });

  it("describes a kind it does not know in general words", () => {
    expect(activityText(event("card.teleported"), ctx)).toBe("changed this card");
  });
});

describe("actorName", () => {
  it("is the person's name, someone for a nameless person, Taskboard for no actor", () => {
    expect(actorName(event("card.moved", {}, { id: 1, name: "Ann Lee", avatar_url: null }))).toBe("Ann Lee");
    expect(actorName(event("card.moved", {}, { id: 1, name: null, avatar_url: null }))).toBe("someone");
    expect(actorName(event("card.moved", {}, null))).toBe("Taskboard");
  });
});

describe("canChangeComment", () => {
  const now = Date.parse("2026-11-20T12:00:00Z");

  it("is false without a deadline", () => {
    expect(canChangeComment(null, now)).toBe(false);
  });

  it("is false once the deadline passed or is now", () => {
    expect(canChangeComment("2026-11-20T11:59:59Z", now)).toBe(false);
    expect(canChangeComment("2026-11-20T12:00:00Z", now)).toBe(false);
  });

  it("is true while the deadline is ahead", () => {
    expect(canChangeComment("2026-11-20T12:00:01Z", now)).toBe(true);
  });

  it("is false for a deadline that is not a date", () => {
    expect(canChangeComment("soon", now)).toBe(false);
  });
});

describe("shownEntries", () => {
  const nine = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  it("shows the first four until asked for all", () => {
    expect(FEED_FIRST).toBe(4);
    expect(shownEntries(nine, false)).toEqual([1, 2, 3, 4]);
    expect(shownEntries(nine, true)).toEqual(nine);
    expect(shownEntries([1, 2], false)).toEqual([1, 2]);
  });
});

describe("whenText", () => {
  const now = Date.parse("2026-11-20T12:00:00Z");

  it("says just now, minutes and hours for the first day", () => {
    expect(whenText("2026-11-20T11:59:30Z", now)).toBe("just now");
    expect(whenText("2026-11-20T11:15:00Z", now)).toBe("45m ago");
    expect(whenText("2026-11-20T09:00:00Z", now)).toBe("3h ago");
  });

  it("treats a time a little ahead of this device's clock as just now", () => {
    expect(whenText("2026-11-20T12:00:20Z", now)).toBe("just now");
  });

  it("shows a date after a day", () => {
    expect(whenText("2026-11-01T12:00:00Z", now)).toMatch(/^\d{1,2} Nov$/);
    expect(whenText("2025-03-01T12:00:00Z", now)).toMatch(/2025/);
  });

  it("shows nothing for a time that is not a date", () => {
    expect(whenText("later", now)).toBe("");
  });
});

describe("commentUnsent", () => {
  it("is true when the new comment box holds text", () => {
    expect(commentUnsent("hello", null)).toBe(true);
  });

  it("is false for a blank box and no edit", () => {
    expect(commentUnsent("", null)).toBe(false);
    expect(commentUnsent("  \n ", null)).toBe(false);
  });

  it("is true for an open edit whose text differs from the comment", () => {
    expect(commentUnsent("", { text: "changed", original: "first" })).toBe(true);
  });

  it("is false for an open edit nobody changed", () => {
    expect(commentUnsent("", { text: "first", original: "first" })).toBe(false);
  });
});

describe("isSubmitKey", () => {
  const key = (k: string, meta: boolean, ctrl: boolean) => ({ key: k, metaKey: meta, ctrlKey: ctrl });
  it("is Ctrl+Enter or Cmd+Enter", () => {
    expect(isSubmitKey(key("Enter", false, true))).toBe(true);
    expect(isSubmitKey(key("Enter", true, false))).toBe(true);
  });
  it("is not a plain Enter or another key with a modifier", () => {
    expect(isSubmitKey(key("Enter", false, false))).toBe(false);
    expect(isSubmitKey(key("a", false, true))).toBe(false);
  });
});

describe("withEntryAt", () => {
  const list = [
    { type: "comment", id: 1 },
    { type: "event", id: 1 },
    { type: "comment", id: 2 },
  ];
  it("puts a removed comment back at its old place", () => {
    const gone = list.filter((x) => !(x.type === "comment" && x.id === 1));
    expect(withEntryAt(gone, list[0], 0)).toEqual(list);
  });
  it("does not duplicate an entry that is already there, and treats an event with the same id as another entry", () => {
    expect(withEntryAt(list, list[2], 2)).toBe(list);
    expect(withEntryAt([list[1]], list[0], 0)).toEqual([list[0], list[1]]);
  });
  it("goes to the end when the list got shorter", () => {
    expect(withEntryAt([list[1]], list[2], 9)).toEqual([list[1], list[2]]);
  });
});
