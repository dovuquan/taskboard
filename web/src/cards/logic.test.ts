import { describe, expect, it } from "vitest";

import type { Card, CardDetail } from "../api";
import {
  CARD_LIMIT,
  type ByList,
  DESCRIPTION_LIMIT,
  acceptDetail,
  assignablePeople,
  canAddCard,
  createSaveTracker,
  descriptionToSend,
  draftDirty,
  escapeAction,
  fieldKey,
  findByKey,
  groupByList,
  insertAfterCard,
  matchPeople,
  oneLine,
  placeCard,
  planCardDrop,
  readField,
  revertCardMove,
  shouldApply,
  shouldRefetchDetail,
  showPeopleSearch,
  tileOf,
  titleFrom,
  ungroup,
  withField,
} from "./logic";

const card = (id: number, list_id: number, title = `Card ${id}`): Card => ({
  id,
  key: `TB-${id}`,
  list_id,
  title,
  label_ids: [],
  member_ids: [],
  due_on: null,
  has_description: false,
});

const lists = [{ id: 1 }, { id: 2 }, { id: 3 }];

/** List 1 holds 10, 11, 12; list 2 holds 20; list 3 is empty. */
const start = (): ByList => ({
  1: [card(10, 1), card(11, 1), card(12, 1)],
  2: [card(20, 2)],
  3: [],
});

const ids = (cards: Card[]) => cards.map((c) => c.id);

describe("groupByList", () => {
  it("groups cards by list and keeps the server order inside each list", () => {
    const grouped = groupByList(lists, [card(12, 1), card(20, 2), card(10, 1), card(11, 1)]);
    expect(ids(grouped[1])).toEqual([12, 10, 11]);
    expect(ids(grouped[2])).toEqual([20]);
  });

  it("gives every loaded list an array, even with no cards", () => {
    expect(groupByList(lists, [])).toEqual({ 1: [], 2: [], 3: [] });
  });

  it("drops cards whose list is not among the loaded lists", () => {
    const grouped = groupByList([{ id: 1 }], [card(10, 1), card(99, 9)]);
    expect(Object.keys(grouped)).toEqual(["1"]);
    expect(ids(grouped[1])).toEqual([10]);
  });
});

describe("ungroup", () => {
  it("returns every card once, each list in its order", () => {
    const flat = ungroup(start());
    expect(ids(flat).sort()).toEqual([10, 11, 12, 20]);
    expect(groupByList(lists, flat)).toEqual(start());
  });
});

describe("planCardDrop", () => {
  it("moves a card to the front of another list", () => {
    const plan = planCardDrop(start(), 10, 2, 0);
    expect(plan?.move).toEqual({ list_id: 2, after_id: null, from_list_id: 1, from_after_id: null });
    expect(ids(plan!.next[1])).toEqual([11, 12]);
    expect(ids(plan!.next[2])).toEqual([10, 20]);
    expect(plan!.next[2][0].list_id).toBe(2);
  });

  it("moves a card to the end of another list and names both neighbours", () => {
    const plan = planCardDrop(start(), 12, 2, 1);
    expect(plan?.move).toEqual({ list_id: 2, after_id: 20, from_list_id: 1, from_after_id: 11 });
    expect(ids(plan!.next[1])).toEqual([10, 11]);
    expect(ids(plan!.next[2])).toEqual([20, 12]);
  });

  it("drops into an empty list with no anchor", () => {
    const plan = planCardDrop(start(), 11, 3, 0);
    expect(plan?.move).toEqual({ list_id: 3, after_id: null, from_list_id: 1, from_after_id: 10 });
    expect(ids(plan!.next[3])).toEqual([11]);
  });

  it("inserts in the middle of another list", () => {
    const by: ByList = { 1: [card(10, 1)], 2: [card(20, 2), card(21, 2), card(22, 2)] };
    const plan = planCardDrop(by, 10, 2, 2);
    expect(plan?.move.after_id).toBe(21);
    expect(ids(plan!.next[2])).toEqual([20, 21, 10, 22]);
  });

  it("adjusts the index when the card moves down inside its list", () => {
    // Index 3 is the end of 10, 11, 12; once 10 is lifted out the slot is index 2.
    const plan = planCardDrop(start(), 10, 1, 3);
    expect(plan?.move).toEqual({ list_id: 1, after_id: 12, from_list_id: 1, from_after_id: null });
    expect(ids(plan!.next[1])).toEqual([11, 12, 10]);
  });

  it("adjusts the index for a drop between two cards below the card", () => {
    const plan = planCardDrop(start(), 10, 1, 2);
    expect(plan?.move.after_id).toBe(11);
    expect(ids(plan!.next[1])).toEqual([11, 10, 12]);
  });

  it("does not adjust the index when the card moves up inside its list", () => {
    const plan = planCardDrop(start(), 12, 1, 0);
    expect(plan?.move).toEqual({ list_id: 1, after_id: null, from_list_id: 1, from_after_id: 11 });
    expect(ids(plan!.next[1])).toEqual([12, 10, 11]);
    const second = planCardDrop(start(), 12, 1, 1);
    expect(second?.move.after_id).toBe(10);
    expect(ids(second!.next[1])).toEqual([10, 12, 11]);
  });

  it("returns null for a drop that changes nothing", () => {
    // Before itself, and right after itself (the same slot once it is lifted out).
    expect(planCardDrop(start(), 11, 1, 1)).toBeNull();
    expect(planCardDrop(start(), 11, 1, 2)).toBeNull();
    expect(planCardDrop(start(), 10, 1, 0)).toBeNull();
    expect(planCardDrop(start(), 10, 1, 1)).toBeNull();
    expect(planCardDrop(start(), 12, 1, 3)).toBeNull();
    expect(planCardDrop(start(), 12, 1, 2)).toBeNull();
    expect(planCardDrop({ 1: [card(10, 1)], 2: [] }, 10, 1, 1)).toBeNull();
  });

  it("clamps an index outside the list", () => {
    expect(planCardDrop(start(), 10, 2, 99)?.move.after_id).toBe(20);
    expect(planCardDrop(start(), 10, 2, -5)?.move.after_id).toBeNull();
  });

  it("returns null for an unknown card or an unknown list", () => {
    expect(planCardDrop(start(), 99, 2, 0)).toBeNull();
    expect(planCardDrop(start(), 10, 9, 0)).toBeNull();
  });

  it("leaves the input grouping untouched", () => {
    const by = start();
    planCardDrop(by, 10, 2, 0);
    expect(by).toEqual(start());
  });
});

