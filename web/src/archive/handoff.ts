/**
 * A toast that outlives the screen that asked for it. Archiving a board leaves for the Boards
 * screen, which shows "Archived {name}. Nothing is deleted." with Undo (restoring that board).
 */
export type Handoff = { text: string; undoBoardId: number };

let waiting: Handoff | null = null;

export function setHandoff(next: Handoff): void {
  waiting = next;
}

/** Returns the waiting toast once; the next call finds nothing. */
export function takeHandoff(): Handoff | null {
  const next = waiting;
  waiting = null;
  return next;
}
