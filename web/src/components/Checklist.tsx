import { type FormEvent, type MutableRefObject, useRef, useState } from "react";

import {
  type CardDetail,
  type CardError,
  type ChecklistItem,
  addChecklistItem,
  deleteChecklistItem,
  restoreChecklistItem,
  setChecklistItem,
} from "../api";
import {
  hideButtonText,
  itemTextFrom,
  listView,
  progress,
  progressText,
  settleDelete,
  settleToggle,
  withDone,
  withoutItem,
} from "../cards/checklist";
import { UNDO_FAILED_TEXT, checklistFailureText, deleteOutcome } from "../cards/text";
import { GlyphIcon, LinkedText } from "./Cards";
import { Icon } from "./Icon";

/** What the checklist is showing besides the items. */
export type ChecklistUi = {
  hideChecked: boolean;
  showAll: boolean;
  /** Items whose own save is out; their checkbox waits. */
  busyIds: number[];
  /** An item is being added. */
  adding: boolean;
  /** The text in the add box. */
  draft: string;
};

export type ChecklistControls = {
  onToggle: (id: number, done: boolean) => void;
  onDelete: (id: number) => void;
  onHide: () => void;
  onShowAll: () => void;
  onDraft: (text: string) => void;
  onAdd: () => void;
};

type ViewProps = Partial<ChecklistUi> & {
  items: ChecklistItem[];
  /** Owners and members change the list; observers only read it. */
  editor: boolean;
  c?: Partial<ChecklistControls>;
};

