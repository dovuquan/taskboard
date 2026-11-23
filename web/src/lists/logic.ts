export const LIST_LIMIT = 50;

/** True while the board can take another active list. */
export function canAddList(count: number): boolean {
  return count < LIST_LIMIT;
}

export type Drop = { after_id: number | null; next: number[] };

/**
 * What dropping list `dragId` before the list at `targetIndex` does (`order.length` means the
 * end). Returns the anchor for the server and the new order, or null when nothing moves.
 */
export function planDrop(order: number[], dragId: number, targetIndex: number): Drop | null {
  const from = order.indexOf(dragId);
  if (from < 0) return null;
  let to = targetIndex;
  if (from < to) to -= 1;
  if (to === from) return null;
  const next = order.filter((id) => id !== dragId);
  next.splice(to, 0, dragId);
  return { after_id: to === 0 ? null : next[to - 1], next };
}

/** Puts `dragId` back at index `from`, leaving every other list where it is now. */
export function revert(order: number[], dragId: number, from: number): number[] {
  const next = order.filter((id) => id !== dragId);
  next.splice(Math.min(from, next.length), 0, dragId);
  return next;
}

/** Renames list `id` to `to`, but only while its name is still `from`. */
export function renameIn<T extends { id: number; name: string }>(
  lists: T[],
  id: number,
  from: string,
  to: string,
): T[] {
  return lists.map((l) => (l.id === id && l.name === from ? { ...l, name: to } : l));
}

/** Removes list `id`; returns the rest, where it was and the list, or null if it is not there. */
export function archiveIn<T extends { id: number }>(
  lists: T[],
  id: number,
): { next: T[]; index: number; list: T } | null {
  const index = lists.findIndex((l) => l.id === id);
  if (index < 0) return null;
  return { next: lists.filter((l) => l.id !== id), index, list: lists[index] };
}

/** Puts `list` back at `index` (clamped to the end); no change if it is already present. */
export function reinsertAt<T extends { id: number }>(lists: T[], list: T, index: number): T[] {
  if (lists.some((l) => l.id === list.id)) return lists;
  const at = Math.max(0, Math.min(index, lists.length));
  return [...lists.slice(0, at), list, ...lists.slice(at)];
}

/** The items in the order given by `ids`; items missing from `ids` are dropped. */
export function arrange<T extends { id: number }>(items: T[], ids: number[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return ids.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
}
