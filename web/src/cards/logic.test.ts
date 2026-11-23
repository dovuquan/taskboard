import { describe, expect, it } from "vitest";

import type { Card } from "../api";
import {
  CARD_LIMIT,
  type ByList,
  canAddCard,
  groupByList,
  oneLine,
  placeCard,
  planCardDrop,
  revertCardMove,
  shouldApply,
  ungroup,
} from "./logic";

const card = (id: number, list_id: number, title = `Card ${id}`): Card => ({
  id,
  key: `TB-${id}`,
  list_id,
  title,
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
