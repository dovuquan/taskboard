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

/** The items in the order given by `ids`; items missing from `ids` are dropped. */
export function arrange<T extends { id: number }>(items: T[], ids: number[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return ids.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
}
