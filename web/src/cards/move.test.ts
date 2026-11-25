import { describe, expect, it } from "vitest";

import type { Card, MoveResult } from "../api";
import { type MovePlan, applyMoveResult } from "./logic";

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

const lists = [
  { id: 1, name: "To do" },
  { id: 2, name: "Doing" },
  { id: 3, name: "Done" },
];

// The person dragged card 11 from after 10 in To do to after 20 in Doing; the screen shows that.
const onScreen: Card[] = [card(10, 1), card(12, 1), card(20, 2), card(11, 2), card(30, 3), card(31, 3)];

const plan: MovePlan = {
  cardId: 11,
  key: "TB-11",
  move: { list_id: 2, after_id: 20, from_list_id: 1, from_after_id: 10 },
};

describe("applyMoveResult", () => {
  it("keeps the server's copy and says where the card went on success", () => {
    const server = card(11, 2, "Server title");
    const out = applyMoveResult(onScreen, lists, plan, { kind: "ok", data: server });
    expect(out).toEqual({
      cards: [card(10, 1), card(12, 1), card(20, 2), server, card(30, 3), card(31, 3)],
      toast: "Moved TB-11 to Doing",
      reload: false,
    });
  });

  it("keeps the whole tile when the server's copy or a local revert replaces a card", () => {
    const rich: Card = {
      ...card(11, 2),
      label_ids: [1, 2],
      member_ids: [3],
      due_on: "2026-12-01",
      has_description: true,
    };
    const shown = onScreen.map((c) => (c.id === 11 ? { ...rich, list_id: 2 } : c));
    const ok = applyMoveResult(shown, lists, plan, { kind: "ok", data: rich });
    expect(ok.cards.find((c) => c.id === 11)).toEqual(rich);
    const moved = applyMoveResult(shown, lists, plan, {
      kind: "card_moved",
      card: { ...rich, list_id: 3 },
      after_id: null,
      moved_by: null,
    });
    expect(moved.cards.find((c) => c.id === 11)).toEqual({ ...rich, list_id: 3 });
    const failed = applyMoveResult(shown, lists, plan, { kind: "network" });
    expect(failed.cards.find((c) => c.id === 11)).toEqual({ ...rich, list_id: 1 });
  });

  it("names an unknown list on success", () => {
    const out = applyMoveResult(onScreen, [lists[0]], plan, { kind: "ok", data: card(11, 2) });
    expect(out.toast).toBe("Moved TB-11 to another list");
  });

  it("puts the card where the server has it after after_id, tells who moved it and reloads", () => {
    // Someone else put card 11 into Done, right after card 30.
    const result: MoveResult = {
      kind: "card_moved",
      card: card(11, 3),
      after_id: 30,
      moved_by: "Dana Lee",
    };
    const out = applyMoveResult(onScreen, lists, plan, result);
    expect(out).toEqual({
      cards: [card(10, 1), card(12, 1), card(20, 2), card(30, 3), card(11, 3), card(31, 3)],
      toast: "This card moved. Dana Lee put it in Done a moment ago; it is shown there now.",
      reload: true,
    });
  });

  it("puts the card first in its list when the server's after_id is null", () => {
    const result: MoveResult = { kind: "card_moved", card: card(11, 3), after_id: null, moved_by: null };
    const out = applyMoveResult(onScreen, lists, plan, result);
    expect(out).toEqual({
      cards: [card(10, 1), card(12, 1), card(20, 2), card(11, 3), card(30, 3), card(31, 3)],
      toast: "This card moved. Someone put it in Done a moment ago; it is shown there now.",
      reload: true,
    });
  });

  it("takes the card back and says so on a network failure", () => {
    const out = applyMoveResult(onScreen, lists, plan, { kind: "network" });
    expect(out).toEqual({
      cards: [card(10, 1), card(11, 1), card(12, 1), card(20, 2), card(30, 3), card(31, 3)],
      toast: "Can't reach Taskboard. Your change was undone.",
      reload: false,
    });
  });

  it("takes the card back on forbidden", () => {
    const out = applyMoveResult(onScreen, lists, plan, { kind: "forbidden" });
    expect(out.cards).toEqual([
      card(10, 1),
      card(11, 1),
      card(12, 1),
      card(20, 2),
      card(30, 3),
      card(31, 3),
    ]);
    expect(out.toast).toBe("You can no longer change the cards on this board.");
    expect(out.reload).toBe(false);
  });

  it("takes the card back to the top of its list when it had no neighbour", () => {
    const first: MovePlan = {
      cardId: 11,
      key: "TB-11",
      move: { list_id: 2, after_id: 20, from_list_id: 1, from_after_id: null },
    };
    const out = applyMoveResult(onScreen, lists, first, { kind: "server" });
    expect(out.cards).toEqual([
      card(11, 1),
      card(10, 1),
      card(12, 1),
      card(20, 2),
      card(30, 3),
      card(31, 3),
    ]);
    expect(out.toast).toBe("That did not go through. Your change was undone; try again.");
  });
});
