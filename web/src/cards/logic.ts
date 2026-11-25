import type { BoardRole, Card, CardDetail, CardMove, MoveResult } from "../api";
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

/** The card whose key is exactly `key` (case and length count); null if there is none. */
export function findByKey(cards: Card[], key: string): Card | null {
  return cards.find((c) => c.key === key) ?? null;
}

/** The tile of a card detail: everything but the description. */
export function tileOf(detail: CardDetail): Card {
  return {
    id: detail.id,
    key: detail.key,
    list_id: detail.list_id,
    title: detail.title,
    label_ids: detail.label_ids,
    member_ids: detail.member_ids,
    due_on: detail.due_on,
    has_description: detail.has_description,
  };
}

/** Puts `card` right after the card `afterId` (at the end if that one is missing). */
export function insertAfterCard(cards: Card[], afterId: number, card: Card): Card[] {
  if (cards.some((c) => c.id === card.id)) return cards;
  const at = cards.findIndex((c) => c.id === afterId);
  if (at < 0) return [...cards, card];
  return [...cards.slice(0, at + 1), card, ...cards.slice(at + 1)];
}

/** One editable field of a card, with the value it is set to. */
export type CardField =
  | { kind: "title"; value: string }
  | { kind: "due"; value: string | null }
  | { kind: "label"; id: number; on: boolean }
  | { kind: "member"; id: number; on: boolean };

/** Saves of the same field share a key; saves of different fields do not interfere. */
export function fieldKey(field: CardField): string {
  return field.kind === "label" || field.kind === "member" ? `${field.kind}:${field.id}` : field.kind;
}

function toggled(ids: number[], id: number, on: boolean): number[] {
  if (on) return ids.includes(id) ? ids : [...ids, id];
  return ids.filter((x) => x !== id);
}

/** The card with `field` set to its value. */
export function withField(card: Card, field: CardField): Card {
  switch (field.kind) {
    case "title":
      return { ...card, title: field.value };
    case "due":
      return { ...card, due_on: field.value };
    case "label":
      return { ...card, label_ids: toggled(card.label_ids, field.id, field.on) };
    case "member":
      return { ...card, member_ids: toggled(card.member_ids, field.id, field.on) };
  }
}

/** The card's current value for the same field as `field`, in the same shape. */
export function readField(card: Card, field: CardField): CardField {
  switch (field.kind) {
    case "title":
      return { kind: "title", value: card.title };
    case "due":
      return { kind: "due", value: card.due_on };
    case "label":
      return { kind: "label", id: field.id, on: card.label_ids.includes(field.id) };
    case "member":
      return { kind: "member", id: field.id, on: card.member_ids.includes(field.id) };
  }
}

/** What a save's answer does to the card on screen. */
export type Settled =
  | { kind: "apply"; value: CardField }
  | { kind: "revert"; value: CardField }
  | { kind: "keep" };

export type SaveOutcome = { ok: true; value: CardField } | { ok: false };

/**
 * Keeps overlapping saves of one field in order. Each field shows its newest local value; only the
 * newest save's answer may touch it (the server's value on success, the last confirmed value on
 * failure). An older answer arriving first or last changes nothing on screen.
 */
export function createSaveTracker() {
  type Slot = { latest: number; inflight: number; confirmed: CardField; confirmedTicket: number };
  const slots = new Map<string, Slot>();
  let counter = 0;
  return {
    /** Call before sending; `before` is the field's value on screen just before the change. */
    start(key: string, before: CardField): number {
      const ticket = ++counter;
      const slot = slots.get(key);
      if (!slot || slot.inflight === 0) {
        slots.set(key, { latest: ticket, inflight: 1, confirmed: before, confirmedTicket: 0 });
      } else {
        slot.latest = ticket;
        slot.inflight += 1;
      }
      return ticket;
    },
    settle(key: string, ticket: number, outcome: SaveOutcome): Settled {
      const slot = slots.get(key);
      if (!slot) return { kind: "keep" };
      slot.inflight -= 1;
      const newest = ticket === slot.latest;
      if (outcome.ok) {
        if (ticket > slot.confirmedTicket) {
          slot.confirmed = outcome.value;
          slot.confirmedTicket = ticket;
        }
        return newest ? { kind: "apply", value: outcome.value } : { kind: "keep" };
      }
      return newest ? { kind: "revert", value: slot.confirmed } : { kind: "keep" };
    },
  };
}

/** A title as it is saved: one line, trimmed, 1 to 200 characters; null if it cannot be saved. */
export function titleFrom(raw: string): string | null {
  const title = oneLine(raw);
  return title !== "" && title.length <= 200 ? title : null;
}

/** Only owners and members can be put on a card; observers cannot. */
export function assignablePeople<T extends { role: BoardRole }>(people: T[]): T[] {
  return people.filter((p) => p.role !== "observer");
}

/** The picker gets a search box once there are more than 8 people to choose from. */
export function showPeopleSearch(count: number): boolean {
  return count > 8;
}

/** People whose name or email contains the query, ignoring case; an empty query keeps everyone. */
export function matchPeople<T extends { name: string | null; email: string }>(
  people: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return people;
  return people.filter((p) => `${p.name ?? ""} ${p.email}`.toLowerCase().includes(q));
}

export const DESCRIPTION_LIMIT = 10000;

/** True when the draft differs from the description the server has. */
export function draftDirty(original: string | null, draft: string): boolean {
  return draft !== (original ?? "");
}

/** Blank text clears the description (null); anything else is sent as typed. */
export function descriptionToSend(draft: string): string | null {
  return draft.trim() === "" ? null : draft;
}

/** What Esc does in the card dialog: a popup first, then the description edit, a field, the dialog. */
export function escapeAction(state: {
  popup: boolean;
  typingInDraft: boolean;
  typing: boolean;
}): "close-popup" | "cancel-draft" | "blur" | "close" {
  if (state.popup) return "close-popup";
  if (state.typingInDraft) return "cancel-draft";
  if (state.typing) return "blur";
  return "close";
}

/** After a poll the open card's detail is fetched again, unless a draft or a save is in the way. */
export function shouldRefetchDetail(state: { open: boolean; draft: boolean; saving: boolean }): boolean {
  return state.open && !state.draft && !state.saving;
}

/** Whether a fetched detail may replace what the dialog holds. */
export function acceptDetail(state: {
  openId: number | null;
  fetchedId: number;
  draft: boolean;
  startVersion: number;
  version: number;
}): boolean {
  return (
    state.openId === state.fetchedId && !state.draft && state.startVersion === state.version
  );
}
