import { describe, expect, it } from "vitest";

import {
  LIST_LIMIT,
  archiveIn,
  arrange,
  canAddList,
  planDrop,
  reinsertAt,
  renameIn,
  revert,
} from "./logic";

const order = [1, 2, 3, 4];

describe("planDrop", () => {
  it("moves a list to the front with after_id null", () => {
    expect(planDrop(order, 3, 0)).toEqual({ after_id: null, next: [3, 1, 2, 4] });
  });

  it("moves a list forward: dropping before index 3 puts it after the list now at 2", () => {
    // Dragging 1 (index 0) before the list at index 3 lands it between 3 and 4.
    expect(planDrop(order, 1, 3)).toEqual({ after_id: 3, next: [2, 3, 1, 4] });
  });

  it("moves a list backward into the middle", () => {
    expect(planDrop(order, 4, 1)).toEqual({ after_id: 1, next: [1, 4, 2, 3] });
  });

  it("moves a list to the end when the target is past the last one", () => {
    expect(planDrop(order, 1, 4)).toEqual({ after_id: 4, next: [2, 3, 4, 1] });
  });

  it("does nothing when the list is dropped where it already is", () => {
    expect(planDrop(order, 2, 1)).toBeNull();
    expect(planDrop(order, 2, 2)).toBeNull();
    expect(planDrop(order, 4, 4)).toBeNull();
    expect(planDrop(order, 1, 0)).toBeNull();
  });

  it("does nothing for a list that is not in the order", () => {
    expect(planDrop(order, 9, 0)).toBeNull();
  });

  it("does not change the input", () => {
    planDrop(order, 3, 0);
    expect(order).toEqual([1, 2, 3, 4]);
  });
});

describe("revert", () => {
  it("puts the moved list back at its old index", () => {
    const plan = planDrop(order, 3, 0);
    expect(revert(plan!.next, 3, 2)).toEqual(order);
  });

  it("only moves that list when others changed meanwhile", () => {
    expect(revert([3, 1, 5, 2, 4], 3, 2)).toEqual([1, 5, 3, 2, 4]);
  });
});

describe("arrange", () => {
  it("returns the items in the given id order", () => {
    const items = [
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ];
    expect(arrange(items, [2, 1])).toEqual([
      { id: 2, name: "b" },
      { id: 1, name: "a" },
    ]);
  });
});

const lanes = [
  { id: 1, name: "To do" },
  { id: 2, name: "Doing" },
  { id: 3, name: "Done" },
];

describe("renameIn", () => {
  it("renames the list when its name is still `from`", () => {
    expect(renameIn(lanes, 2, "Doing", "Active")).toEqual([
      { id: 1, name: "To do" },
      { id: 2, name: "Active" },
      { id: 3, name: "Done" },
    ]);
  });

  it("leaves the list alone when its name is no longer `from` (a later rename won)", () => {
    expect(renameIn(lanes, 2, "Other", "Active")).toEqual(lanes);
  });

  it("leaves everything alone for an unknown id", () => {
    expect(renameIn(lanes, 9, "Doing", "Active")).toEqual(lanes);
  });

  it("lets the server name replace the name the client sent", () => {
    const sent = renameIn(lanes, 2, "Doing", "New");
    expect(renameIn(sent, 2, "New", "Other")[1].name).toBe("Other");
  });
});

describe("archiveIn", () => {
  it("removes the list and reports where it was", () => {
    expect(archiveIn(lanes, 2)).toEqual({
      next: [lanes[0], lanes[2]],
      index: 1,
      list: lanes[1],
    });
  });

  it("returns null for an unknown id", () => {
    expect(archiveIn(lanes, 9)).toBeNull();
  });
});

describe("reinsertAt", () => {
  const rest = [lanes[0], lanes[2]];

  it("puts the list back at the front", () => {
    expect(reinsertAt(rest, lanes[1], 0)).toEqual([lanes[1], lanes[0], lanes[2]]);
  });

  it("puts the list back in the middle", () => {
    expect(reinsertAt(rest, lanes[1], 1)).toEqual(lanes);
  });

  it("puts the list back at the end", () => {
    expect(reinsertAt(rest, lanes[1], 2)).toEqual([lanes[0], lanes[2], lanes[1]]);
  });

  it("clamps an index past the end", () => {
    expect(reinsertAt(rest, lanes[1], 7)).toEqual([lanes[0], lanes[2], lanes[1]]);
  });

  it("adds no duplicate when the list is already there", () => {
    expect(reinsertAt(lanes, lanes[1], 0)).toEqual(lanes);
  });
});

describe("canAddList", () => {
  it("allows 49 lists and refuses 50", () => {
    expect(LIST_LIMIT).toBe(50);
    expect(canAddList(49)).toBe(true);
    expect(canAddList(50)).toBe(false);
    expect(canAddList(0)).toBe(true);
  });
});
