import type { ChecklistItem } from "../api";
import { oneLine } from "./logic";

/** The list shows this many items until the person asks for all of them. */
export const ITEMS_FIRST = 6;

export type Progress = { done: number; total: number; percent: number };

export function progress(items: ChecklistItem[]): Progress {
  const total = items.length;
  const done = items.filter((i) => i.done).length;
  return { done, total, percent: total === 0 ? 0 : Math.round((done * 100) / total) };
}

/** "2/5 · 40%". */
export function progressText(items: ChecklistItem[]): string {
  const p = progress(items);
  return `${p.done}/${p.total} · ${p.percent}%`;
}

/** The two numbers a card tile shows. */
export function countsOf(items: ChecklistItem[]): { checklist_done: number; checklist_total: number } {
  const p = progress(items);
  return { checklist_done: p.done, checklist_total: p.total };
}

export type ListView = {
  /** The items to draw. */
  shown: ChecklistItem[];
  /** How many items pass the "hide checked" filter. */
  visible: number;
  /** More items pass the filter than the first six. */
  canExpand: boolean;
  /** Items exist, all are checked, and the filter hides them all. */
  allChecked: boolean;
};

/** What the list draws: checked items may be hidden, and only the first six show until expanded. */
export function listView(items: ChecklistItem[], hideChecked: boolean, showAll: boolean): ListView {
  const passing = hideChecked ? items.filter((i) => !i.done) : items;
  return {
    shown: showAll ? passing : passing.slice(0, ITEMS_FIRST),
    visible: passing.length,
    canExpand: passing.length > ITEMS_FIRST,
    allChecked: hideChecked && items.length > 0 && passing.length === 0,
  };
}

export const hideButtonText = (hidden: boolean, done: number): string =>
  hidden ? `Show checked items (${done})` : "Hide checked items";

/** An item as it is saved: one line, trimmed, 1 to 200 characters; null if it cannot be saved. */
export function itemTextFrom(raw: string): string | null {
  const text = oneLine(raw);
  return text !== "" && text.length <= 200 ? text : null;
}

export function withDone(items: ChecklistItem[], id: number, done: boolean): ChecklistItem[] {
  return items.map((i) => (i.id === id ? { ...i, done } : i));
}

export function withoutItem(items: ChecklistItem[], id: number): ChecklistItem[] {
  return items.filter((i) => i.id !== id);
}
