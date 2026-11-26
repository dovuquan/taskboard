import { type FormEvent, useEffect, useRef, useState } from "react";

import {
  type Card,
  type CardError,
  type CommentEntry,
  type FeedEntry,
  deleteComment,
  editComment,
  getFeed,
  postComment,
  restoreComment,
} from "../api";
import {
  type ActivityContext,
  actorName,
  activityText,
  canChangeComment,
  commentUnsent,
  shownEntries,
  whenText,
} from "../cards/feed";
import {
  COMMENT_DELETED_TEXT,
  COMMENT_UPDATED_TEXT,
  UNDO_FAILED_TEXT,
  commentFailureText,
} from "../cards/text";
import { CardAvatar, GlyphIcon, LinkedText } from "./Cards";

/** The feed as the dialog knows it: loading, loaded or failed to load. */
export type FeedState = {
  state: "loading" | "ready" | "error";
  entries: FeedEntry[];
  /** The server has older entries than the ones sent. */
  more: boolean;
};

/** A comment being edited, with the text it started from. */
export type CommentEdit = { id: number; text: string; original: string };

export type CommentUi = {
  /** The text in the new-comment box. */
  text: string;
  posting: boolean;
  edit: CommentEdit | null;
  /** The edit's save is out. */
  saving: boolean;
  /** Show every entry, not just the first four. */
  all: boolean;
};

export type FeedControls = {
  onText: (text: string) => void;
  onPost: () => void;
  onEdit: (comment: CommentEntry) => void;
  onEditText: (text: string) => void;
  onEditSave: () => void;
  onEditCancel: () => void;
  onDelete: (id: number) => void;
  onAll: () => void;
  onRetry: () => void;
};

type ViewProps = ActivityContext & {
  feed: FeedState;
  /** Owners and members post and change their own comments; observers only read. */
  editor: boolean;
  /** The time the entries are measured against, in milliseconds. */
  now: number;
  ui?: Partial<CommentUi>;
  c?: Partial<FeedControls>;
};