describe("revertCardMove", () => {
  it("puts a card back into its list after the neighbour it followed", () => {
    const plan = planCardDrop(start(), 11, 3, 0)!;
    expect(revertCardMove(plan.next, 11, 1, 10)).toEqual(start());
  });

  it("puts a card back to the front with a null anchor", () => {
    const plan = planCardDrop(start(), 10, 2, 1)!;
    expect(revertCardMove(plan.next, 10, 1, null)).toEqual(start());
  });

  it("reverts a move inside a list", () => {
    const plan = planCardDrop(start(), 10, 1, 3)!;
    expect(revertCardMove(plan.next, 10, 1, null)).toEqual(start());
  });

  it("keeps changes made meanwhile and appends when the anchor is gone", () => {
    const now: ByList = { 1: [card(11, 1)], 2: [card(20, 2), card(10, 2)], 3: [] };
    const next = revertCardMove(now, 10, 1, 77);
    expect(ids(next[1])).toEqual([11, 10]);
    expect(ids(next[2])).toEqual([20]);
    expect(next[1][1].list_id).toBe(1);
  });

  it("changes nothing when the card or the list is missing", () => {
    expect(revertCardMove(start(), 99, 1, null)).toEqual(start());
    expect(revertCardMove(start(), 10, 9, null)).toEqual(start());
  });
});

describe("placeCard", () => {
  it("moves a card to the place the server reports", () => {
    const next = placeCard(start(), card(10, 2), 20);
    expect(ids(next[1])).toEqual([11, 12]);
    expect(ids(next[2])).toEqual([20, 10]);
    expect(next[2][1].list_id).toBe(2);
  });

  it("puts the card first with a null anchor", () => {
    expect(ids(placeCard(start(), card(12, 2), null)[2])).toEqual([12, 20]);
  });

  it("works inside the same list", () => {
    expect(ids(placeCard(start(), card(10, 1), 11)[1])).toEqual([11, 10, 12]);
  });

  it("takes the server's copy of the card", () => {
    const next = placeCard(start(), card(10, 2, "Renamed"), null);
    expect(next[2][0].title).toBe("Renamed");
  });

  it("appends when the anchor is not in the list", () => {
    expect(ids(placeCard(start(), card(10, 2), 77)[2])).toEqual([20, 10]);
  });

  it("adds a card that was not loaded yet", () => {
    expect(ids(placeCard(start(), card(30, 3), null)[3])).toEqual([30]);
  });

  it("only removes the card when its new list is not loaded", () => {
    const next = placeCard(start(), card(10, 9), null);
    expect(ids(next[1])).toEqual([11, 12]);
    expect(next[9]).toBeUndefined();
  });

  it("leaves the input untouched", () => {
    const by = start();
    placeCard(by, card(10, 2), null);
    expect(by).toEqual(start());
  });
});

