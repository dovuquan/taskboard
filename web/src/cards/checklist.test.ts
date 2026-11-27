import { describe, expect, it } from "vitest";

import type { ChecklistItem } from "../api";
import {
  ITEMS_FIRST,
  countsOf,
  hideButtonText,
  itemTextFrom,
  listView,
  progress,
  progressText,
  settleDelete,
  settleToggle,
  withDone,
  withItemAt,
  withoutItem,
} from "./checklist";

const items = (done: boolean[]): ChecklistItem[] =>
  done.map((d, i) => ({ id: i + 1, text: `Item ${i + 1}`, done: d }));

describe("progress", () => {
  it("counts done items and rounds the percentage", () => {
    expect(progress(items([true, true, false, false, false]))).toEqual({ done: 2, total: 5, percent: 40 });
    expect(progress(items([true, false, false]))).toEqual({ done: 1, total: 3, percent: 33 });
    expect(progress(items([true, true, false]))).toEqual({ done: 2, total: 3, percent: 67 });
  });

  it("is 0 of 0 and 0 % for an empty list", () => {
    expect(progress([])).toEqual({ done: 0, total: 0, percent: 0 });
  });

  it("reads 2/5 · 40 %", () => {
    expect(progressText(items([true, true, false, false, false]))).toBe("2/5 · 40%");
    expect(progressText(items([true, true]))).toBe("2/2 · 100%");
  });

  it("gives the counts the tile shows", () => {
    expect(countsOf(items([true, false, true]))).toEqual({ checklist_done: 2, checklist_total: 3 });
  });
});

describe("listView", () => {
  const nine = items([true, false, false, false, false, false, false, false, true]);

  it("shows the first six items and offers the rest", () => {
    expect(ITEMS_FIRST).toBe(6);
    const view = listView(nine, false, false);
    expect(view.shown.map((i) => i.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(view.visible).toBe(9);
    expect(view.canExpand).toBe(true);
  });

  it("shows all of them when asked", () => {
    expect(listView(nine, false, true).shown).toHaveLength(9);
  });

  it("offers nothing to expand at six items or fewer", () => {
    expect(listView(items([false, false, false, false, false, false]), false, false).canExpand).toBe(false);
  });

  it("hides checked items, and counts the unchecked ones for the six", () => {
    const view = listView(nine, true, false);
    expect(view.shown.map((i) => i.id)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(view.visible).toBe(7);
    expect(view.canExpand).toBe(true);
  });

  it("says everything is checked when nothing is left to show", () => {
    const view = listView(items([true, true]), true, false);
    expect(view.shown).toEqual([]);
    expect(view.allChecked).toBe(true);
  });

  it("does not say everything is checked while items show or the list is empty", () => {
    expect(listView(items([true, true]), false, false).allChecked).toBe(false);
    expect(listView(items([true, false]), true, false).allChecked).toBe(false);
    expect(listView([], true, false).allChecked).toBe(false);
  });
});

describe("hideButtonText", () => {
  it("offers to hide, or to show the checked items with their count", () => {
    expect(hideButtonText(false, 2)).toBe("Hide checked items");
    expect(hideButtonText(true, 2)).toBe("Show checked items (2)");
  });
});

describe("itemTextFrom", () => {
  it("trims the text and turns line breaks into spaces", () => {
    expect(itemTextFrom("  Buy tape \n now ")).toBe("Buy tape now");
  });

  it("refuses blank text and more than 200 characters", () => {
    expect(itemTextFrom("   ")).toBeNull();
    expect(itemTextFrom("a".repeat(200))).toBe("a".repeat(200));
    expect(itemTextFrom("a".repeat(201))).toBeNull();
  });
});

describe("changing the items", () => {
  it("sets done on one item and leaves the others and the order alone", () => {
    const next = withDone(items([false, false]), 2, true);
    expect(next.map((i) => i.done)).toEqual([false, true]);
  });

  it("removes one item", () => {
    expect(withoutItem(items([false, true, false]), 2).map((i) => i.id)).toEqual([1, 3]);
  });

  it("puts an item back at its old place, once, or at the end if the list got shorter", () => {
    const all = items([false, true, false]);
    const gone = withoutItem(all, 2);
    expect(withItemAt(gone, all[1], 1)).toEqual(all);
    expect(withItemAt(all, all[1], 1)).toBe(all);
    expect(withItemAt(gone, all[1], 9).map((i) => i.id)).toEqual([1, 3, 2]);
  });
});

describe("settling a save", () => {
  it("keeps a check the server took", () => {
    const checked = withDone(items([false, false]), 1, true);
    expect(settleToggle(checked, 1, false, true)).toBe(checked);
  });

  it("puts a check the server refused back", () => {
    const checked = withDone(items([false, false]), 1, true);
    expect(settleToggle(checked, 1, false, false).map((i) => i.done)).toEqual([false, false]);
    const unchecked = withDone(items([true, true]), 2, false);
    expect(settleToggle(unchecked, 2, true, false).map((i) => i.done)).toEqual([true, true]);
  });

  it("puts a refused delete back where it was, and leaves a gone item gone", () => {
    const all = items([false, true, false]);
    const gone = withoutItem(all, 2);
    expect(settleDelete(gone, all[1], 1, true)).toEqual(all);
    expect(settleDelete(gone, all[1], 1, false)).toBe(gone);
  });
});
