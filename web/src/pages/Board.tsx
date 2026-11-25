import { type ReactNode, useEffect, useRef, useState } from "react";

import {
  type BoardDetail,
  type BoardList,
  type BoardMember,
  type Card,
  type Label,
  type Me,
  getBoard,
  getBoardMembers,
  getCards,
  getLabels,
  getLists,
} from "../api";
import { canAddCard, expiredAction, groupByList, shouldApply, ungroup } from "../cards/logic";
import { startBoardPoller } from "../cards/poller";
import { CARD_LIMIT_TEXT, EXPIRED_DRAFT_TEXT } from "../cards/text";
import { AvatarStack } from "../components/Avatar";
import { BoardSettings } from "../components/BoardSettings";
import { CardDialog, useCardEditor } from "../components/CardDialog";
import type { CardPerson } from "../components/Cards";
import { Icon } from "../components/Icon";
import { type LanesControls, LanesView, useLanes } from "../components/Lanes";
import { Link } from "../components/Link";
import { Toast, useToast } from "../components/Toast";
import { roleChip } from "../boards/logic";
import { visibilityText } from "../boards/text";
import { navigate } from "../routes";

type State = "loading" | "network" | "server" | "gone" | "ready";

type ViewProps = {
  state: State;
  board: BoardDetail | null;
  settings?: ReactNode;
  /** The card dialog, when a card is open. */
  dialog?: ReactNode;
  message?: string | null;
  onUndo?: (() => void) | null;
  lists?: BoardList[];
  cards?: Card[];
  labels?: Label[];
  people?: CardPerson[];
  lanes?: Partial<LanesControls>;
  onRetry?: () => void;
};

/** Everything one load of the board screen brings, or why it failed. */
type Snapshot =
  | {
      kind: "ok";
      board: BoardDetail;
      lists: BoardList[];
      cards: Card[];
      labels: Label[];
      people: BoardMember[];
    }
  | { kind: "expired" | "not_found" | "network" | "server" };

async function fetchSnapshot(id: number): Promise<Snapshot> {
  const [board, lists, cards, labels, people] = await Promise.all([
    getBoard(id),
    getLists(id),
    getCards(id),
    getLabels(),
    getBoardMembers(id),
  ]);
  if (
    board.kind === "ok" &&
    lists.kind === "ok" &&
    cards.kind === "ok" &&
    labels.kind === "ok" &&
    people.kind === "ok"
  ) {
    return {
      kind: "ok",
      board: board.data,
      lists: lists.data,
      cards: cards.data,
      labels: labels.data,
      people: people.data,
    };
  }
  const kinds: string[] = [board.kind, lists.kind, cards.kind, labels.kind, people.kind];
  if (kinds.includes("expired")) return { kind: "expired" };
  if (kinds.includes("not_found")) return { kind: "not_found" };
  return { kind: kinds.includes("network") ? "network" : "server" };
}

const POLL_MS = 30_000;

