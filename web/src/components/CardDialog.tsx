import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  type BoardList,
  type BoardMember,
  type BoardRole,
  type Card,
  type CardDetail,
  type CardError,
  type CardsResult,
  type ChecklistItem,
  type Label,
  addCardLabel,
  addCardMember,
  getCard,
  patchCard,
  removeCardLabel,
  removeCardMember,
} from "../api";
import { DUE_LABEL, dueState, formatDue, isCommittableDay } from "../cards/due";
import {
  type CardField,
  DESCRIPTION_LIMIT,
  acceptDetail,
  anyDirty,
  assignablePeople,
  canAddCard,
  closeBlocker,
  createSaveTracker,
  descriptionToSend,
  dialogCard,
  draftForKey,
  draftMode,
  draftsReducer,
  escapeAction,
  fieldKey,
  findByKey,
  keepForcedGone,
  keptOnLeave,
  matchPeople,
  type Tiles,
  lastTileOf,
  readField,
  rememberTile,
  sameField,
  shouldRefetchDetail,
  showPeopleSearch,
  titleBoxHeight,
  titleFrom,
  withField,
} from "../cards/logic";
import { countsOf } from "../cards/checklist";
import {
  COMMENT_OPEN_TEXT,
  DRAFT_KEPT_TEXT,
  DRAFT_OPEN_TEXT,
  DRAFT_READONLY_TEXT,
  LINK_COPIED_TEXT,
  LINK_FAILED_TEXT,
  cardFailureText,
  descriptionFailureText,
} from "../cards/text";
import { cardPath, navigate } from "../routes";
import {
  type CommentUi,
  CardFeedView,
  type FeedControls,
  type FeedState,
  useCardFeed,
} from "./CardFeed";
import { CardAvatar, LabelChip } from "./Cards";
import { Checklist, useChecklist } from "./Checklist";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";

export type Pop = "members" | "labels" | "menu" | null;

/** The description as the dialog knows it: loading, loaded or failed to load. */
export type DetailView = {
  state: "loading" | "ready" | "error";
  description: string | null;
  checklist?: ChecklistItem[];
};

/** What the checklist block needs from the dialog: its saves and which of them are out. */
export type ChecklistProps = {
  busyIds: number[];
  adding: boolean;
  onToggle: (id: number, done: boolean) => void;
  onDelete: (id: number) => void;
  /** Resolves true when the item was added. */
  onAdd: (text: string) => Promise<boolean>;
};

/** What the dialog is showing right now besides the card itself. */
export type DialogUi = {
  pop: Pop;
  memberQuery: string;
  /** The description being edited, or null when it is not being edited. */
  draft: string | null;
  /** The server has the description text and has not answered yet. */
  saving: boolean;
  /** The card left the board while a draft kept the dialog open. */
  stale: boolean;
};

export type DialogControls = {
  onClose: () => void;
  /** A click on the dark area around the dialog. */
  onBackdrop: () => void;
  onPop: (pop: Pop) => void;
  onMemberQuery: (query: string) => void;
  onToggleMember: (id: number, on: boolean) => void;
  onToggleLabel: (id: number, on: boolean) => void;
  /** A title or due date is bound to the card it was typed on, even if it is sent after leaving it. */
  onTitle: (title: string, cardId: number) => void;
  onDue: (day: string | null, cardId: number) => void;
  onEdit: () => void;
  onDraft: (text: string) => void;
  onSaveDraft: () => void;
  onCancelDraft: () => void;
  onRetryDetail: () => void;
  onMoveTo: (listId: number) => void;
  onCopy: () => void;
  onCopyLink: () => void;
  onArchive: () => void;
};

type ViewProps = {
  board: { name: string; my_role: BoardRole };
  /** The card to show; null shows the "isn't on the board" dialog. */
  tile: Card | null;
  lists: BoardList[];
  labels: Label[];
  people: BoardMember[];
  /** The cards on the board, for the 1,000-card limit on Copy card. */
  total: number;
  detail: DetailView;
  ui?: Partial<DialogUi>;
  c?: Partial<DialogControls>;
  checklist?: Partial<ChecklistProps>;
  /** The card's comments and activity. */
  feed?: FeedState;
  feedUi?: Partial<CommentUi>;
  feedC?: Partial<FeedControls>;
  /** The time the comments are measured against, in milliseconds; now unless a test says. */
  now?: number;
  frameRef?: Ref<HTMLDivElement>;
};