describe("canAddCard", () => {
  it("allows cards below the limit and refuses at it", () => {
    expect(CARD_LIMIT).toBe(1000);
    expect(canAddCard(0)).toBe(true);
    expect(canAddCard(999)).toBe(true);
    expect(canAddCard(1000)).toBe(false);
    expect(canAddCard(1001)).toBe(false);
  });
});

describe("shouldApply", () => {
  const cases: [number, number, number, boolean, boolean][] = [];
  for (const now of [4, 5]) {
    for (const pending of [0, 1]) {
      for (const dragging of [false, true]) {
        cases.push([4, now, pending, dragging, now === 4 && pending === 0 && !dragging]);
      }
    }
  }

  it.each(cases)(
    "start %i, now %i, pending %i, dragging %s gives %s",
    (startEpoch, now, pending, dragging, expected) => {
      expect(shouldApply(startEpoch, now, pending, dragging)).toBe(expected);
    },
  );
});

describe("oneLine", () => {
  it("turns line breaks into single spaces and trims", () => {
    expect(oneLine("  Pack\nboxes  ")).toBe("Pack boxes");
    expect(oneLine("a\r\nb")).toBe("a b");
    expect(oneLine("a\n\n\nb")).toBe("a b");
    expect(oneLine("a \n b")).toBe("a b");
  });

  it("keeps spaces inside a line and returns empty for blank text", () => {
    expect(oneLine("two  spaces")).toBe("two  spaces");
    expect(oneLine(" \n \n ")).toBe("");
  });
});

const full = (id: number, over: Partial<Card> = {}): Card => ({ ...card(id, 1), ...over });

describe("findByKey", () => {
  const cards = [card(1, 1), card(2, 1), card(12, 2)];

  it("finds a card by its exact key", () => {
    expect(findByKey(cards, "TB-2")?.id).toBe(2);
    expect(findByKey(cards, "TB-12")?.id).toBe(12);
  });

  it("is case-sensitive and never matches part of a key", () => {
    expect(findByKey(cards, "tb-2")).toBeNull();
    expect(findByKey(cards, "TB-1x")).toBeNull();
    expect(findByKey(cards, "TB-")).toBeNull();
    expect(findByKey(cards, "TB-2 ")).toBeNull();
    expect(findByKey(cards, "")).toBeNull();
    expect(findByKey(cards, "TB-99")).toBeNull();
  });
});

describe("tileOf", () => {
  it("drops the description and keeps every tile field", () => {
    const detail: CardDetail = {
      ...full(5, { label_ids: [1, 2], member_ids: [3], due_on: "2026-11-30", has_description: true }),
      description: "Hello",
    };
    expect(tileOf(detail)).toEqual({
      id: 5,
      key: "TB-5",
      list_id: 1,
      title: "Card 5",
      label_ids: [1, 2],
      member_ids: [3],
      due_on: "2026-11-30",
      has_description: true,
    });
  });
});

describe("insertAfterCard", () => {
  it("puts the new card right after its source", () => {
    const next = insertAfterCard([card(1, 1), card(2, 1), card(3, 2)], 1, card(9, 1));
    expect(ids(next)).toEqual([1, 9, 2, 3]);
  });

  it("appends when the source is not there", () => {
    expect(ids(insertAfterCard([card(1, 1)], 77, card(9, 1)))).toEqual([1, 9]);
  });

  it("does not add the same card twice", () => {
    const cards = [card(1, 1), card(9, 1)];
    expect(insertAfterCard(cards, 1, card(9, 1))).toBe(cards);
  });
});