function LoadFailure({ kind, onRetry }: { kind: "network" | "server"; onRetry?: () => void }) {
  return (
    <div className="empty error">
      {kind === "network" ? (
        <>
          <h2>Can't reach Taskboard</h2>
          <p>
            This board could not be loaded because Taskboard isn't answering. Check your
            connection, or ask an admin whether the server is running.
          </p>
        </>
      ) : (
        <>
          <h2>Couldn't load this board</h2>
          <p>
            Something went wrong on the server (error 500). Nothing you saved is lost. Try again;
            if it keeps happening, tell a workspace admin.
          </p>
        </>
      )}
      <button className="btn" type="button" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

export function BoardView({
  state,
  board,
  settings,
  dialog,
  message,
  onUndo,
  lists = [],
  cards = [],
  labels = [],
  people = [],
  lanes,
  onRetry,
}: ViewProps) {
  let content;
  if (state === "ready" && board) {
    const owner = board.my_role === "owner";
    const editor = board.my_role !== "observer";
    const byList = groupByList(lists, cards);
    const total = lists.reduce((n, l) => n + byList[l.id].length, 0);
    content = (
      <>
        <div className="gutter">
          <div className="board-head">
            <h1>{board.name}</h1>
            <span className="chip">
              <Icon name={board.visibility === "private" ? "lock" : "globe"} />{" "}
              {visibilityText(board.visibility)}
            </span>
            <span className="chip accent">{`You: ${roleChip(board.my_role)}`}</span>
            <span className="spacer"></span>
            <AvatarStack people={board.members} total={board.member_count} />
            <Link className="btn" to={`/boards/${board.id}/settings`}>
              {owner ? (
                <>
                  <Icon name="gear" /> Settings and members
                </>
              ) : (
                <>
                  <Icon name="users" /> Board info
                </>
              )}
            </Link>
          </div>
          {editor && !canAddCard(total) && (
            <div className="banner warn" style={{ marginBottom: 12 }}>
              <Icon name="alert" /> {CARD_LIMIT_TEXT}
            </div>
          )}
          {!editor && (
            <div className="banner" style={{ marginBottom: 12 }}>
              <Icon name="eye" /> You can view this board but not change it. Ask a board owner for
              member access.
            </div>
          )}
        </div>
        {lists.length > 0 ? (
          <LanesView
            lists={lists}
            editor={editor}
            cards={byList}
            labels={labels}
            people={people}
            controls={lanes}
          />
        ) : (
          <div className="page gutter">
            <div className="empty">
              <h2>This board has no lists yet</h2>
              <p>Lists are the columns cards move through, for example To do, Doing and Done.</p>
              {editor ? (
                <button
                  className="btn primary"
                  type="button"
                  disabled={lanes?.seeding ?? false}
                  onClick={() => lanes?.onSeed?.()}
                >
                  <Icon name="plus" /> Add To do, Doing, Done
                </button>
              ) : (
                <p>Ask a board member to add the first lists.</p>
              )}
            </div>
          </div>
        )}
      </>
    );
  } else if (state === "gone") {
    content = (
      <div className="page gutter">
        <div className="empty">
          <h2>This board isn't here</h2>
          <p>
            It may have been archived, or you may not have access to it. Boards you can open are
            on the boards list.
          </p>
          <Link className="btn" to="/boards">
            Back to boards
          </Link>
        </div>
      </div>
    );
  } else if (state === "network" || state === "server") {
    content = (
      <div className="page gutter">
        <LoadFailure kind={state} onRetry={onRetry} />
      </div>
    );
  } else {
    content = (
      <div className="page gutter">
        <div className="skel-list" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div className="skel" key={i}></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      {content}
      {settings}
      {dialog}
      <Toast message={message ?? null} onUndo={onUndo} />
    </>
  );
}

type Loaded = { state: State; board: BoardDetail | null };

export function Board({
  id,
  settings,
  cardKey = null,
  me,
  domain,
  onBoardName,
}: {
  id: number;
  settings: boolean;
  /** The key of the card whose dialog is open (from the address), or null. */
  cardKey?: string | null;
  me: Me;
  domain: string | null;
  onBoardName?: (name: string | null) => void;
}) {
  const [load, setLoad] = useState<Loaded>({ state: "loading", board: null });
  const [attempt, setAttempt] = useState(0);
  const [message, show, undo] = useToast();
  const [lists, setLists] = useState<BoardList[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [people, setPeople] = useState<BoardMember[]>([]);
  const [polled, setPolled] = useState(0);

  // A reload may replace the screen only if nothing local happened since it began: `epoch` counts
  // local changes, `pending` the saves in flight, `dragging` a drag under way.
  const epoch = useRef(0);
  const pending = useRef(0);
  const dragging = useRef(false);
  const ready = useRef(false);
  ready.current = load.state === "ready";
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  // Any description draft with unsaved text: a reload would destroy it.
  const unsavedText = useRef(false);

  /** The session ended: reload the page to sign in again, unless that would lose typed text. */
  function expire() {
    if (expiredAction(unsavedText.current) === "reload") window.location.reload();
    else show(EXPIRED_DRAFT_TEXT);
  }

  useEffect(() => {
    let live = true;
    setLoad({ state: "loading", board: null });
    setLists([]);
    setCards([]);
    setLabels([]);
    setPeople([]);
    async function fetchAll() {
      const res = await fetchSnapshot(id);
      if (!live) return;
      if (res.kind === "expired") expire();
      else if (res.kind === "not_found") setLoad({ state: "gone", board: null });
      else if (res.kind !== "ok") setLoad({ state: res.kind, board: null });
      else {
        setLists(res.lists);
        setCards(res.cards);
        setLabels(res.labels);
        setPeople(res.people);
        setLoad({ state: "ready", board: res.board });
      }
    }
    void fetchAll();
    return () => {
      live = false;
    };
  }, [id, attempt]);

  // Other people's changes arrive by polling: every 30 s while the tab is visible, and when the
  // tab becomes visible or the window gets focus. One reload at a time.
  useEffect(() => {
    const poller = startBoardPoller<Extract<Snapshot, { kind: "ok" }>>({
      load: async () => {
        const res = await fetchSnapshot(id);
        if (res.kind === "expired") expire();
        else if (res.kind === "not_found") setLoad({ state: "gone", board: null });
        else if (res.kind === "ok") return res;
        return null;
      },
      onResult: (res) => {
        setLists(res.lists);
        setCards(res.cards);
        setLabels(res.labels);
        setPeople(res.people);
        setLoad({ state: "ready", board: res.board });
        // The open card's description is fetched again once the new cards are on screen.
        setPolled((n) => n + 1);
      },
      epoch: () => epoch.current,
      canApply: (start) => shouldApply(start, epoch.current, pending.current, dragging.current),
      enabled: () => ready.current,
      setInterval: (tick, ms) => window.setInterval(tick, ms),
      clearInterval: (timer) => window.clearInterval(timer),
      doc: document,
      win: window,
      intervalMs: POLL_MS,
    });
    refreshRef.current = poller.refresh;
    return () => {
      poller.stop();
      refreshRef.current = async () => {};
    };
  }, [id]);

  const name = load.board?.name ?? null;
  useEffect(() => {
    onBoardName?.(name);
    return () => onBoardName?.(null);
  }, [name]);

  /** Fetches the board again without the skeleton, after a change in the settings sheet. */
  async function reload() {
    const start = epoch.current;
    const [res, members, fresh] = await Promise.all([getBoard(id), getBoardMembers(id), getCards(id)]);
    // Who can be put on a card follows the board's people, which the settings sheet changes, and
    // taking someone off the board takes them off its cards too.
    if (members.kind === "ok") setPeople(members.data);
    const apply = shouldApply(start, epoch.current, pending.current, dragging.current);
    // A poll that began before this must not bring the old board, people or cards back.
    epoch.current += 1;
    if (fresh.kind === "ok") {
      if (apply) setCards(fresh.data);
      else void refreshRef.current();
    }
    if (res.kind === "ok") setLoad({ state: "ready", board: res.data });
    else if (res.kind === "not_found") setLoad({ state: "gone", board: null });
    else if (res.kind === "expired") expire();
  }

  /** Runs a save: while it is out, and after it, an older reload is not allowed to win. */
  function track<T>(save: Promise<T>): Promise<T> {
    pending.current += 1;
    epoch.current += 1;
    return save.finally(() => {
      pending.current -= 1;
      epoch.current += 1;
    });
  }

  /** A change of the cards made here: a reload that began before it must not overwrite it. */
  const changeCards = (update: (cards: Card[]) => Card[]) => {
    epoch.current += 1;
    setCards(update);
  };

  const lanes = useLanes({
    boardId: id,
    lists,
    setLists: (update) => {
      epoch.current += 1;
      setLists(update);
    },
    cards,
    setCards: changeCards,
    track,
    setDragging: (on) => {
      dragging.current = on;
    },
    refresh: () => refreshRef.current(),
    notify: show,
    onForbidden: () => void reload(),
    onGone: () => setLoad({ state: "gone", board: null }),
  });

  const cardEditor = useCardEditor({
    boardId: id,
    cardKey,
    cards,
    setCards: changeCards,
    track,
    notify: show,
    refresh: () => refreshRef.current(),
    onForbidden: () => void reload(),
    onGone: () => setLoad({ state: "gone", board: null }),
    onExpired: expire,
    role: load.board?.my_role ?? null,
    polled,
  });
  unsavedText.current = cardEditor.hasDirty;

  const dialog =
    cardKey !== null && load.state === "ready" && load.board ? (
      <CardDialog
        board={load.board}
        lists={lists}
        labels={labels}
        people={people}
        total={ungroup(groupByList(lists, cards)).length}
        editor={cardEditor}
        onMoveCardTo={lanes.onMoveCardTo}
        onCopyCard={lanes.onCopyCard}
      />
    ) : null;

  const sheet =
    settings && load.state === "ready" && load.board ? (
      <BoardSettings
        board={load.board}
        me={me}
        domain={domain}
        notify={show}
        onChanged={() => void reload()}
        onGone={() => setLoad({ state: "gone", board: null })}
        onClose={() => navigate(`/boards/${id}`)}
      />
    ) : null;

  return (
    <BoardView
      state={load.state}
      board={load.board}
      settings={sheet}
      dialog={dialog}
      message={message}
      onUndo={undo}
      lists={lists}
      cards={cards}
      labels={labels}
      people={people}
      lanes={lanes}
      onRetry={() => setAttempt((n) => n + 1)}
    />
  );
}