function CommentRow({
  entry,
  editor,
  now,
  ui,
  c,
}: {
  entry: CommentEntry;
  editor: boolean;
  now: number;
  ui: Partial<CommentUi>;
  c: Partial<FeedControls>;
}) {
  const author = entry.author;
  const name = author?.name ?? "someone";
  const editing = ui.edit?.id === entry.id ? ui.edit : null;
  const mine = editor && canChangeComment(entry.editable_until, now);
  const when = whenText(entry.created_at, now);
  return (
    <div className="entry">
      <CardAvatar person={author ? { id: author.id, name: author.name, email: "" } : undefined} />
      <div className="body">
        <div className="who">
          <b>{name}</b>
          <span title={entry.created_at}>{entry.edited_at ? `${when} · edited` : when}</span>
        </div>
        {editing ? (
          <div data-comment-edit="">
            <textarea
              className="input"
              rows={2}
              maxLength={5000}
              aria-label="Edit your comment"
              autoFocus
              readOnly={ui.saving ?? false}
              value={editing.text}
              onChange={(e) => c.onEditText?.(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  c.onEditSave?.();
                }
              }}
            ></textarea>
            <div className="c-acts">
              <button
                className="btn primary sm"
                type="button"
                disabled={ui.saving ?? false}
                onClick={() => c.onEditSave?.()}
              >
                Save
              </button>
              <button
                className="btn ghost sm"
                type="button"
                disabled={ui.saving ?? false}
                onClick={() => c.onEditCancel?.()}
              >
                Cancel
              </button>
              <span className="fine">Ctrl/⌘+Enter · Esc</span>
            </div>
          </div>
        ) : (
          <>
            <div className="text">
              <LinkedText text={entry.text} />
            </div>
            {mine && (
              <div className="c-acts">
                <button className="linkish" type="button" onClick={() => c.onEdit?.(entry)}>
                  Edit
                </button>
                <span className="muted">·</span>
                <button className="linkish" type="button" onClick={() => c.onDelete?.(entry.id)}>
                  Delete
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Comments and activity as plain markup: the comment box, then the entries, newest first. */
export function CardFeedView({ feed, editor, now, lists, people, ui = {}, c = {} }: ViewProps) {
  const entries = shownEntries(feed.entries, ui.all ?? false);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    c.onPost?.();
  }

  let body;
  if (feed.state === "loading") {
    body = (
      <div className="skel-list" aria-busy="true">
        <div className="skel"></div>
      </div>
    );
  } else if (feed.state === "error") {
    body = (
      <div className="desc-error">
        <span className="fine">Couldn't load the comments and activity.</span>
        <button className="btn sm" type="button" onClick={() => c.onRetry?.()}>
          Try again
        </button>
      </div>
    );
  } else if (feed.entries.length === 0) {
    body = <p className="muted">No comments yet.</p>;
  } else {
    body = (
      <div className="card-feed">
        {entries.map((entry) =>
          entry.type === "comment" ? (
            <CommentRow key={`c${entry.id}`} entry={entry} editor={editor} now={now} ui={ui} c={c} />
          ) : (
            <div className="entry activity" key={`e${entry.id}`}>
              <span className="dot">
                <GlyphIcon name="act" />
              </span>
              <div className="body who">
                <b>{actorName(entry)}</b> {activityText(entry, { lists, people })}
                <span title={entry.at}>{whenText(entry.at, now)}</span>
              </div>
            </div>
          ),
        )}
      </div>
    );
  }

  return (
    <>
      <h3>Comments and activity</h3>
      {editor ? (
        <form className="comment-box" onSubmit={onSubmit}>
          <textarea
            className="input"
            rows={2}
            placeholder="Write a comment"
            maxLength={5000}
            aria-label="Write a comment"
            readOnly={ui.posting ?? false}
            value={ui.text ?? ""}
            onChange={(e) => c.onText?.(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                c.onPost?.();
              }
            }}
          ></textarea>
          <div>
            <button className="btn primary sm" type="submit" disabled={ui.posting ?? false}>
              Comment
            </button>
          </div>
        </form>
      ) : (
        <p className="fine">Observers can read comments but not post.</p>
      )}
      {body}
      {feed.state === "ready" && feed.entries.length > 4 && (
        <button className="linkish" type="button" onClick={() => c.onAll?.()}>
          {ui.all ? "Show fewer" : `Show all ${feed.entries.length}`}
        </button>
      )}
      {feed.state === "ready" && feed.more && (
        <p className="fine">Only the newest 200 entries are shown.</p>
      )}
    </>
  );
}

/** What the feed needs from the card dialog. */
export type FeedEnv = {
  boardId: number;
  /** The card the dialog shows, or null. */
  openId: number | null;
  /** The person can post and change comments right now. */
  canEdit: () => boolean;
  /** Counts the polls that were applied; each one fetches the feed again. */
  polled: number;
  setCards: (update: (cards: Card[]) => Card[]) => void;
  track: <T>(save: Promise<T>) => Promise<T>;
  notify: (text: string, undo?: () => void) => void;
  /** A failure: toasts the text (unless the session ended) and reacts to the kind. */
  fail: (kind: CardError, text: string) => void;
};

type Loaded = FeedState & { id: number | null };

/**
 * The feed and the comment saves. Posting and editing wait for the server; deleting removes the
 * comment at once and offers Undo once the server has confirmed. The feed is fetched when a card
 * opens, after every applied poll and after every save that adds an entry.
 */
export function useCardFeed(env: FeedEnv) {
  const [loaded, setLoaded] = useState<Loaded>({ id: null, state: "loading", entries: [], more: false });
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [edit, setEdit] = useState<CommentEdit | null>(null);
  const [saving, setSaving] = useState(false);
  const [all, setAll] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const now = useRef(env);
  now.current = env;
  const textNow = useRef(text);
  textNow.current = text;
  const editNow = useRef(edit);
  editNow.current = edit;
  const postingNow = useRef(false);
  const savingNow = useRef(false);
  /** Only the newest request may land. */
  const request = useRef(0);
  const openId = env.openId;

  function load(card: number, quiet: boolean) {
    const mine = ++request.current;
    if (!quiet) setLoaded({ id: card, state: "loading", entries: [], more: false });
    void getFeed(now.current.boardId, card).then((res) => {
      if (mine !== request.current) return;
      if (res.kind === "ok") {
        setLoaded({ id: card, state: "ready", entries: res.data.entries, more: res.data.more });
      } else if (res.kind === "expired") {
        now.current.fail(res.kind, "");
      } else if (!quiet) {
        setLoaded({ id: card, state: "error", entries: [], more: false });
      }
    });
  }

  // A card opens: its own empty box, and its feed.
  useEffect(() => {
    setText("");
    setEdit(null);
    setAll(false);
    if (openId !== null) load(openId, false);
    else request.current += 1;
  }, [env.boardId, openId, attempt]);

  // After an applied poll the feed is fetched again, without the placeholder.
  useEffect(() => {
    if (env.polled === 0 || now.current.openId === null) return;
    load(now.current.openId, true);
  }, [env.polled]);

  function reload(card: number) {
    if (now.current.openId === card) load(card, true);
  }

  function bumpCount(card: number, by: number) {
    now.current.setCards((cs) =>
      cs.map((c) => (c.id === card ? { ...c, comment_count: Math.max(0, (c.comment_count ?? 0) + by) } : c)),
    );
  }

  async function post() {
    const e = now.current;
    const card = e.openId;
    const sent = textNow.current;
    if (card === null || sent.trim() === "" || !e.canEdit() || postingNow.current) return;
    postingNow.current = true;
    setPosting(true);
    const res = await e.track(postComment(e.boardId, card, sent.trim()));
    postingNow.current = false;
    setPosting(false);
    if (res.kind === "ok") {
      // Text typed meanwhile stays; so does a box the person moved to another card with.
      if (now.current.openId === card && textNow.current === sent) setText("");
      bumpCount(card, 1);
      reload(card);
      return;
    }
    e.fail(res.kind, commentFailureText(res.kind));
  }

  async function saveEdit() {
    const e = now.current;
    const card = e.openId;
    const open = editNow.current;
    if (card === null || open === null || savingNow.current || !e.canEdit()) return;
    const next = open.text.trim();
    if (next === "") return;
    if (next === open.original.trim()) {
      setEdit(null);
      return;
    }
    savingNow.current = true;
    setSaving(true);
    const res = await e.track(editComment(e.boardId, card, open.id, next));
    savingNow.current = false;
    setSaving(false);
    if (res.kind === "ok") {
      setEdit(null);
      e.notify(COMMENT_UPDATED_TEXT);
      reload(card);
      return;
    }
    // The window closed or the comment is gone: the box has nothing left to save to.
    if (res.kind === "edit_window_closed" || res.kind === "comment_not_found") {
      setEdit(null);
      reload(card);
    }
    e.fail(res.kind, commentFailureText(res.kind));
  }

  function undoDelete(card: number, id: number) {
    const e = now.current;
    void e.track(restoreComment(e.boardId, card, id)).then((res) => {
      if (res.kind === "ok") {
        bumpCount(card, 1);
      } else {
        e.fail(res.kind, res.kind === "comment_limit" ? commentFailureText(res.kind) : UNDO_FAILED_TEXT);
      }
      reload(card);
    });
  }

  function remove(id: number) {
    const e = now.current;
    const card = e.openId;
    if (card === null || !e.canEdit()) return;
    if (editNow.current?.id === id) setEdit(null);
    setLoaded((l) => ({ ...l, entries: l.entries.filter((x) => !(x.type === "comment" && x.id === id)) }));
    void e.track(deleteComment(e.boardId, card, id)).then((res) => {
      if (res.kind === "ok") {
        bumpCount(card, -1);
        // Undo is offered only now: the server has the delete.
        e.notify(COMMENT_DELETED_TEXT, () => undoDelete(card, id));
      } else {
        e.fail(res.kind, commentFailureText(res.kind));
      }
      reload(card);
    });
  }

  const feed: FeedState =
    loaded.id === openId && openId !== null
      ? { state: loaded.state, entries: loaded.entries, more: loaded.more }
      : { state: "loading", entries: [], more: false };

  return {
    feed,
    ui: { text, posting, edit, saving, all },
    unsent: commentUnsent(text, edit),
    /** Fetches the feed again without the placeholder (after any save that adds an entry). */
    reload: (card: number) => reload(card),
    controls: {
      onText: setText,
      onPost: () => void post(),
      onEdit: (comment: CommentEntry) => {
        if (!now.current.canEdit()) return;
        setEdit({ id: comment.id, text: comment.text, original: comment.text });
      },
      onEditText: (next: string) => setEdit((cur) => (cur ? { ...cur, text: next } : cur)),
      onEditSave: () => void saveEdit(),
      onEditCancel: () => {
        if (!savingNow.current) setEdit(null);
      },
      onDelete: remove,
      onAll: () => setAll((a) => !a),
      onRetry: () => setAttempt((n) => n + 1),
    },
  };
}