describe("card fields", () => {
  it("names each field with its own key", () => {
    expect(fieldKey({ kind: "title", value: "x" })).toBe("title");
    expect(fieldKey({ kind: "due", value: null })).toBe("due");
    expect(fieldKey({ kind: "label", id: 3, on: true })).toBe("label:3");
    expect(fieldKey({ kind: "member", id: 5, on: false })).toBe("member:5");
  });

  it("sets the title and the due date", () => {
    expect(withField(full(1), { kind: "title", value: "New" }).title).toBe("New");
    expect(withField(full(1), { kind: "due", value: "2026-12-01" }).due_on).toBe("2026-12-01");
    expect(withField(full(1, { due_on: "2026-12-01" }), { kind: "due", value: null }).due_on).toBeNull();
  });

  it("adds and removes a label or a member without duplicates", () => {
    const c = full(1, { label_ids: [1], member_ids: [4] });
    expect(withField(c, { kind: "label", id: 2, on: true }).label_ids).toEqual([1, 2]);
    expect(withField(c, { kind: "label", id: 1, on: true }).label_ids).toEqual([1]);
    expect(withField(c, { kind: "label", id: 1, on: false }).label_ids).toEqual([]);
    expect(withField(c, { kind: "label", id: 9, on: false }).label_ids).toEqual([1]);
    expect(withField(c, { kind: "member", id: 5, on: true }).member_ids).toEqual([4, 5]);
    expect(withField(c, { kind: "member", id: 4, on: false }).member_ids).toEqual([]);
  });

  it("leaves the other fields and the input alone", () => {
    const c = full(1, { label_ids: [1], title: "Keep" });
    const next = withField(c, { kind: "due", value: "2026-12-01" });
    expect(next.title).toBe("Keep");
    expect(next.label_ids).toEqual([1]);
    expect(c.due_on).toBeNull();
  });

  it("reads the current value in the same shape", () => {
    const c = full(1, { title: "T", due_on: "2026-12-01", label_ids: [2], member_ids: [] });
    expect(readField(c, { kind: "title", value: "other" })).toEqual({ kind: "title", value: "T" });
    expect(readField(c, { kind: "due", value: null })).toEqual({ kind: "due", value: "2026-12-01" });
    expect(readField(c, { kind: "label", id: 2, on: false })).toEqual({ kind: "label", id: 2, on: true });
    expect(readField(c, { kind: "member", id: 7, on: true })).toEqual({ kind: "member", id: 7, on: false });
  });
});

describe("save tracker", () => {
  const title = (value: string) => ({ kind: "title", value }) as const;

  it("applies the server's value after a lone success", () => {
    const t = createSaveTracker();
    const n = t.start("title", title("A"));
    expect(t.settle("title", n, { ok: true, value: title("B") })).toEqual({
      kind: "apply",
      value: title("B"),
    });
  });

  it("goes back to the value before after a lone failure", () => {
    const t = createSaveTracker();
    const n = t.start("title", title("A"));
    expect(t.settle("title", n, { ok: false })).toEqual({ kind: "revert", value: title("A") });
  });

  it("ignores an older answer that arrives after a newer one", () => {
    const t = createSaveTracker();
    const first = t.start("title", title("A"));
    const second = t.start("title", title("B"));
    expect(t.settle("title", second, { ok: true, value: title("C") }).kind).toBe("apply");
    expect(t.settle("title", first, { ok: true, value: title("B") })).toEqual({ kind: "keep" });
  });

  it("ignores an older answer that arrives first", () => {
    const t = createSaveTracker();
    const first = t.start("title", title("A"));
    const second = t.start("title", title("B"));
    expect(t.settle("title", first, { ok: true, value: title("B") })).toEqual({ kind: "keep" });
    expect(t.settle("title", second, { ok: true, value: title("C") })).toEqual({
      kind: "apply",
      value: title("C"),
    });
  });

  it("does not undo a newer change when an older save fails", () => {
    const t = createSaveTracker();
    const first = t.start("title", title("A"));
    const second = t.start("title", title("B"));
    expect(t.settle("title", first, { ok: false })).toEqual({ kind: "keep" });
    expect(t.settle("title", second, { ok: true, value: title("C") }).kind).toBe("apply");
  });

  it("falls back to what the server last confirmed when the newest save fails", () => {
    const t = createSaveTracker();
    const first = t.start("title", title("A"));
    const second = t.start("title", title("B"));
    t.settle("title", first, { ok: true, value: title("B") });
    expect(t.settle("title", second, { ok: false })).toEqual({ kind: "revert", value: title("B") });
  });

  it("falls back to the original when every save fails", () => {
    const t = createSaveTracker();
    const first = t.start("title", title("A"));
    const second = t.start("title", title("B"));
    t.settle("title", first, { ok: false });
    expect(t.settle("title", second, { ok: false })).toEqual({ kind: "revert", value: title("A") });
  });

  it("starts a fresh chain once nothing is in flight", () => {
    const t = createSaveTracker();
    const first = t.start("title", title("A"));
    t.settle("title", first, { ok: true, value: title("B") });
    const second = t.start("title", title("B"));
    expect(t.settle("title", second, { ok: false })).toEqual({ kind: "revert", value: title("B") });
  });

  it("keeps fields apart", () => {
    const t = createSaveTracker();
    const a = t.start("label:1", { kind: "label", id: 1, on: false });
    const b = t.start("label:2", { kind: "label", id: 2, on: false });
    expect(t.settle("label:1", a, { ok: false }).kind).toBe("revert");
    expect(t.settle("label:2", b, { ok: true, value: { kind: "label", id: 2, on: true } }).kind).toBe(
      "apply",
    );
  });
});

