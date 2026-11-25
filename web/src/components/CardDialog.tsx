import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useLayoutEffect,
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
  type Label,
  addCardLabel,
  addCardMember,
  getCard,
  patchCard,
  removeCardLabel,
  removeCardMember,
} from "../api";
import { DUE_LABEL, dueState, formatDue } from "../cards/due";
import {
  type CardField,
  DESCRIPTION_LIMIT,
  acceptDetail,
  assignablePeople,
  canAddCard,
  createSaveTracker,
  descriptionToSend,
  draftDirty,
  escapeAction,
  fieldKey,
  findByKey,
  matchPeople,
  readField,
  shouldRefetchDetail,
  showPeopleSearch,
  titleFrom,
  withField,
} from "../cards/logic";
import {
  DRAFT_KEPT_TEXT,
  DRAFT_OPEN_TEXT,
  LINK_COPIED_TEXT,
  LINK_FAILED_TEXT,
  cardFailureText,
  descriptionFailureText,
} from "../cards/text";
import { cardPath, navigate } from "../routes";
import { CardAvatar, LabelChip } from "./Cards";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";

export type Pop = "members" | "labels" | "menu" | null;

/** The description as the dialog knows it: loading, loaded or failed to load. */
export type DetailView = {
  state: "loading" | "ready" | "error";
  description: string | null;
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
  onTitle: (title: string) => void;
  onDue: (day: string | null) => void;
  onEdit: () => void;
  onDraft: (text: string) => void;
  onSaveDraft: () => void;
  onCancelDraft: () => void;
  onRetryDetail: () => void;
  onMoveTo: (listId: number) => void;
  onCopy: () => void;
  onCopyLink: () => void;
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
  frameRef?: Ref<HTMLDivElement>;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The card title as a textarea that grows with its text. Enter saves, Esc puts the old title back. */
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

  useEffect(() => {
    if (!focused.current) setText(title);
  }, [title]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  function commit() {
    const next = titleFrom(text);
    if (next === null || next === title) {
      setText(title);
      return;
    }
    setText(next);
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
 * The native date input. A date is saved when the field loses focus or stays unchanged for a
 * moment, never while it is half typed (typing a year passes through 0002, 0020, ...). An
 * incomplete date is dropped; the Clear button is how a date is removed.
 */
function DueField({ value, onCommit }: { value: string | null; onCommit?: (day: string | null) => void }) {
  const [text, setText] = useState(value ?? "");
  const latest = useRef({ text, value });
  latest.current = { text, value };

  useEffect(() => {
    setText(value ?? "");
  }, [value]);

  function commit() {
    const { text: now, value: saved } = latest.current;
    if (DATE_RE.test(now) && now !== (saved ?? "")) onCommit?.(now);
    else if (!DATE_RE.test(now)) setText(saved ?? "");
  }

  useEffect(() => {
    if (!DATE_RE.test(text) || text === (value ?? "")) return;
    const timer = setTimeout(commit, 800);
    return () => clearTimeout(timer);
  }, [text]);

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
  let body;
  if (draft !== null) {
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
          <span className="fine counter">
            {`${draft.length.toLocaleString("en-US")} / ${DESCRIPTION_LIMIT.toLocaleString("en-US")}`}
          </span>
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
            <p>It may have been archived or moved to another board.</p>
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
  const draft = editor ? (ui.draft ?? null) : null;
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
        <div className="modal-body">
          {ui.stale && (
            <div className="banner warn">
              <Icon name="alert" /> This card is no longer on the board. Copy your text, then save
              it or close the card.
            </div>
          )}
          {editor ? (
            <TitleField title={tile.title} popOpen={pop !== null} onCommit={c.onTitle} />
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
                  <DueField value={tile.due_on} onCommit={c.onDue} />
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
  notify: (text: string) => void;
  /** Loads the board, lists and cards again. */
  refresh: () => Promise<void>;
  onForbidden: () => void;
  onGone: () => void;
  /** Counts the polls that were applied; each one refetches the open card's detail. */
  polled: number;
};

type Draft = { key: string; id: number; text: string; original: string | null };
type Loaded = { id: number | null; state: DetailView["state"]; description: string | null };

export type CardEditor = {
  /** The card the dialog shows; null when it is not on the board. */
  tile: Card | null;
  /** True when the card left the board but an open draft keeps the dialog. */
  stale: boolean;
  detail: DetailView;
  /** The description being edited, or null. */
  draft: string | null;
  saving: boolean;
  setField: (field: CardField) => void;
  startEdit: () => void;
  changeDraft: (text: string) => void;
  cancelDraft: () => void;
  saveDraft: () => void;
  retryDetail: () => void;
  requestClose: () => void;
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
  polled,
}: Setup): CardEditor {
  const found = cardKey ? findByKey(cards, cardKey) : null;
  const lastTile = useRef<Card | null>(null);
  if (found) lastTile.current = found;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [forcedGone, setForcedGone] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded>({ id: null, state: "loading", description: null });
  const [attempt, setAttempt] = useState(0);

  // A draft keeps the dialog on its card even when a poll shows the card gone.
  const keepsDraft = draft !== null && cardKey === draft.key && lastTile.current?.key === cardKey;
  const stale = !found && keepsDraft;
  const shown = forcedGone !== null && forcedGone === cardKey ? null : (found ?? (keepsDraft ? lastTile.current : null));
  const openId = shown?.id ?? null;
  const editing = draft !== null && shown !== null && draft.id === shown.id ? draft : null;

  const shownNow = useRef(shown);
  shownNow.current = shown;
  const draftNow = useRef(editing);
  draftNow.current = editing;
  const savingNow = useRef(false);
  const detailNow = useRef(loaded);
  detailNow.current = loaded;
  const version = useRef(0);
  const tracker = useRef(createSaveTracker());

  function react(kind: CardError) {
    if (kind === "expired") window.location.reload();
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

  // Load the open card's detail (the description) when a card opens.
  useEffect(() => {
    if (openId === null) return;
    let live = true;
    setLoaded({ id: openId, state: "loading", description: null });
    void getCard(boardId, openId).then((res) => {
      if (!live) return;
      if (res.kind === "ok") {
        setLoaded({ id: openId, state: "ready", description: res.data.description });
        return;
      }
      setLoaded({ id: openId, state: "error", description: null });
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
      !shouldRefetchDetail({ open: true, draft: draftNow.current !== null, saving: savingNow.current })
    ) {
      return;
    }
    const startVersion = version.current;
    void getCard(boardId, current.id).then((res) => {
      if (res.kind === "expired") {
        window.location.reload();
        return;
      }
      if (res.kind !== "ok") return;
      const accepted = acceptDetail({
        openId: shownNow.current?.id ?? null,
        fetchedId: current.id,
        draft: draftNow.current !== null,
        startVersion,
        version: version.current,
      });
      if (accepted) setLoaded({ id: current.id, state: "ready", description: res.data.description });
    });
  }, [polled]);

  // Leaving the card with an unsaved draft (Back, a link): keep the draft and say so.
  useEffect(() => {
    if (draft === null || draft.key === cardKey) return;
    if (draftDirty(draft.original, draft.text)) notify(DRAFT_KEPT_TEXT);
    else setDraft(null);
  }, [cardKey]);

  function setField(field: CardField) {
    const card = shownNow.current;
    if (!card) return;
    const key = fieldKey(field);
    const before = readField(card, field);
    if (JSON.stringify(before) === JSON.stringify(field)) return;
    const ticket = tracker.current.start(key, before);
    const id = card.id;
    const put = (value: CardField) =>
      setCards((cs) => cs.map((c) => (c.id === id ? withField(c, value) : c)));
    put(field);
    void track(sendField(boardId, id, field)).then((res) => {
      if (res.kind === "ok") {
        const settled = tracker.current.settle(key, ticket, {
          ok: true,
          value: readField(res.data, field),
        });
        if (settled.kind === "apply") put(settled.value);
        return;
      }
      const settled = tracker.current.settle(key, ticket, { ok: false });
      if (settled.kind === "revert") put(settled.value);
      fail(res.kind, cardFailureText(res.kind, true));
    });
  }

  function saveDraft() {
    const d = draftNow.current;
    if (!d || savingNow.current) return;
    savingNow.current = true;
    setSaving(true);
    void track(patchCard(boardId, d.id, { description: descriptionToSend(d.text) })).then((res) => {
      savingNow.current = false;
      setSaving(false);
      if (res.kind === "ok") {
        version.current += 1;
        setLoaded({ id: d.id, state: "ready", description: res.data.description });
        setDraft((cur) => (cur && cur.id === d.id ? null : cur));
        setCards((cs) =>
          cs.map((c) => (c.id === d.id ? { ...c, has_description: res.data.has_description } : c)),
        );
        return;
      }
      if (res.kind === "card_not_found") {
        // The card is gone, so the dialog goes with it; the toast says the text was not saved.
        notify(descriptionFailureText(res.kind));
        setDraft(null);
        setForcedGone(d.key);
        void refresh();
        return;
      }
      if (res.kind !== "not_found" && res.kind !== "expired") notify(descriptionFailureText(res.kind));
      react(res.kind);
    });
  }

  function requestClose() {
    const d = draftNow.current;
    if (d && draftDirty(d.original, d.text)) {
      // Not silently: the dialog stays open until the person saves or cancels.
      notify(DRAFT_OPEN_TEXT);
      return;
    }
    setDraft(null);
    navigate(`/boards/${boardId}`);
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
      ? { state: loaded.state, description: loaded.description }
      : { state: "loading", description: null };

  return {
    tile: shown,
    stale,
    detail,
    draft: editing?.text ?? null,
    saving,
    setField,
    startEdit: () => {
      const card = shownNow.current;
      if (!card || detailNow.current.state !== "ready" || detailNow.current.id !== card.id) return;
      const original = detailNow.current.description;
      setDraft({ key: card.key, id: card.id, text: original ?? "", original });
    },
    changeDraft: (text) => setDraft((d) => (d ? { ...d, text } : d)),
    cancelDraft: () => setDraft(null),
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
}: Props) {
  const [pop, setPop] = useState<Pop>(null);
  const [memberQuery, setMemberQuery] = useState("");
  const frame = useRef<HTMLDivElement>(null);
  const tile = ed.tile;
  const tileId = useRef<number | null>(null);
  if (tile) tileId.current = tile.id;

  const live = useRef({ pop, draft: ed.draft !== null, cancel: ed.cancelDraft, close: ed.requestClose });
  live.current = { pop, draft: ed.draft !== null, cancel: ed.cancelDraft, close: ed.requestClose };

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
      if (e.key !== "Escape") return;
      const s = live.current;
      const target = e.target instanceof Element ? e.target : null;
      const action = escapeAction({
        popup: s.pop !== null,
        typingInDraft: s.draft && !!target?.closest("[data-desc] textarea"),
        typing: !!target?.closest("input, textarea, select"),
      });
      e.preventDefault();
      if (action === "close-popup") {
        const trigger = frame.current?.querySelector<HTMLElement>(`[data-pop="${s.pop}"]`);
        setPop(null);
        setMemberQuery("");
        trigger?.focus();
      } else if (action === "cancel-draft") s.cancel();
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
    onToggleMember: (id, on) => ed.setField({ kind: "member", id, on }),
    onToggleLabel: (id, on) => ed.setField({ kind: "label", id, on }),
    onTitle: (value) => ed.setField({ kind: "title", value }),
    onDue: (value) => ed.setField({ kind: "due", value }),
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
      frameRef={frame}
    />,
    document.body,
  );
}
