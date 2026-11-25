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

/** Saves of the same field of the same card share a key; nothing else does. */
export function fieldKey(cardId: number, field: CardField): string {
  const name = field.kind === "label" || field.kind === "member" ? `${field.kind}:${field.id}` : field.kind;
  return `${cardId}:${name}`;
}

/** True when both describe the same field with the same value. */
export function sameField(a: CardField, b: CardField): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
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

/** What to do after a save answered: change the screen, and maybe send the value that waited. */
export type SaveStep = { screen: Settled; next: CardField | null };

/**
 * Keeps the saves of one field of one card in order: at most one is out at a time. A change made
 * while one is out waits, and only the newest waiting value is sent once the answer is in (nothing
 * is sent if it is what the server already has). The screen shows the newest value all along. A
 * failure takes the field back to the last value the server confirmed and drops what waited.
 */
export function createSaveTracker() {
  // `shown` is the newest value the screen was given for the field.
  type Slot = { confirmed: CardField; waiting: CardField | null; shown: CardField };
  const slots = new Map<string, Slot>();
  return {
    /**
     * A change to `value`, made when the screen showed `before`. Returns the value to send now, or
     * null when a save is already out and this one waits for it.
     */
    request(key: string, before: CardField, value: CardField): CardField | null {
      const slot = slots.get(key);
      if (!slot) {
        slots.set(key, { confirmed: before, waiting: null, shown: value });
        return value;
      }
      slot.waiting = value;
      slot.shown = value;
      return null;
    },
    /** The answer of the save that is out for `key`. */
    settle(key: string, outcome: SaveOutcome): SaveStep {
      const slot = slots.get(key);
      if (!slot) return { screen: { kind: "keep" }, next: null };
      if (!outcome.ok) {
        slots.delete(key);
        // The screen may already show the confirmed value (on, off while the first was out):
        // then nothing was undone, and nothing is said.
        if (sameField(slot.shown, slot.confirmed)) return { screen: { kind: "keep" }, next: null };
        return { screen: { kind: "revert", value: slot.confirmed }, next: null };
      }
      slot.confirmed = outcome.value;
      const waiting = slot.waiting;
      slot.waiting = null;
      if (waiting !== null && !sameField(waiting, outcome.value)) {
        return { screen: { kind: "keep" }, next: waiting };
      }
      slots.delete(key);
      return { screen: { kind: "apply", value: outcome.value }, next: null };
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

/** A description being edited: the card it belongs to, the text, and what the server had. */
export type DraftEntry = { key: string; id: number; text: string; original: string | null };

/** The drafts of every card that has one, by card id. */
export type Drafts = Record<number, DraftEntry>;

export type DraftAction =
  | { type: "start"; entry: DraftEntry }
  | { type: "change"; id: number; text: string }
  /** Cancel and Esc: an explicit discard, which must not happen while the save is out. */
  | { type: "cancel"; id: number; saving: boolean }
  /** The server took the text, or the card is gone: the draft has no more use. */
  | { type: "drop"; id: number }
  /** The dialog closes; `id` is null for the "isn't on the board" dialog. */
  | { type: "close"; id: number | null }
  /** The address left the card with this key. */
  | { type: "leave"; key: string };

function dirtyEntry(entry: DraftEntry | undefined): boolean {
  return entry !== undefined && draftDirty(entry.original, entry.text);
}

function removed(drafts: Drafts, id: number): Drafts {
  const next = { ...drafts };
  delete next[id];
  return next;
}

/**
 * How the drafts change. A draft is never deleted by anything but an explicit discard, the server
 * taking it, the card being gone, or a closing that loses nothing (no unsaved text). One card's
 * draft never touches another's.
 */
export function draftsReducer(drafts: Drafts, action: DraftAction): Drafts {
  switch (action.type) {
    case "start":
      return drafts[action.entry.id] ? drafts : { ...drafts, [action.entry.id]: action.entry };
    case "change": {
      const entry = drafts[action.id];
      return entry ? { ...drafts, [action.id]: { ...entry, text: action.text } } : drafts;
    }
    case "cancel":
      return action.saving || !drafts[action.id] ? drafts : removed(drafts, action.id);
    case "drop":
      return drafts[action.id] ? removed(drafts, action.id) : drafts;
    case "close":
      return action.id !== null && drafts[action.id] && !dirtyEntry(drafts[action.id])
        ? removed(drafts, action.id)
        : drafts;
    case "leave": {
      const entry = draftForKey(drafts, action.key);
      return entry && !dirtyEntry(entry) ? removed(drafts, entry.id) : drafts;
    }
  }
}

/** The draft of the card with this key, if there is one. */
export function draftForKey(drafts: Drafts, key: string): DraftEntry | undefined {
  return Object.values(drafts).find((d) => d.key === key);
}

/** True when any card has a draft that differs from what the server holds. */
export function anyDirty(drafts: Drafts): boolean {
  return Object.values(drafts).some((d) => dirtyEntry(d));
}

/** True when leaving the card with this key leaves unsaved text behind (worth a toast). */
export function keptOnLeave(drafts: Drafts, key: string): boolean {
  return dirtyEntry(draftForKey(drafts, key));
}

/** A draft is edited by someone who can edit, and only shown (to copy, or discard) otherwise. */
export function draftMode(canEdit: boolean, entry: DraftEntry | undefined): "none" | "edit" | "readonly" {
  if (!entry) return "none";
  return canEdit ? "edit" : "readonly";
}

/** Unsaved text blocks closing, unless the person can no longer save it anyway. */
export function closeAction(canEdit: boolean, entry: DraftEntry | undefined): "close" | "blocked" {
  return canEdit && dirtyEntry(entry) ? "blocked" : "close";
}

/** A session that ended may reload the page, unless that would destroy unsaved text. */
export function expiredAction(unsavedText: boolean): "reload" | "keep" {
  return unsavedText ? "keep" : "reload";
}

/** The last tile seen for each card key, so a draft's card keeps its own tile. */
export type Tiles = Record<string, Card>;

/** Remembers the tile of the card that is on the board (the same object when nothing is new). */
export function rememberTile(tiles: Tiles, found: Card | null): Tiles {
  if (!found || tiles[found.key] === found) return tiles;
  return { ...tiles, [found.key]: found };
}

/** The remembered tile of this key, or null. */
export function lastTileOf(tiles: Tiles, cardKey: string | null): Card | null {
  return cardKey === null ? null : (tiles[cardKey] ?? null);
}

/** The toast for an ended session while unsaved text is held; true whether or not a dialog is open. */
export const EXPIRED_KEPT_TEXT =
  "Your session has ended. Your unsaved description is kept in memory: open its card, copy the text, then reload the page and sign in again.";

/**
 * The card the dialog shows. A card that is on the board is shown; one that left the board stays
 * (marked stale) while its draft is open; one the server said is gone is not shown at all.
 */
export function dialogCard(state: {
  cardKey: string | null;
  found: Card | null;
  last: Card | null;
  draft: DraftEntry | undefined;
  forcedGone: string | null;
}): { tile: Card | null; stale: boolean } {
  const { cardKey, found, last, draft, forcedGone } = state;
  if (cardKey === null || forcedGone === cardKey) return { tile: null, stale: false };
  if (found) return { tile: found, stale: false };
  const keeps = draft !== undefined && last !== null && last.key === cardKey;
  return keeps ? { tile: last, stale: true } : { tile: null, stale: false };
}

/**
 * The "the server says it is gone" mark of a card key. It ends when the address moves to another
 * card, or a later snapshot of the board contains the card again.
 */
export function keepForcedGone(
  forced: string | null,
  cardKey: string | null,
  snapshotHasCard: boolean,
): string | null {
  return forced !== null && forced === cardKey && !snapshotHasCard ? forced : null;
}

/**
 * The height to give the title box so its text neither clips nor scrolls: the scroll height leaves
 * out the borders, and a border-box height includes them.
 */
export function titleBoxHeight(box: {
  scrollHeight: number;
  offsetHeight: number;
  clientHeight: number;
}): number {
  return box.scrollHeight + (box.offsetHeight - box.clientHeight);
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
