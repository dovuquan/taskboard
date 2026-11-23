import type { Card, CardMove, MoveResult } from "../api";
import { CARD_LIMIT } from "./limit";
import { cardFailureText, cardMovedText, movedCardText } from "./text";

export { CARD_LIMIT };

/** True while the board can take another card. */
export function canAddCard(total: number): boolean {
  return total < CARD_LIMIT;
}

/** The cards of each loaded list, in order, by list id. */
export type ByList = Record<number, Card[]>;

/** Groups `cards` by list, keeping their order; cards of lists not in `lists` are dropped. */
export function groupByList(lists: { id: number }[], cards: Card[]): ByList {
  const grouped: ByList = {};
  for (const list of lists) grouped[list.id] = [];
  for (const card of cards) grouped[card.list_id]?.push(card);
  return grouped;
}

/** Every card of the grouping in one array (the inverse of `groupByList`). */
export function ungroup(byList: ByList): Card[] {
  return Object.values(byList).flat();
}

function without(byList: ByList, cardId: number): ByList {
  const next: ByList = {};
  for (const [id, cards] of Object.entries(byList)) {
    next[Number(id)] = cards.filter((c) => c.id !== cardId);
  }
  return next;
}

function find(byList: ByList, cardId: number): Card | null {
  for (const cards of Object.values(byList)) {
    const card = cards.find((c) => c.id === cardId);
    if (card) return card;
  }
  return null;
}

/** Puts `card` into its list after `afterId` (null = first; an unknown anchor = last). */
function insertAfter(byList: ByList, card: Card, afterId: number | null): ByList {
  const cards = byList[card.list_id];
  if (!cards) return byList;
  let at = 0;
  if (afterId !== null) {
    const anchor = cards.findIndex((c) => c.id === afterId);
    at = anchor < 0 ? cards.length : anchor + 1;
  }
  return { ...byList, [card.list_id]: [...cards.slice(0, at), card, ...cards.slice(at)] };
}

export type CardDrop = { move: CardMove; next: ByList };

/**
 * What dropping card `cardId` before the card at `index` of list `toListId` does (`index` equal to
 * the list length means the end). Returns what to send and the new grouping, or null when nothing
 * moves. Inside one list a drop below the card counts one slot less, since the card leaves first.
 */
export function planCardDrop(
  byList: ByList,
  cardId: number,
  toListId: number,
  index: number,
): CardDrop | null {
  const card = find(byList, cardId);
  const target = byList[toListId];
  if (!card || !target) return null;
  const fromListId = card.list_id;
  const source = byList[fromListId] ?? [];
  const from = source.findIndex((c) => c.id === cardId);
  const fromAfterId = from > 0 ? source[from - 1].id : null;

  let to = Math.max(0, Math.min(index, target.length));
  if (fromListId === toListId && from < to) to -= 1;
  if (fromListId === toListId && to === from) return null;

  const rest = without(byList, cardId);
  const landing = rest[toListId];
  const afterId = to > 0 ? landing[to - 1].id : null;
  const moved: Card = { ...card, list_id: toListId };
  const next = { ...rest, [toListId]: [...landing.slice(0, to), moved, ...landing.slice(to)] };
  return {
    move: { list_id: toListId, after_id: afterId, from_list_id: fromListId, from_after_id: fromAfterId },
    next,
  };
}

/** Takes a card back to the list it came from, after the neighbour it followed. */
export function revertCardMove(
  byList: ByList,
  cardId: number,
  fromListId: number,
  fromAfterId: number | null,
): ByList {
  const card = find(byList, cardId);
  if (!card || !byList[fromListId]) return byList;
  return insertAfter(without(byList, cardId), { ...card, list_id: fromListId }, fromAfterId);
}

/** Puts the server's copy of `card` where the server says it is now. */
export function placeCard(byList: ByList, card: Card, afterId: number | null): ByList {
  return insertAfter(without(byList, card.id), card, afterId);
}

/** A card drop that was sent to the server: which card, its key, and what was asked. */
export type MovePlan = { cardId: number; key: string; move: CardMove };

export type MoveOutcome = {
  cards: Card[];
  /** What to tell the person. For a failure it is the "undone" text; the caller decides to show it. */
  toast: string;
  /** True when the screen should be reloaded to catch up with the server. */
  reload: boolean;
};

/**
 * What the server's answer to a card drop does to the cards on screen (`cards` already show the
 * drop). Success keeps the server's copy; "moved" puts the card where the server has it; any other
 * failure takes the card back to where it came from.
 */
export function applyMoveResult(
  cards: Card[],
  lists: { id: number; name: string }[],
  plan: MovePlan,
  result: MoveResult,
): MoveOutcome {
  const listName = (id: number) => lists.find((l) => l.id === id)?.name ?? "another list";
  if (result.kind === "ok") {
    return {
      cards: cards.map((c) => (c.id === plan.cardId ? result.data : c)),
      toast: movedCardText(plan.key, listName(plan.move.list_id)),
      reload: false,
    };
  }
  const byList = groupByList(lists, cards);
  if (result.kind === "card_moved") {
    return {
      cards: ungroup(placeCard(byList, result.card, result.after_id)),
      toast: cardMovedText(result.moved_by, listName(result.card.list_id)),
      reload: true,
    };
  }
  const { from_list_id, from_after_id } = plan.move;
  return {
    cards: ungroup(revertCardMove(byList, plan.cardId, from_list_id, from_after_id)),
    toast: cardFailureText(result.kind, true),
    reload: false,
  };
}

/** Line breaks (Shift+Enter) become single spaces; the ends are trimmed. */
export function oneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

/**
 * A reload's result may replace what is on screen only if nothing local changed since it began
 * (`epoch`), no save is waiting for the server and no drag is under way.
 */
export function shouldApply(
  startEpoch: number,
  nowEpoch: number,
  pending: number,
  dragging: boolean,
): boolean {
  return startEpoch === nowEpoch && pending === 0 && !dragging;
}