describe("titleFrom", () => {
  it("joins lines and trims", () => {
    expect(titleFrom("  Pack\nboxes ")).toBe("Pack boxes");
  });

  it("refuses an empty title and one over 200 characters", () => {
    expect(titleFrom("  \n ")).toBeNull();
    expect(titleFrom("a".repeat(200))).toBe("a".repeat(200));
    expect(titleFrom("a".repeat(201))).toBeNull();
  });
});

describe("people for a card", () => {
  const person = (id: number, role: "owner" | "member" | "observer", name = `Person ${id}`) => ({
    id,
    role,
    name,
    email: `p${id}@example.com`,
  });

  it("leaves observers out of the picker", () => {
    const people = [person(1, "owner"), person(2, "member"), person(3, "observer")];
    expect(assignablePeople(people).map((p) => p.id)).toEqual([1, 2]);
  });

  it("shows the search box for 9 people, not for 8", () => {
    expect(showPeopleSearch(8)).toBe(false);
    expect(showPeopleSearch(9)).toBe(true);
    expect(showPeopleSearch(0)).toBe(false);
  });

  it("matches name or email, ignoring case and spaces around the query", () => {
    const people = [person(1, "owner", "Ann Lee"), person(2, "member", "Bo Tran")];
    expect(matchPeople(people, " ann ").map((p) => p.id)).toEqual([1]);
    expect(matchPeople(people, "P2@EXAMPLE").map((p) => p.id)).toEqual([2]);
    expect(matchPeople(people, "").map((p) => p.id)).toEqual([1, 2]);
    expect(matchPeople(people, "zzz")).toEqual([]);
  });

  it("matches people with no name by email", () => {
    const people = [{ id: 1, role: "member" as const, name: null, email: "kim@example.com" }];
    expect(matchPeople(people, "kim")).toHaveLength(1);
  });
});

describe("description draft", () => {
  it("allows 10,000 characters", () => {
    expect(DESCRIPTION_LIMIT).toBe(10000);
  });

  it("is dirty only when it differs from what the server has", () => {
    expect(draftDirty("Hello", "Hello")).toBe(false);
    expect(draftDirty("Hello", "Hello!")).toBe(true);
    expect(draftDirty(null, "")).toBe(false);
    expect(draftDirty(null, "x")).toBe(true);
  });

  it("sends null for blank text and the text as typed otherwise", () => {
    expect(descriptionToSend("  \n ")).toBeNull();
    expect(descriptionToSend("")).toBeNull();
    expect(descriptionToSend(" a\nb ")).toBe(" a\nb ");
  });
});

describe("escapeAction", () => {
  const base = { popup: false, typingInDraft: false, typing: false };

  it("closes a popup first, whatever else is going on", () => {
    expect(escapeAction({ popup: true, typingInDraft: true, typing: true })).toBe("close-popup");
  });

  it("cancels the description edit when typing in it", () => {
    expect(escapeAction({ ...base, typingInDraft: true, typing: true })).toBe("cancel-draft");
  });

  it("blurs any other field", () => {
    expect(escapeAction({ ...base, typing: true })).toBe("blur");
  });

  it("closes the dialog when nothing else is open", () => {
    expect(escapeAction(base)).toBe("close");
  });
});

describe("refetching the open card after a poll", () => {
  it("refetches only with the card open, no draft and no description save", () => {
    expect(shouldRefetchDetail({ open: true, draft: false, saving: false })).toBe(true);
    expect(shouldRefetchDetail({ open: true, draft: true, saving: false })).toBe(false);
    expect(shouldRefetchDetail({ open: true, draft: false, saving: true })).toBe(false);
    expect(shouldRefetchDetail({ open: false, draft: false, saving: false })).toBe(false);
  });

  const ok = { openId: 5, fetchedId: 5, draft: false, startVersion: 2, version: 2 };

  it("accepts an answer for the open card when nothing changed meanwhile", () => {
    expect(acceptDetail(ok)).toBe(true);
  });

  it("drops the answer when a draft was opened while it was out", () => {
    expect(acceptDetail({ ...ok, draft: true })).toBe(false);
  });

  it("drops the answer when the description changed or the card is another one", () => {
    expect(acceptDetail({ ...ok, version: 3 })).toBe(false);
    expect(acceptDetail({ ...ok, openId: 6 })).toBe(false);
    expect(acceptDetail({ ...ok, openId: null })).toBe(false);
  });
});