/** The checklist block as plain markup: progress, items, "Hide checked items", the add form. */
export function ChecklistView({
  items,
  editor,
  hideChecked = false,
  showAll = false,
  busyIds = [],
  adding = false,
  draft = "",
  c = {},
}: ViewProps) {
  const p = progress(items);
  // Nothing checked means nothing to hide, so an earlier "hide" must not linger.
  const hide = hideChecked && p.done > 0;
  const view = listView(items, hide, showAll);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    c.onAdd?.();
  }

  return (
    <div>
      <div className="sec-head">
        <h3>
          <GlyphIcon name="check" /> Checklist
        </h3>
        {p.done > 0 && (
          <button className="btn sm" type="button" onClick={() => c.onHide?.()}>
            {hideButtonText(hide, p.done)}
          </button>
        )}
      </div>
      {p.total > 0 && (
        <div className="progress">
          <span>{`${p.done}/${p.total}`}</span>
          <span
            className={p.percent === 100 ? "bar full" : "bar"}
            role="progressbar"
            aria-label={`Checklist: ${progressText(items)}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={p.percent}
          >
            <i style={{ width: `${p.percent}%` }}></i>
          </span>
          <span>{`${p.percent}%`}</span>
        </div>
      )}
      {view.shown.map((item) => (
        <div className={item.done ? "check done" : "check"} key={item.id}>
          <input
            type="checkbox"
            id={`chk-${item.id}`}
            checked={item.done}
            disabled={!editor || busyIds.includes(item.id)}
            onChange={(e) => c.onToggle?.(item.id, e.target.checked)}
          />
          <label htmlFor={`chk-${item.id}`}>
            <LinkedText text={item.text} />
          </label>
          {editor && (
            <button
              className="del"
              type="button"
              aria-label={`Delete item: ${item.text}`}
              title="Delete item"
              onClick={() => c.onDelete?.(item.id)}
            >
              <Icon name="x" />
            </button>
          )}
        </div>
      ))}
      {view.allChecked && <p className="muted">Everything is checked.</p>}
      {view.canExpand && (
        <button className="linkish" type="button" onClick={() => c.onShowAll?.()}>
          {showAll ? "Show fewer" : `Show all ${view.visible}`}
        </button>
      )}
      {editor ? (
        <form className="check-form" onSubmit={onSubmit}>
          <input
            className="input"
            aria-label="New checklist item"
            placeholder="Add an item"
            maxLength={200}
            autoComplete="off"
            readOnly={adding}
            value={draft}
            onChange={(e) => c.onDraft?.(e.target.value)}
          />
          <button className="btn sm" type="submit" disabled={adding}>
            Add
          </button>
        </form>
      ) : (
        items.length === 0 && <p className="muted">No checklist.</p>
      )}
    </div>
  );
}

/**
 * The checklist with its own view choices: hiding checked items and showing all items are never
 * saved. It belongs to one card (the dialog gives it `key={tile.id}`).
 */
export function Checklist({
  items,
  editor,
  busyIds,
  adding,
  onToggle,
  onDelete,
  onAdd,
}: {
  items: ChecklistItem[];
  editor: boolean;
  busyIds: number[];
  adding: boolean;
  onToggle: (id: number, done: boolean) => void;
  onDelete: (id: number) => void;
  /** Resolves true when the item was added. */
  onAdd: (text: string) => Promise<boolean>;
}) {
  const [hideChecked, setHideChecked] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [draft, setDraft] = useState("");
  const typed = useRef(draft);
  typed.current = draft;

  async function add() {
    const sent = draft;
    if (itemTextFrom(sent) === null) return;
    if ((await onAdd(sent)) && typed.current === sent) setDraft("");
  }

  return (
    <ChecklistView
      items={items}
      editor={editor}
      hideChecked={hideChecked}
      showAll={showAll}
      busyIds={busyIds}
      adding={adding}
      draft={draft}
      c={{
        onToggle,
        onDelete,
        onHide: () => setHideChecked((h) => !h),
        onShowAll: () => setShowAll((a) => !a),
        onDraft: setDraft,
        onAdd: () => void add(),
      }}
    />
  );
}

/** What the checklist's saves need from the card dialog. */
export type ChecklistEnv = {
  boardId: number;
  /** The card the dialog shows, or null. */
  openId: number | null;
  /** The person can change the card right now. */
  canEdit: () => boolean;
  /** The items on screen now. */
  items: () => ChecklistItem[];
  /** Changes the items of card `id` on screen, and the tile's counts with them. */
  update: (id: number, change: (items: ChecklistItem[]) => ChecklistItem[]) => void;
  /** Puts the server's card (items, counts) on screen. */
  accept: (detail: CardDetail) => void;
  /** Fetches the card again and shows it, quietly. */
  reloadDetail: (id: number) => void;
  /** Called after a write the server took: the activity has a new entry. */
  written: (id: number) => void;
  /** Saves that touch the card and are still out; a poll must not replace the items meanwhile. */
  writes: MutableRefObject<number>;
  track: <T>(save: Promise<T>) => Promise<T>;
  notify: (text: string, undo?: () => void) => void;
  /** A failure: toasts the text (unless the session ended) and reacts to the kind. */
  fail: (kind: CardError, text: string) => void;
};

/**
 * The checklist's saves. Checking an item shows at once and goes back on failure; adding waits for
 * the server; deleting removes the item at once and offers Undo once the server has confirmed.
 * Every save goes through `track`, so a poll cannot overwrite it.
 */
export function useChecklist(env: ChecklistEnv) {
  const [busyIds, setBusy] = useState<number[]>([]);
  const [adding, setAdding] = useState(false);
  const now = useRef(env);
  now.current = env;
  const busy = useRef<number[]>([]);
  const addingNow = useRef(false);
  /** Answers that came while another save was out: the screen is fetched again when all are in. */
  const behind = useRef(false);

  function markBusy(id: number, on: boolean) {
    busy.current = on ? [...busy.current, id] : busy.current.filter((x) => x !== id);
    setBusy(busy.current);
  }

  function landed(data: CardDetail) {
    const e = now.current;
    if (e.writes.current === 0) e.accept(data);
    else behind.current = true;
  }

  function finished(card: number) {
    const e = now.current;
    if (e.writes.current === 0 && behind.current) {
      behind.current = false;
      e.reloadDetail(card);
    }
  }

  function toggle(id: number, done: boolean) {
    const e = now.current;
    const card = e.openId;
    if (card === null || !e.canEdit() || busy.current.includes(id)) return;
    const before = e.items().find((i) => i.id === id);
    if (!before || before.done === done) return;
    markBusy(id, true);
    e.writes.current += 1;
    e.update(card, (items) => withDone(items, id, done));
    void e.track(setChecklistItem(e.boardId, card, id, done)).then((res) => {
      e.writes.current -= 1;
      markBusy(id, false);
      if (res.kind === "ok") {
        landed(res.data);
        e.written(card);
        finished(card);
        return;
      }
      e.update(card, (items) => settleToggle(items, id, before.done, false));
      e.fail(res.kind, checklistFailureText(res.kind, true));
      if (res.kind === "item_not_found") e.reloadDetail(card);
      finished(card);
    });
  }

  async function add(raw: string): Promise<boolean> {
    const e = now.current;
    const card = e.openId;
    const text = itemTextFrom(raw);
    if (card === null || text === null || !e.canEdit() || addingNow.current) return false;
    addingNow.current = true;
    setAdding(true);
    e.writes.current += 1;
    const res = await e.track(addChecklistItem(e.boardId, card, text));
    e.writes.current -= 1;
    addingNow.current = false;
    setAdding(false);
    if (res.kind === "ok") {
      landed(res.data);
      e.written(card);
      finished(card);
      return true;
    }
    e.fail(res.kind, checklistFailureText(res.kind));
    finished(card);
    return false;
  }

  function undoDelete(card: number, id: number) {
    const e = now.current;
    e.writes.current += 1;
    void e.track(restoreChecklistItem(e.boardId, card, id)).then((res) => {
      e.writes.current -= 1;
      if (res.kind === "ok") {
        landed(res.data);
        e.written(card);
      } else {
        e.fail(res.kind, res.kind === "checklist_limit" ? checklistFailureText(res.kind) : UNDO_FAILED_TEXT);
        e.reloadDetail(card);
      }
      finished(card);
    });
  }

  function remove(id: number) {
    const e = now.current;
    const card = e.openId;
    if (card === null || !e.canEdit()) return;
    const index = e.items().findIndex((i) => i.id === id);
    if (index < 0) return;
    const removed = e.items()[index];
    e.writes.current += 1;
    e.update(card, (items) => withoutItem(items, id));
    void e.track(deleteChecklistItem(e.boardId, card, id)).then((res) => {
      e.writes.current -= 1;
      const outcome = deleteOutcome(res.kind, "item");
      if (res.kind === "ok") {
        landed(res.data);
        e.written(card);
        // Undo is offered only now: the server has the delete.
        e.notify(outcome.text, () => undoDelete(card, id));
      } else {
        // Put the item back at once; the refetch then shows what the server really has.
        e.update(card, (items) => settleDelete(items, removed, index, outcome.putBack));
        e.fail(res.kind, outcome.text);
        e.reloadDetail(card);
      }
      finished(card);
    });
  }

  return { busyIds, adding, toggle, add, remove };
}
