import { describe, expect, it } from "vitest";

import type { Card, CardDetail } from "../api";
import {
  CARD_LIMIT,
  type ByList,
  DESCRIPTION_LIMIT,
  type DraftEntry,
  EXPIRED_KEPT_TEXT,
  lastTileOf,
  rememberTile,
  acceptDetail,
  anyDirty,
  assignablePeople,
  canAddCard,
  closeAction,
  createSaveTracker,
  descriptionToSend,
  dialogCard,
  draftDirty,
  draftForKey,
  draftMode,
  draftsReducer,
  escapeAction,
  expiredAction,
  fieldKey,
  findByKey,
  groupByList,
  insertAfterCard,
  keepForcedGone,
  keptOnLeave,
  matchPeople,
  oneLine,
  placeCard,
  planCardDrop,
  readField,
  revertCardMove,
  sameField,
  shouldApply,
  shouldRefetchDetail,
  showPeopleSearch,
  tileOf,
  titleBoxHeight,
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
  it("names each field of each card with its own key", () => {
    expect(fieldKey(7, { kind: "title", value: "x" })).toBe("7:title");
    expect(fieldKey(7, { kind: "due", value: null })).toBe("7:due");
    expect(fieldKey(7, { kind: "label", id: 3, on: true })).toBe("7:label:3");
    expect(fieldKey(7, { kind: "member", id: 5, on: false })).toBe("7:member:5");
    expect(fieldKey(8, { kind: "title", value: "x" })).not.toBe(fieldKey(7, { kind: "title", value: "x" }));
  });

  it("tells equal values apart from different ones", () => {
    expect(sameField({ kind: "title", value: "a" }, { kind: "title", value: "a" })).toBe(true);
    expect(sameField({ kind: "title", value: "a" }, { kind: "title", value: "b" })).toBe(false);
    expect(sameField({ kind: "label", id: 1, on: true }, { kind: "label", id: 1, on: false })).toBe(false);
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

  const label = (on: boolean) => ({ kind: "label", id: 1, on }) as const;
  const KEY = "5:title";

  it("sends the first save at once and applies the server's value after it", () => {
    const t = createSaveTracker();
    expect(t.request(KEY, title("A"), title("B"))).toEqual(title("B"));
    expect(t.settle(KEY, { ok: true, value: title("B!") })).toEqual({
      screen: { kind: "apply", value: title("B!") },
      next: null,
    });
  });

  it("goes back to the value before after a lone failure", () => {
    const t = createSaveTracker();
    t.request(KEY, title("A"), title("B"));
    expect(t.settle(KEY, { ok: false })).toEqual({
      screen: { kind: "revert", value: title("A") },
      next: null,
    });
  });

  it("holds a second save until the first has answered, then sends it", () => {
    const t = createSaveTracker();
    t.request(KEY, title("A"), title("B"));
    expect(t.request(KEY, title("B"), title("C"))).toBeNull();
    const first = t.settle(KEY, { ok: true, value: title("B") });
    expect(first).toEqual({ screen: { kind: "keep" }, next: title("C") });
    expect(t.settle(KEY, { ok: true, value: title("C") })).toEqual({
      screen: { kind: "apply", value: title("C") },
      next: null,
    });
  });

  it("sends only the newest of several waiting saves", () => {
    const t = createSaveTracker();
    t.request(KEY, title("A"), title("B"));
    t.request(KEY, title("B"), title("C"));
    t.request(KEY, title("C"), title("D"));
    expect(t.settle(KEY, { ok: true, value: title("B") }).next).toEqual(title("D"));
  });

  it("falls back to what the server confirmed when the follow-up save fails", () => {
    const t = createSaveTracker();
    t.request(KEY, title("A"), title("B"));
    t.request(KEY, title("B"), title("C"));
    t.settle(KEY, { ok: true, value: title("B") });
    expect(t.settle(KEY, { ok: false })).toEqual({
      screen: { kind: "revert", value: title("B") },
      next: null,
    });
  });

  it("takes everything back and sends nothing more when the first save fails", () => {
    const t = createSaveTracker();
    t.request(KEY, title("A"), title("B"));
    t.request(KEY, title("B"), title("C"));
    expect(t.settle(KEY, { ok: false })).toEqual({
      screen: { kind: "revert", value: title("A") },
      next: null,
    });
    // The chain is over: the next change starts a new one from what is on screen.
    expect(t.request(KEY, title("A"), title("E"))).toEqual(title("E"));
  });

  it("sends nothing when quick toggles end where the server already is", () => {
    const t = createSaveTracker();
    const key = "5:label:1";
    expect(t.request(key, label(false), label(true))).toEqual(label(true));
    expect(t.request(key, label(true), label(false))).toBeNull();
    expect(t.request(key, label(false), label(true))).toBeNull();
    expect(t.settle(key, { ok: true, value: label(true) })).toEqual({
      screen: { kind: "apply", value: label(true) },
      next: null,
    });
  });

  it("sends the last toggle when it differs from what the server confirmed", () => {
    const t = createSaveTracker();
    const key = "5:label:1";
    t.request(key, label(false), label(true));
    t.request(key, label(true), label(false));
    expect(t.settle(key, { ok: true, value: label(true) })).toEqual({
      screen: { kind: "keep" },
      next: label(false),
    });
    expect(t.settle(key, { ok: true, value: label(false) }).screen).toEqual({
      kind: "apply",
      value: label(false),
    });
  });

  it("starts a fresh chain once nothing is in flight", () => {
    const t = createSaveTracker();
    t.request(KEY, title("A"), title("B"));
    t.settle(KEY, { ok: true, value: title("B") });
    expect(t.request(KEY, title("B"), title("C"))).toEqual(title("C"));
    expect(t.settle(KEY, { ok: false }).screen).toEqual({ kind: "revert", value: title("B") });
  });

  it("keeps fields apart", () => {
    const t = createSaveTracker();
    t.request("5:label:1", label(false), label(true));
    t.request("5:label:2", { kind: "label", id: 2, on: false }, { kind: "label", id: 2, on: true });
    expect(t.settle("5:label:1", { ok: false }).screen.kind).toBe("revert");
    expect(
      t.settle("5:label:2", { ok: true, value: { kind: "label", id: 2, on: true } }).screen.kind,
    ).toBe("apply");
  });

  it("keeps two cards apart: a slow rename of A does not hold up or overwrite B", () => {
    const t = createSaveTracker();
    const a = fieldKey(1, title("A1"));
    const b = fieldKey(2, title("B1"));
    expect(t.request(a, title("A0"), title("A1"))).toEqual(title("A1"));
    // A is still out when B is renamed: B goes straight out, it does not queue behind A.
    expect(t.request(b, title("B0"), title("B1"))).toEqual(title("B1"));
    expect(t.settle(b, { ok: true, value: title("B1") })).toEqual({
      screen: { kind: "apply", value: title("B1") },
      next: null,
    });
    expect(t.settle(a, { ok: true, value: title("A1") })).toEqual({
      screen: { kind: "apply", value: title("A1") },
      next: null,
    });
  });

  it("does not say 'undone' when the screen already shows the confirmed value", () => {
    const t = createSaveTracker();
    const key = "5:label:1";
    t.request(key, label(false), label(true));
    t.request(key, label(true), label(false));
    expect(t.settle(key, { ok: false })).toEqual({ screen: { kind: "keep" }, next: null });
    // The chain is over: the next change starts a new one.
    expect(t.request(key, label(false), label(true))).toEqual(label(true));
  });

  it("still says 'undone' when the newest waiting value differs from the confirmed one", () => {
    const t = createSaveTracker();
    const key = "5:label:1";
    t.request(key, label(false), label(true));
    t.request(key, label(true), label(false));
    t.request(key, label(false), label(true));
    expect(t.settle(key, { ok: false }).screen).toEqual({ kind: "revert", value: label(false) });
  });

  it("says keep, and sends nothing, for an answer nobody is waiting for", () => {
    const t = createSaveTracker();
    expect(t.settle("9:title", { ok: false })).toEqual({ screen: { kind: "keep" }, next: null });
  });
});

describe("description drafts", () => {
  const entry = (id: number, text = "", original: string | null = null): DraftEntry => ({
    key: `TB-${id}`,
    id,
    text,
    original,
  });

  it("keeps a draft per card: starting B does not touch A, and A comes back when reopened", () => {
    let d = draftsReducer({}, { type: "start", entry: entry(1, "words of A") });
    d = draftsReducer(d, { type: "change", id: 1, text: "words of A, more" });
    d = draftsReducer(d, { type: "start", entry: entry(2, "") });
    expect(d[1].text).toBe("words of A, more");
    expect(d[2]).toBeDefined();
    expect(draftForKey(d, "TB-1")?.text).toBe("words of A, more");
    expect(draftForKey(d, "TB-3")).toBeUndefined();
  });

  it("does not overwrite a draft that already exists for the card", () => {
    const d = draftsReducer({ 1: entry(1, "mine") }, { type: "start", entry: entry(1, "", null) });
    expect(d[1].text).toBe("mine");
  });

  it("changes only the text of the named card, and ignores a card without a draft", () => {
    const start = { 1: entry(1, "a"), 2: entry(2, "b") };
    const d = draftsReducer(start, { type: "change", id: 2, text: "bb" });
    expect(d[1].text).toBe("a");
    expect(d[2].text).toBe("bb");
    expect(draftsReducer(start, { type: "change", id: 9, text: "x" })).toBe(start);
  });

  it("cancel discards the draft, except while its save is out", () => {
    const start = { 1: entry(1, "a"), 2: entry(2, "b") };
    expect(draftsReducer(start, { type: "cancel", id: 1, saving: false })).toEqual({ 2: entry(2, "b") });
    expect(draftsReducer(start, { type: "cancel", id: 1, saving: true })).toBe(start);
  });

  it("drop removes the draft of a saved card or one that is gone", () => {
    expect(draftsReducer({ 1: entry(1, "a"), 2: entry(2, "b") }, { type: "drop", id: 2 })).toEqual({
      1: entry(1, "a"),
    });
  });

  it("closing a card drops only a clean draft of that card", () => {
    const start = { 1: entry(1, "a", "a"), 2: entry(2, "typed", null), 3: entry(3, "x", "x") };
    expect(draftsReducer(start, { type: "close", id: 1 })).toEqual({ 2: start[2], 3: start[3] });
    expect(draftsReducer(start, { type: "close", id: 2 })).toBe(start);
  });

  it("closing the 'isn't on the board' dialog deletes nobody's draft", () => {
    const start = { 1: entry(1, "typed", null), 2: entry(2, "also typed", null) };
    expect(draftsReducer(start, { type: "close", id: null })).toBe(start);
  });

  it("leaving a card by address drops a clean draft and keeps a dirty one", () => {
    const start = { 1: entry(1, "a", "a"), 2: entry(2, "typed", null) };
    expect(draftsReducer(start, { type: "leave", key: "TB-1" })).toEqual({ 2: start[2] });
    expect(draftsReducer(start, { type: "leave", key: "TB-2" })).toBe(start);
    expect(draftsReducer(start, { type: "leave", key: "TB-9" })).toBe(start);
  });

  it("says whether leaving a card keeps text worth telling about", () => {
    const start = { 1: entry(1, "a", "a"), 2: entry(2, "typed", null) };
    expect(keptOnLeave(start, "TB-2")).toBe(true);
    expect(keptOnLeave(start, "TB-1")).toBe(false);
    expect(keptOnLeave(start, "TB-9")).toBe(false);
  });

  it("knows when any draft has unsaved text", () => {
    expect(anyDirty({})).toBe(false);
    expect(anyDirty({ 1: entry(1, "a", "a") })).toBe(false);
    expect(anyDirty({ 1: entry(1, "a", "a"), 2: entry(2, "typed", null) })).toBe(true);
  });

  it("shows a draft read-only, with no way to save it, once the person cannot edit", () => {
    expect(draftMode(true, entry(1, "x"))).toBe("edit");
    expect(draftMode(false, entry(1, "x"))).toBe("readonly");
    expect(draftMode(true, undefined)).toBe("none");
    expect(draftMode(false, undefined)).toBe("none");
  });

  it("lets a person who cannot edit close the dialog even with unsaved text", () => {
    const dirty = entry(1, "typed", null);
    expect(closeAction(true, dirty)).toBe("blocked");
    expect(closeAction(false, dirty)).toBe("close");
    expect(closeAction(true, entry(1, "a", "a"))).toBe("close");
    expect(closeAction(true, undefined)).toBe("close");
  });

  it("does not reload on an ended session while any draft has unsaved text", () => {
    expect(expiredAction(anyDirty({}))).toBe("reload");
    expect(expiredAction(anyDirty({ 1: entry(1, "a", "a") }))).toBe("reload");
    expect(expiredAction(anyDirty({ 2: entry(2, "typed", null) }))).toBe("keep");
  });

  it("words the toast so it is true with the dialog closed", () => {
    expect(EXPIRED_KEPT_TEXT).toContain("kept in memory");
    expect(EXPIRED_KEPT_TEXT).toContain("open its card");
    expect(EXPIRED_KEPT_TEXT).toContain("reload the page");
    expect(EXPIRED_KEPT_TEXT).not.toContain("in its box");
  });
});

describe("which card the dialog shows", () => {
  const draft: DraftEntry = { key: "TB-3", id: 3, text: "typed", original: null };
  const three = full(3);
  const other = full(4);

  it("shows the card that is on the board", () => {
    expect(dialogCard({ cardKey: "TB-3", found: three, last: three, draft: undefined, forcedGone: null })).toEqual({
      tile: three,
      stale: false,
    });
  });

  it("shows nothing for a card that is not there and has no draft", () => {
    expect(dialogCard({ cardKey: "TB-3", found: null, last: three, draft: undefined, forcedGone: null })).toEqual({
      tile: null,
      stale: false,
    });
  });

  it("keeps the dialog, marked stale, when a draft outlives its card", () => {
    expect(dialogCard({ cardKey: "TB-3", found: null, last: three, draft, forcedGone: null })).toEqual({
      tile: three,
      stale: true,
    });
  });

  it("does not use the last card of another key to keep a draft", () => {
    expect(dialogCard({ cardKey: "TB-3", found: null, last: other, draft, forcedGone: null })).toEqual({
      tile: null,
      stale: false,
    });
  });

  it("shows 'isn't on the board' once the server said the card is gone", () => {
    expect(dialogCard({ cardKey: "TB-3", found: three, last: three, draft, forcedGone: "TB-3" })).toEqual({
      tile: null,
      stale: false,
    });
  });

  it("keeps one tile per card, so each draft finds its own card again", () => {
    const a = full(3);
    const b = full(4);
    const tiles = rememberTile(rememberTile({}, a), b);
    // Draft on A, Back, open B, A is archived, back to A's address: A's own tile, not B's.
    expect(lastTileOf(tiles, "TB-3")).toBe(a);
    expect(dialogCard({ cardKey: "TB-3", found: null, last: lastTileOf(tiles, "TB-3"), draft, forcedGone: null })).toEqual({
      tile: a,
      stale: true,
    });
    expect(lastTileOf(tiles, "TB-9")).toBeNull();
    expect(lastTileOf(tiles, null)).toBeNull();
  });

  it("keeps the same tiles object when nothing is new", () => {
    const a = full(3);
    const tiles = rememberTile({}, a);
    expect(rememberTile(tiles, a)).toBe(tiles);
    expect(rememberTile(tiles, null)).toBe(tiles);
  });

  it("ignores a 'gone' mark that belongs to another key", () => {
    expect(dialogCard({ cardKey: "TB-3", found: three, last: three, draft: undefined, forcedGone: "TB-9" }).tile).toBe(
      three,
    );
  });
});

describe("forced gone mark", () => {
  it("stays while the same card is open and the snapshot still lacks it", () => {
    expect(keepForcedGone("TB-3", "TB-3", false)).toBe("TB-3");
  });

  it("clears when the address moves to another card or to none", () => {
    expect(keepForcedGone("TB-3", "TB-4", false)).toBeNull();
    expect(keepForcedGone("TB-3", null, false)).toBeNull();
  });

  it("clears when a later snapshot contains the card again", () => {
    expect(keepForcedGone("TB-3", "TB-3", true)).toBeNull();
  });

  it("stays clear when nothing was marked", () => {
    expect(keepForcedGone(null, "TB-3", true)).toBeNull();
  });
});

describe("title box height", () => {
  it("adds the borders the scroll height leaves out", () => {
    // 188 of content and padding plus a 1px border on each side: the box must be 190 tall.
    expect(titleBoxHeight({ scrollHeight: 188, offsetHeight: 186 + 2, clientHeight: 186 })).toBe(190);
    expect(titleBoxHeight({ scrollHeight: 40, offsetHeight: 40, clientHeight: 40 })).toBe(40);
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
