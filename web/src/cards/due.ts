export type DueState = "over" | "soon" | null;

export const DUE_LABEL = { over: "Overdue", soon: "Due soon" } as const;

const DAY_MS = 86_400_000;

/** A YYYY-MM-DD day as local midnight; null when it is not a real calendar day. */
function localDay(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  // A year below 100 is read as 19xx, and 30 Feb rolls into March: neither is the day asked for.
  date.setFullYear(y);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

/**
 * True when `text` is a real YYYY-MM-DD day from 1970 on. A native date input reports 0002, 0020
 * and 0202 on the way to typing 2026, so an earlier year is never a day worth saving.
 */
export function isCommittableDay(text: string): boolean {
  const date = localDay(text);
  return date !== null && date.getFullYear() >= 1970;
}

/**
 * How a due day stands against today, both as calendar days in the viewer's own time zone: before
 * today is "over", today up to two days ahead is "soon", later (or no date) is none. A day is 23 or
 * 25 hours long where the clocks change, so the difference is rounded to whole days, not cut.
 */
export function dueState(dueOn: string | null, now: Date = new Date()): DueState {
  if (!dueOn) return null;
  const due = localDay(dueOn);
  if (!due) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((due.getTime() - today.getTime()) / DAY_MS);
  if (days < 0) return "over";
  if (days <= 2) return "soon";
  return null;
}

/** "8 Nov". An unreadable day is shown as it came. */
export function formatDue(dueOn: string): string {
  const date = localDay(dueOn);
  return date ? date.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : dueOn;
}

/** The words for a due chip: "Due 8 Nov", with ", overdue" or ", due soon" when it applies. */
export function dueTitle(dueOn: string, state: DueState): string {
  const base = `Due ${formatDue(dueOn)}`;
  if (state === "over") return `${base}, overdue`;
  if (state === "soon") return `${base}, due soon`;
  return base;
}