/** Sizes the title box to its text; the height includes the borders, so nothing clips or scrolls. */
function fitTitleBox(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${titleBoxHeight(el)}px`;
}

/**
 * The card title as a textarea that grows with its text. Enter saves, Esc puts the old title back.
 * It belongs to one card (the dialog gives it `key={tile.id}`), and a valid typed title is still
 * saved if the dialog goes away first.
 */
function TitleField({
  title,
  popOpen,
  onCommit,
}: {
  title: string;
  popOpen: boolean;
  onCommit?: (title: string) => void;
}) {
  const [text, setText] = useState(title);
  const box = useRef<HTMLTextAreaElement>(null);
  const focused = useRef(false);
  const skip = useRef(false);
  const latest = useRef({ text, title, onCommit });
  latest.current = { text, title, onCommit };
  /** The title this field already handed over, until the card shows it. */
  const sent = useRef<string | null>(null);

  useEffect(() => {
    sent.current = null;
    if (!focused.current) setText(title);
  }, [title]);

  useLayoutEffect(() => {
    if (box.current) fitTitleBox(box.current);
  }, [text]);

  // A narrower or wider box wraps the title differently.
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = el.clientWidth;
    const watcher = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fitTitleBox(el);
    });
    watcher.observe(el);
    return () => watcher.disconnect();
  }, []);

  // Back, a link or Esc closes the dialog before the field loses focus: do not lose the title.
  useEffect(
    () => () => {
      const { text: now, title: saved, onCommit: save } = latest.current;
      const next = titleFrom(now);
      if (next !== null && next !== saved && next !== sent.current) save?.(next);
    },
    [],
  );

  function commit() {
    const next = titleFrom(text);
    if (next === null || next === title) {
      setText(title);
      return;
    }
    setText(next);
    sent.current = next;
    onCommit?.(next);
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === "Escape" && !popOpen) {
      e.preventDefault();
      e.stopPropagation();
      skip.current = true;
      setText(title);
      latest.current = { ...latest.current, text: title };
      e.currentTarget.blur();
      skip.current = false;
    }
  }

  return (
    <textarea
      className="title-input"
      id="card-title"
      aria-label="Card title"
      ref={box}
      rows={1}
      maxLength={200}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        if (!skip.current) commit();
      }}
      onKeyDown={onKeyDown}
    ></textarea>
  );
}

/**
 * The native date input. A date is saved when the field loses focus, stays unchanged for a moment
 * or the dialog goes away, never while it is half typed (typing a year passes through 0002, 0020,
 * ...: only a real day from 1970 on counts). An incomplete date is dropped; the Clear button is how
 * a date is removed. It belongs to one card (the dialog gives it `key={tile.id}`).
 */
function DueField({ value, onCommit }: { value: string | null; onCommit?: (day: string | null) => void }) {
  const [text, setText] = useState(value ?? "");
  const latest = useRef({ text, value, onCommit });
  latest.current = { text, value, onCommit };
  /** The day this field already handed over, until the card shows it. */
  const sent = useRef<string | null>(null);

  useEffect(() => {
    sent.current = null;
    setText(value ?? "");
  }, [value]);

  function commit() {
    const { text: now, value: saved, onCommit: save } = latest.current;
    if (!isCommittableDay(now)) setText(saved ?? "");
    else if (now !== (saved ?? "")) {
      sent.current = now;
      save?.(now);
    }
  }

  useEffect(() => {
    if (!isCommittableDay(text) || text === (value ?? "")) return;
    const timer = setTimeout(commit, 800);
    return () => clearTimeout(timer);
  }, [text]);

  // Back or a link can take the dialog away within the 0.8 s: send a complete date, never a half one.
  useEffect(
    () => () => {
      const { text: now, value: saved, onCommit: save } = latest.current;
      if (isCommittableDay(now) && now !== (saved ?? "") && now !== sent.current) save?.(now);
    },
    [],
  );

  return (
    <>
      <input
        type="date"
        className="input"
        aria-label="Due date"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      {value && (
        <button className="btn ghost sm" type="button" onClick={() => onCommit?.(null)}>
          Clear
        </button>
      )}
    </>
  );
}

function DueChip({ day }: { day: string }) {
  const state = dueState(day);
  return state ? <span className={`chip ${state}`}>{DUE_LABEL[state]}</span> : null;
}

function MembersPop({
  people,
  selected,
  query,
  c,
}: {
  people: BoardMember[];
  selected: number[];
  query: string;
  c: Partial<DialogControls>;
}) {
  const all = assignablePeople(people);
  const shown = matchPeople(all, query);
  return (
    <div className="pop" style={{ left: 0, top: 34 }} role="group" aria-label="Board members">
      <span className="head">Board members</span>
      {showPeopleSearch(all.length) && (
        <input
          className="input find"
          placeholder="Find a person"
          aria-label="Find a board member"
          autoComplete="off"
          autoFocus
          value={query}
          onChange={(e) => c.onMemberQuery?.(e.target.value)}
        />
      )}
      <div className="scroll">
        {shown.map((p) => (
          <label className="item" key={p.id}>
            <input
              type="checkbox"
              checked={selected.includes(p.id)}
              onChange={(e) => c.onToggleMember?.(p.id, e.target.checked)}
            />
            <CardAvatar person={p} />
            {p.name ?? p.email}
          </label>
        ))}
        {shown.length === 0 && (
          <span className="fine pad">
            {all.length === 0
              ? "Nobody on this board can be assigned yet."
              : "Nobody on this board matches."}
          </span>
        )}
      </div>
      <span className="fine pad">Observers can't be assigned.</span>
    </div>
  );
}

function LabelsPop({
  labels,
  selected,
  c,
}: {
  labels: Label[];
  selected: number[];
  c: Partial<DialogControls>;
}) {
  return (
    <div className="pop" style={{ left: 0, top: 34 }} role="group" aria-label="Labels">
      <span className="head">Labels</span>
      {labels.map((l) => (
        <label className="item" key={l.id}>
          <input
            type="checkbox"
            checked={selected.includes(l.id)}
            onChange={(e) => c.onToggleLabel?.(l.id, e.target.checked)}
          />
          <LabelChip label={l} />
        </label>
      ))}
    </div>
  );
}

function CardMenu({
  editor,
  lists,
  current,
  total,
  c,
}: {
  editor: boolean;
  lists: BoardList[];
  current: number;
  total: number;
  c: Partial<DialogControls>;
}) {
  return (
    <div className="pop" role="menu" style={{ right: 0, top: 34 }}>
      {editor && (
        <>
          <span className="head">Move to</span>
          {lists
            .filter((l) => l.id !== current)
            .map((l) => (
              <button
                className="item"
                type="button"
                role="menuitem"
                key={l.id}
                onClick={() => c.onMoveTo?.(l.id)}
              >
                {l.name}
              </button>
            ))}
          <hr />
          {canAddCard(total) && (
            <button className="item" type="button" role="menuitem" onClick={() => c.onCopy?.()}>
              Copy card
            </button>
          )}
        </>
      )}
      <button className="item" type="button" role="menuitem" onClick={() => c.onCopyLink?.()}>
        Copy link
      </button>
      {editor && (
        <>
          <hr />
          <button
            className="item danger"
            type="button"
            role="menuitem"
            onClick={() => c.onArchive?.()}
          >
            Archive card
          </button>
        </>
      )}
    </div>
  );
}

function Description({
  editor,
  detail,
  draft,
  saving,
  c,
}: {
  editor: boolean;
  detail: DetailView;
  draft: string | null;
  saving: boolean;
  c: Partial<DialogControls>;
}) {
  const hasText = detail.description !== null && detail.description !== "";
  const counter = (text: string) =>
    `${text.length.toLocaleString("en-US")} / ${DESCRIPTION_LIMIT.toLocaleString("en-US")}`;
  let body;
  if (draft !== null && !editor) {
    // Someone who can no longer edit: the text stays to be copied or discarded, never saved.
    body = (
      <div data-desc="">
        <textarea
          className="input desc-input"
          rows={7}
          aria-label="Description"
          readOnly
          value={draft}
        ></textarea>
        <div className="desc-actions">
          <button
            className="btn sm"
            type="button"
            disabled={saving}
            onClick={() => c.onCancelDraft?.()}
          >
            Discard
          </button>
          <span className="fine counter">{counter(draft)}</span>
        </div>
      </div>
    );
  } else if (draft !== null) {
    body = (
      <div data-desc="">
        <textarea
          className="input desc-input"
          rows={7}
          maxLength={DESCRIPTION_LIMIT}
          aria-label="Description"
          autoFocus
          readOnly={saving}
          value={draft}
          onChange={(e) => c.onDraft?.(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              c.onSaveDraft?.();
            }
          }}
        ></textarea>
        <div className="desc-actions">
          <button
            className="btn primary sm"
            type="button"
            disabled={saving}
            onClick={() => c.onSaveDraft?.()}
          >
            Save
          </button>
          <button
            className="btn ghost sm"
            type="button"
            disabled={saving}
            onClick={() => c.onCancelDraft?.()}
          >
            Cancel
          </button>
          <span className="fine counter">{counter(draft)}</span>
          <span className="fine">
            {"HTML tags are removed. Markdown: **bold**, *italic*, `code`, - lists"}
          </span>
        </div>
      </div>
    );
  } else if (detail.state === "loading") {
    body = (
      <div className="skel-list" aria-busy="true">
        <div className="skel"></div>
      </div>
    );
  } else if (detail.state === "error") {
    body = (
      <div className="desc-error">
        <span className="fine">Couldn't load the description.</span>
        <button className="btn sm" type="button" onClick={() => c.onRetryDetail?.()}>
          Try again
        </button>
      </div>
    );
  } else if (hasText) {
    body = <Markdown source={detail.description ?? ""} />;
  } else if (editor) {
    body = (
      <button className="md-empty" type="button" onClick={() => c.onEdit?.()}>
        Add a description. Markdown is supported.
      </button>
    );
  } else {
    body = <p className="muted">No description.</p>;
  }
  return (
    <div>
      <div className="sec-head">
        <h3>
          <Icon name="text" /> Description
        </h3>
        {editor && draft === null && detail.state === "ready" && hasText && (
          <button className="btn sm" type="button" onClick={() => c.onEdit?.()}>
            Edit
          </button>
        )}
      </div>
      {body}
    </div>
  );
}

/** The dark area behind a dialog. Only a press that starts and ends on it counts as a click. */
function Scrim({ onBackdrop, children }: { onBackdrop?: () => void; children: ReactNode }) {
  const down = useRef(false);
  return (
    <div
      className="scrim"
      onMouseDown={(e) => {
        down.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        // A text selection that ends on the dark area must not close the dialog.
        if (e.target === e.currentTarget && down.current) onBackdrop?.();
        down.current = false;
      }}
    >
      {children}
    </div>
  );
}

/** The card dialog as plain markup: the state and the server calls live in `CardDialog`. */
export function CardDialogView({
  board,
  tile,
  lists,
  labels,
  people,
  total,
  detail,
  ui = {},
  c = {},
  checklist = {},
  feed = { state: "loading", entries: [], more: false },
  feedUi,
  feedC,
  now = Date.now(),
  frameRef,
}: ViewProps) {
  const editor = board.my_role !== "observer";

  if (!tile) {
    return (
      <Scrim onBackdrop={c.onClose}>
        <div
          className="modal narrow"
          role="dialog"
          aria-modal="true"
          aria-labelledby="gone-title"
          tabIndex={-1}
          ref={frameRef}
        >
          <div className="empty plain">
            <h2 id="gone-title">This card isn't on the board</h2>
            <p>It may have been archived or moved to another board. Its comments and checklist are kept.</p>
            <button className="btn" type="button" onClick={() => c.onClose?.()}>
              Back to the board
            </button>
          </div>
        </div>
      </Scrim>
    );
  }

  // Observers only ever see the card menu (Copy link); the editing popups are for editors.
  const pop = editor || ui.pop === "menu" ? (ui.pop ?? null) : null;
  // Someone who cannot edit still sees a draft they had open (read-only), so it is never hidden.
  const draft = ui.draft ?? null;
  const listName = lists.find((l) => l.id === tile.list_id)?.name ?? "another list";
  const onCard = tile.label_ids
    .map((id) => labels.find((l) => l.id === id))
    .filter((l): l is Label => l !== undefined);

  return (
    <Scrim onBackdrop={c.onBackdrop}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="card-title"
        tabIndex={-1}
        ref={frameRef}
      >
        <div className="modal-top">
          <span className="where">
            <span className="mono">{tile.key}</span>
            {" · in list "}
            <b>{listName}</b>
            {` on ${board.name}`}
          </span>
          <span className="menu-wrap">
            <button
              className="btn sm"
              type="button"
              data-pop="menu"
              aria-haspopup="menu"
              aria-expanded={pop === "menu"}
              onClick={() => c.onPop?.(pop === "menu" ? null : "menu")}
            >
              <Icon name="dots" /> Card menu
            </button>
            {pop === "menu" && (
              <CardMenu editor={editor} lists={lists} current={tile.list_id} total={total} c={c} />
            )}
          </span>
          <button className="icon-btn" type="button" aria-label="Close (Esc)" onClick={() => c.onClose?.()}>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-cols">
        <div className="modal-body">
          {ui.stale && (
            <div className="banner warn">
              <Icon name="alert" /> This card is no longer on the board. Copy your text, then save
              it or close the card.
            </div>
          )}
          {draft !== null && !editor && (
            <div className="banner warn">
              <Icon name="alert" /> {DRAFT_READONLY_TEXT}
            </div>
          )}
          {editor ? (
            <TitleField
              key={`title-${tile.id}`}
              title={tile.title}
              popOpen={pop !== null}
              onCommit={(title) => c.onTitle?.(title, tile.id)}
            />
          ) : (
            <h2 id="card-title" className="title-text">
              {tile.title}
            </h2>
          )}
          <div className="fields">
            <div className="field">
              <span className="lab">Members</span>
              <div className="row">
                {tile.member_ids.map((id) => (
                  <CardAvatar person={people.find((p) => p.id === id)} large key={id} />
                ))}
                {tile.member_ids.length === 0 && <span className="muted">Nobody yet</span>}
                {editor && (
                  <button
                    className="add-dot"
                    type="button"
                    data-pop="members"
                    aria-haspopup="true"
                    aria-expanded={pop === "members"}
                    aria-label="Change members"
                    onClick={() => c.onPop?.(pop === "members" ? null : "members")}
                  >
                    <Icon name="plus" />
                  </button>
                )}
                {pop === "members" && (
                  <MembersPop
                    people={people}
                    selected={tile.member_ids}
                    query={ui.memberQuery ?? ""}
                    c={c}
                  />
                )}
              </div>
            </div>
            <div className="field">
              <span className="lab">Labels</span>
              <div className="row">
                {onCard.map((l) => (
                  <LabelChip label={l} key={l.id} />
                ))}
                {onCard.length === 0 && <span className="muted">None</span>}
                {editor && (
                  <button
                    className="add-dot"
                    type="button"
                    data-pop="labels"
                    aria-haspopup="true"
                    aria-expanded={pop === "labels"}
                    aria-label="Change labels"
                    onClick={() => c.onPop?.(pop === "labels" ? null : "labels")}
                  >
                    <Icon name="plus" />
                  </button>
                )}
                {pop === "labels" && <LabelsPop labels={labels} selected={tile.label_ids} c={c} />}
              </div>
            </div>
            <div className="field">
              <span className="lab">Due date</span>
              <div className="row">
                {editor ? (
                  <DueField
                    key={tile.id}
                    value={tile.due_on}
                    onCommit={(day) => c.onDue?.(day, tile.id)}
                  />
                ) : tile.due_on ? (
                  <span>{formatDue(tile.due_on)}</span>
                ) : (
                  <span className="muted">None</span>
                )}
                {tile.due_on && <DueChip day={tile.due_on} />}
              </div>
            </div>
          </div>
          <Description editor={editor} detail={detail} draft={draft} saving={ui.saving ?? false} c={c} />
          {detail.state === "ready" ? (
            <Checklist
              key={`checklist-${tile.id}`}
              items={detail.checklist ?? []}
              editor={editor}
              busyIds={checklist.busyIds ?? []}
              adding={checklist.adding ?? false}
              onToggle={(id, done) => checklist.onToggle?.(id, done)}
              onDelete={(id) => checklist.onDelete?.(id)}
              onAdd={(text) => checklist.onAdd?.(text) ?? Promise.resolve(false)}
            />
          ) : detail.state === "loading" ? (
            <div className="skel-list" aria-busy="true">
              <div className="skel"></div>
            </div>
          ) : null}
        </div>
        <section className="modal-side">
          <CardFeedView
            feed={feed}
            editor={editor}
            now={now}
            lists={lists}
            people={people}
            ui={feedUi}
            c={feedC}
          />
        </section>
        </div>
      </div>
    </Scrim>
  );
}

type Setup = {
  boardId: number;
  /** The key in the address, or null when no card is open. */
  cardKey: string | null;
  cards: Card[];
  setCards: (update: (cards: Card[]) => Card[]) => void;
  /** Wraps a save so a reload that finishes meanwhile does not overwrite its result. */
  track: <T>(save: Promise<T>) => Promise<T>;
  notify: (text: string, undo?: () => void) => void;
  /** Loads the board, lists and cards again. */
  refresh: () => Promise<void>;
  onForbidden: () => void;
  onGone: () => void;
  /** The session ended (401): the screen reloads, unless `hasDirty` says text would be lost. */
  onExpired: () => void;
  /** The person's role on the board; an observer cannot edit, and a draft stays read-only. */
  role: BoardRole | null;
  /** Counts the polls that were applied; each one refetches the open card's detail. */
  polled: number;
};

type Loaded = {
  id: number | null;
  state: DetailView["state"];
  description: string | null;
  checklist: ChecklistItem[];
};

export type CardEditor = {
  /** The card the dialog shows; null when it is not on the board. */
  tile: Card | null;
  /** True when the card left the board but an open draft keeps the dialog. */
  stale: boolean;
  detail: DetailView;
  /** The description being edited, or null. */
  draft: string | null;
  /** The draft is shown to be copied or discarded only, as the person can no longer edit. */
  draftReadOnly: boolean;
  /** Any card has a description draft with unsaved text. */
  hasDirty: boolean;
  saving: boolean;
  /** The checklist's saves and which of them are out. */
  checklist: ChecklistProps;
  /** The card's comments and activity, and the saves behind the comment box. */
  feed: FeedState;
  feedUi: CommentUi;
  feedControls: FeedControls;
  /** Changes one field of the card `cardId` (not necessarily the one on screen any more). */
  setField: (cardId: number, field: CardField) => void;
  startEdit: () => void;
  changeDraft: (text: string) => void;
  cancelDraft: () => void;
  saveDraft: () => void;
  retryDetail: () => void;
  /** Closes the dialog; false when unsaved text keeps it open (a toast says so). */
  requestClose: () => boolean;
  copyLink: () => void;
};

function sendField(boardId: number, id: number, field: CardField): Promise<CardsResult<CardDetail>> {
  switch (field.kind) {
    case "title":
      return patchCard(boardId, id, { title: field.value });
    case "due":
      return patchCard(boardId, id, { due_on: field.value });
    case "label":
      return field.on ? addCardLabel(boardId, id, field.id) : removeCardLabel(boardId, id, field.id);
    case "member":
      return field.on
        ? addCardMember(boardId, id, field.id)
        : removeCardMember(boardId, id, field.id);
  }
}

/**
 * The state and server calls behind the card dialog. Title, members, labels and due date change on
 * screen at once and go back on failure; the description waits for the server. Pass the result to
 * `CardDialog`.
 */
export function useCardEditor({
  boardId,
  cardKey,
  cards,
  setCards,
  track,
  notify,
  refresh,
  onForbidden,
  onGone,
  onExpired,
  role,
  polled,
}: Setup): CardEditor {
  const found = cardKey ? findByKey(cards, cardKey) : null;
  // The last tile of every card seen, so each draft finds its own card again.
  const tiles = useRef<Tiles>({});
  tiles.current = rememberTile(tiles.current, found);
  // One draft per card, so what is typed on one card is never lost by working on another.
  const [drafts, dispatch] = useReducer(draftsReducer, {});
  const [saving, setSaving] = useState(false);
  const [forcedGone, setForcedGone] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded>({
    id: null,
    state: "loading",
    description: null,
    checklist: [],
  });
  const [attempt, setAttempt] = useState(0);
  const canEdit = role !== "observer";

  // A draft keeps the dialog on its card even when a poll shows the card gone.
  const { tile: shown, stale } = dialogCard({
    cardKey,
    found,
    last: lastTileOf(tiles.current, cardKey),
    draft: cardKey ? draftForKey(drafts, cardKey) : undefined,
    forcedGone,
  });
  const openId = shown?.id ?? null;
  const editing = shown ? drafts[shown.id] : undefined;
  const mode = draftMode(canEdit, editing);

  const shownNow = useRef(shown);
  shownNow.current = shown;
  const draftNow = useRef(editing);
  draftNow.current = editing;
  const draftsNow = useRef(drafts);
  draftsNow.current = drafts;
  const cardsNow = useRef(cards);
  cardsNow.current = cards;
  const canEditNow = useRef(canEdit);
  canEditNow.current = canEdit;
  const savingNow = useRef(false);
  const detailNow = useRef(loaded);
  detailNow.current = loaded;
  const version = useRef(0);
  const tracker = useRef(createSaveTracker());

  function react(kind: CardError) {
    if (kind === "expired") onExpired();
    else if (kind === "forbidden") onForbidden();
    else if (kind === "not_found") onGone();
    else if (
      kind === "conflict" ||
      kind === "card_not_found" ||
      kind === "list_not_found" ||
      kind === "label_not_found" ||
      kind === "not_assignable"
    ) {
      void refresh();
    }
  }

  function fail(kind: CardError, text: string) {
    if (kind !== "not_found" && kind !== "expired") notify(text);
    react(kind);
  }

  /** Saves of the checklist that are still out: a poll must not replace the items meanwhile. */
  const writes = useRef(0);

  /** Puts the server's card on screen: items and description if it is the one shown, and the tile's counts. */
  function acceptServer(d: CardDetail) {
    version.current += 1;
    if (shownNow.current?.id === d.id) {
      setLoaded({ id: d.id, state: "ready", description: d.description, checklist: d.checklist });
    }
    setCards((cs) =>
      cs.map((c) =>
        c.id === d.id
          ? {
              ...c,
              checklist_done: d.checklist_done,
              checklist_total: d.checklist_total,
              comment_count: d.comment_count,
            }
          : c,
      ),
    );
  }

  /** Fetches card `id` again without the placeholder, for after a save the server did not take. */
  function reloadDetail(id: number) {
    void getCard(boardId, id).then((res) => {
      if (res.kind === "expired") onExpired();
      else if (res.kind === "ok" && writes.current === 0) acceptServer(res.data);
    });
  }

  const feedState = useCardFeed({
    boardId,
    openId,
    canEdit: () => canEditNow.current,
    polled,
    setCards,
    track,
    notify,
    fail,
  });
  const unsentNow = useRef(false);
  unsentNow.current = feedState.unsent;

  const checklist = useChecklist({
    boardId,
    openId,
    canEdit: () => canEditNow.current,
    items: () => detailNow.current.checklist,
    update: (id, change) => {
      const cur = detailNow.current;
      if (cur.id !== id) return;
      const next = change(cur.checklist);
      detailNow.current = { ...cur, checklist: next };
      setLoaded((l) => (l.id === id ? { ...l, checklist: next } : l));
      setCards((cs) => cs.map((c) => (c.id === id ? { ...c, ...countsOf(next) } : c)));
    },
    accept: acceptServer,
    reloadDetail,
    written: feedState.reload,
    writes,
    track,
    notify,
    fail,
  });

  // Load the open card's detail (the description) when a card opens.
  useEffect(() => {
    if (openId === null) return;
    let live = true;
    setLoaded({ id: openId, state: "loading", description: null, checklist: [] });
    void getCard(boardId, openId).then((res) => {
      if (!live) return;
      if (res.kind === "ok") {
        setLoaded({
          id: openId,
          state: "ready",
          description: res.data.description,
          checklist: res.data.checklist,
        });
        return;
      }
      setLoaded({ id: openId, state: "error", description: null, checklist: [] });
      if (res.kind !== "network" && res.kind !== "server" && res.kind !== "invalid") react(res.kind);
    });
    return () => {
      live = false;
    };
  }, [boardId, openId, attempt]);

  // After an applied poll the detail is fetched again, unless a draft or a save is in the way.
  useEffect(() => {
    if (polled === 0) return;
    const current = shownNow.current;
    if (
      !current ||
      writes.current > 0 ||
      !shouldRefetchDetail({ open: true, draft: draftNow.current !== undefined, saving: savingNow.current })
    ) {
      return;
    }
    const startVersion = version.current;
    void getCard(boardId, current.id).then((res) => {
      if (res.kind === "expired") {
        onExpired();
        return;
      }
      if (res.kind !== "ok") return;
      const accepted = acceptDetail({
        openId: shownNow.current?.id ?? null,
        fetchedId: current.id,
        draft: draftNow.current !== undefined,
        startVersion,
        version: version.current,
      });
      if (accepted && writes.current === 0) {
        setLoaded({
          id: current.id,
          state: "ready",
          description: res.data.description,
          checklist: res.data.checklist,
        });
      }
    });
  }, [polled]);

  // The "card is gone" mark ends when the address moves on, or a later snapshot has the card again.
  useEffect(() => {
    setForcedGone((mark) => keepForcedGone(mark, cardKey, found !== null));
  }, [cardKey, polled]);

  // Leaving a card by address (Back, a link): its draft stays in memory, and a toast says so.
  const lastKey = useRef(cardKey);
  useEffect(() => {
    const left = lastKey.current;
    lastKey.current = cardKey;
    if (left === null || left === cardKey) return;
    if (keptOnLeave(draftsNow.current, left)) notify(DRAFT_KEPT_TEXT);
    dispatch({ type: "leave", key: left });
  }, [cardKey]);

  /** Changes a field of card `id` on screen at once, then saves it, one save at a time per field. */
  function setField(id: number, field: CardField) {
    // Silent: a field that unmounts after the person became an observer must not send anything.
    if (!canEditNow.current) return;
    const card = cardsNow.current.find((c) => c.id === id);
    if (!card) return;
    const before = readField(card, field);
    if (sameField(before, field)) return;
    setCards((cs) => cs.map((c) => (c.id === id ? withField(c, field) : c)));
    const key = fieldKey(id, field);
    const send = tracker.current.request(key, before, field);
    if (send !== null) sendNext(id, key, send);
  }

  function sendNext(id: number, key: string, field: CardField) {
    const put = (value: CardField) =>
      setCards((cs) => cs.map((c) => (c.id === id ? withField(c, value) : c)));
    void track(sendField(boardId, id, field)).then((res) => {
      const step = tracker.current.settle(
        key,
        res.kind === "ok" ? { ok: true, value: readField(res.data, field) } : { ok: false },
      );
      if (step.screen.kind !== "keep") put(step.screen.value);
      if (step.next !== null) sendNext(id, key, step.next);
      if (res.kind === "ok") {
        // Every change is an entry in the activity.
        feedState.reload(id);
        return;
      }
      // Only a failure that took the field back says "undone"; any other settles quietly.
      if (step.screen.kind === "revert") fail(res.kind, cardFailureText(res.kind, true));
      else react(res.kind);
    });
  }

  function saveDraft() {
    const d = draftNow.current;
    if (!d || savingNow.current || !canEditNow.current) return;
    savingNow.current = true;
    setSaving(true);
    void track(patchCard(boardId, d.id, { description: descriptionToSend(d.text) })).then((res) => {
      savingNow.current = false;
      setSaving(false);
      if (res.kind === "ok") {
        version.current += 1;
        // Another card may be on screen by now (Back, open B): its detail must not be replaced.
        if (shownNow.current?.id === d.id) {
          setLoaded({
            id: d.id,
            state: "ready",
            description: res.data.description,
            checklist: res.data.checklist,
          });
        }
        feedState.reload(d.id);
        dispatch({ type: "drop", id: d.id });
        setCards((cs) =>
          cs.map((c) => (c.id === d.id ? { ...c, has_description: res.data.has_description } : c)),
        );
        return;
      }
      if (res.kind === "card_not_found") {
        // The card is gone, so the dialog goes with it; the toast says the text was not saved.
        notify(descriptionFailureText(res.kind));
        dispatch({ type: "drop", id: d.id });
        setForcedGone(d.key);
        void refresh();
        return;
      }
      if (res.kind !== "not_found" && res.kind !== "expired") notify(descriptionFailureText(res.kind));
      react(res.kind);
    });
  }

  function requestClose(): boolean {
    const blocker = closeBlocker({
      canEdit: canEditNow.current,
      draft: draftNow.current,
      commentUnsent: unsentNow.current,
    });
    if (blocker !== null) {
      // Not silently: the dialog stays open until the person saves, posts or clears the text.
      notify(blocker === "description" ? DRAFT_OPEN_TEXT : COMMENT_OPEN_TEXT);
      return false;
    }
    dispatch({ type: "close", id: shownNow.current?.id ?? null });
    navigate(`/boards/${boardId}`);
    return true;
  }

  async function copyLink() {
    if (!cardKey) return;
    const url = `${window.location.origin}${cardPath(boardId, cardKey)}`;
    try {
      await navigator.clipboard.writeText(url);
      notify(LINK_COPIED_TEXT);
    } catch {
      notify(LINK_FAILED_TEXT);
    }
  }

  const detail: DetailView =
    loaded.id === openId && openId !== null
      ? { state: loaded.state, description: loaded.description, checklist: loaded.checklist }
      : { state: "loading", description: null, checklist: [] };

  return {
    tile: shown,
    stale,
    detail,
    draft: editing?.text ?? null,
    draftReadOnly: mode === "readonly",
    hasDirty: anyDirty(drafts),
    saving,
    checklist: {
      busyIds: checklist.busyIds,
      adding: checklist.adding,
      onToggle: checklist.toggle,
      onDelete: checklist.remove,
      onAdd: checklist.add,
    },
    feed: feedState.feed,
    feedUi: feedState.ui,
    feedControls: feedState.controls,
    setField,
    startEdit: () => {
      const card = shownNow.current;
      if (!card || !canEditNow.current) return;
      if (detailNow.current.state !== "ready" || detailNow.current.id !== card.id) return;
      const original = detailNow.current.description;
      dispatch({
        type: "start",
        entry: { key: card.key, id: card.id, text: original ?? "", original },
      });
    },
    changeDraft: (text) => {
      const d = draftNow.current;
      if (d && canEditNow.current) dispatch({ type: "change", id: d.id, text });
    },
    cancelDraft: () => {
      const d = draftNow.current;
      if (d) dispatch({ type: "cancel", id: d.id, saving: savingNow.current });
    },
    saveDraft,
    retryDetail: () => setAttempt((n) => n + 1),
    requestClose,
    copyLink: () => void copyLink(),
  };
}

type Props = {
  board: { name: string; my_role: BoardRole };
  lists: BoardList[];
  labels: Label[];
  people: BoardMember[];
  total: number;
  editor: CardEditor;
  /** Moves a card to the end of another list, through the board's move rule. */
  onMoveCardTo: (cardId: number, listId: number) => void;
  onCopyCard: (cardId: number) => void;
  /** Archives a card: the tile leaves the board at once, and the toast brings Undo. */
  onArchiveCard: (cardId: number) => void;
};

/**
 * The card dialog over the board: the board behind it is inert, focus moves in and goes back to
 * the card's tile on close. Esc closes a popup first, then a description edit, then leaves a
 * field, then closes the dialog.
 */
export function CardDialog({
  board,
  lists,
  labels,
  people,
  total,
  editor: ed,
  onMoveCardTo,
  onCopyCard,
  onArchiveCard,
}: Props) {
  const [pop, setPop] = useState<Pop>(null);
  const [memberQuery, setMemberQuery] = useState("");
  const frame = useRef<HTMLDivElement>(null);
  const tile = ed.tile;
  const tileId = useRef<number | null>(null);
  if (tile) tileId.current = tile.id;

  // Esc cancels only a draft that can be edited; a read-only one is left with Discard.
  const editingDraft = ed.draft !== null && !ed.draftReadOnly;
  const live = useRef({
    pop,
    draft: editingDraft,
    commentEdit: ed.feedUi.edit !== null,
    cancel: ed.cancelDraft,
    cancelComment: ed.feedControls.onEditCancel,
    close: ed.requestClose,
  });
  live.current = {
    pop,
    draft: editingDraft,
    commentEdit: ed.feedUi.edit !== null,
    cancel: ed.cancelDraft,
    cancelComment: ed.feedControls.onEditCancel,
    close: ed.requestClose,
  };

  // A members or labels popup hangs below its button, inside a body that scrolls. Make the body at
  // least tall enough to hold it (as far as the dialog may grow), so it is not cut off.
  useLayoutEffect(() => {
    const modal = frame.current;
    const body = modal?.querySelector<HTMLElement>(".modal-body");
    const menu = body?.querySelector<HTMLElement>(".pop");
    if (!modal || !body || !menu || (pop !== "members" && pop !== "labels")) return;
    const room = parseFloat(getComputedStyle(modal).maxHeight);
    const top = modal.querySelector<HTMLElement>(".modal-top")?.offsetHeight ?? 0;
    const needed =
      menu.getBoundingClientRect().bottom - body.getBoundingClientRect().top + body.scrollTop + 12;
    body.style.minHeight = `${Math.min(needed, Number.isNaN(room) ? needed : room - top)}px`;
    menu.scrollIntoView?.({ block: "nearest" });
    return () => {
      body.style.minHeight = "";
    };
  }, [pop]);

  // The board behind is inert while the dialog is open; focus goes into the dialog and, on close,
  // back to the card's tile.
  useEffect(() => {
    const root = document.getElementById("root");
    root?.setAttribute("inert", "");
    return () => {
      root?.removeAttribute("inert");
      if (tileId.current !== null) {
        document.querySelector<HTMLElement>(`[data-card="${tileId.current}"]`)?.focus();
      }
    };
  }, []);

  const gone = tile === null;
  useEffect(() => {
    frame.current?.focus();
  }, [gone]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc that picks or cancels an input-method candidate is not meant for the dialog.
      if (e.key !== "Escape" || e.isComposing) return;
      const s = live.current;
      const target = e.target instanceof Element ? e.target : null;
      const action = escapeAction({
        popup: s.pop !== null,
        typingInDraft: s.draft && !!target?.closest("[data-desc] textarea"),
        typingInCommentEdit: s.commentEdit && !!target?.closest("[data-comment-edit] textarea"),
        typing: !!target?.closest("input, textarea, select"),
      });
      e.preventDefault();
      if (action === "close-popup") {
        const trigger = frame.current?.querySelector<HTMLElement>(`[data-pop="${s.pop}"]`);
        setPop(null);
        setMemberQuery("");
        trigger?.focus();
      } else if (action === "cancel-draft") s.cancel();
      else if (action === "cancel-comment-edit") s.cancelComment();
      else if (action === "blur") (target as HTMLElement).blur();
      else s.close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (pop === null) return;
    const close = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest(".pop, [data-pop]")) return;
      setPop(null);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [pop]);

  const c: DialogControls = {
    onClose: ed.requestClose,
    onBackdrop: () => {
      if (pop !== null) setPop(null);
      else ed.requestClose();
    },
    onPop: (next) => {
      setPop(next);
      setMemberQuery("");
    },
    onMemberQuery: setMemberQuery,
    onToggleMember: (id, on) => {
      if (tile) ed.setField(tile.id, { kind: "member", id, on });
    },
    onToggleLabel: (id, on) => {
      if (tile) ed.setField(tile.id, { kind: "label", id, on });
    },
    onTitle: (value, cardId) => ed.setField(cardId, { kind: "title", value }),
    onDue: (value, cardId) => ed.setField(cardId, { kind: "due", value }),
    onEdit: ed.startEdit,
    onDraft: ed.changeDraft,
    onSaveDraft: ed.saveDraft,
    onCancelDraft: ed.cancelDraft,
    onRetryDetail: ed.retryDetail,
    onMoveTo: (listId) => {
      setPop(null);
      if (tile) onMoveCardTo(tile.id, listId);
    },
    onCopy: () => {
      setPop(null);
      if (tile) onCopyCard(tile.id);
    },
    onCopyLink: () => {
      setPop(null);
      ed.copyLink();
    },
    onArchive: () => {
      setPop(null);
      const id = tile?.id;
      // Unsaved text keeps the dialog (and the card) as it is; the person saves or clears it first.
      if (id !== undefined && ed.requestClose()) onArchiveCard(id);
    },
  };

  return createPortal(
    <CardDialogView
      board={board}
      tile={tile}
      lists={lists}
      labels={labels}
      people={people}
      total={total}
      detail={ed.detail}
      ui={{ pop, memberQuery, draft: ed.draft, saving: ed.saving, stale: ed.stale }}
      c={c}
      checklist={ed.checklist}
      feed={ed.feed}
      feedUi={ed.feedUi}
      feedC={ed.feedControls}
      frameRef={frame}
    />,
    document.body,
  );
}
