import { describe, expect, it } from "vitest";

import { LIST_LIMIT, arrange, canAddList, planDrop, revert } from "./logic";

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

describe("canAddList", () => {
  it("allows 49 lists and refuses 50", () => {
    expect(LIST_LIMIT).toBe(50);
    expect(canAddList(49)).toBe(true);
    expect(canAddList(50)).toBe(false);
    expect(canAddList(0)).toBe(true);
  });
});
