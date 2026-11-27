import { useEffect, useRef, useState } from "react";

import {
  type Archived as ArchivedData,
  type ArchivedCard,
  type ArchivedList,
  type BoardDetail,
  getArchived,
  getBoard,
  getLists,
  restoreCard,
  restoreList,
} from "../api";
import {
  ARCHIVED_EMPTY_HINT,
  ARCHIVED_HEAD_NOTE,
  OWNERS_ONLY_TEXT,
  cardRowText,
  listRowText,
  restoreFailureText,
  restoredCardText,
  restoredListText,
} from "../archive/text";
import { whenText } from "../cards/feed";
import { Icon } from "../components/Icon";
import { Link } from "../components/Link";
import { Toast, useToast } from "../components/Toast";

type State = "loading" | "network" | "server" | "gone" | "ready";

type ViewProps = {
  state: State;
  boardId: number;
  boardName: string | null;
  /** An owner (or an admin acting as owner) may restore; everyone else only reads. */
  owner: boolean;
  data: ArchivedData | null;
  /** The time the ages are measured against, in milliseconds. */
  now: number;
  /** A restore is out: the buttons wait for it. */
  busy?: boolean;
  message?: string | null;
  onRestoreList?: (list: ArchivedList) => void;
  onRestoreCard?: (card: ArchivedCard) => void;
  onRetry?: () => void;
};

export function ArchivedView({
  state,
  boardId,
  boardName,
  owner,
  data,
  now,
  busy = false,
  message,
  onRestoreList,
  onRestoreCard,
  onRetry,
}: ViewProps) {
  let body;
  if (state === "ready" && data) {
    if (data.lists.length === 0 && data.cards.length === 0) {
      body = (
        <div className="empty">
          <h2>Nothing is archived on this board</h2>
          <p>{ARCHIVED_EMPTY_HINT}</p>
          <Link className="btn" to={`/boards/${boardId}`}>
            Back to the board
          </Link>
        </div>
      );
    } else {
      body = (
        <>
          {!owner && (
            <div className="banner" style={{ marginBottom: 12 }}>
              <Icon name="lock" /> {OWNERS_ONLY_TEXT}
            </div>
          )}
          {data.lists.length > 0 && (
            <section className="sub-sec" style={{ marginTop: 0 }}>
              <h2>{`Lists (${data.lists.length})`}</h2>
              {data.lists.map((l) => (
                <div className="person-row" key={`list-${l.id}`}>
                  <b>{l.name}</b>
                  <span className="muted">{listRowText(l.card_count, whenText(l.archived_at, now))}</span>
                  {owner && (
                    <button
                      className="btn sm"
                      type="button"
                      disabled={busy}
                      onClick={() => onRestoreList?.(l)}
                    >
                      Restore
                    </button>
                  )}
                </div>
              ))}
            </section>
          )}
          {data.cards.length > 0 && (
            <section className="sub-sec">
              <h2>{`Cards (${data.cards.length})`}</h2>
              {data.cards.map((c) => (
                <div className="person-row" key={`card-${c.id}`}>
                  <span className="mono muted">{c.key}</span>
                  <b>{c.title}</b>
                  <span className="muted">{cardRowText(c.list_name, whenText(c.archived_at, now))}</span>
                  {owner && (
                    <button
                      className="btn sm"
                      type="button"
                      disabled={busy}
                      onClick={() => onRestoreCard?.(c)}
                    >
                      Restore
                    </button>
                  )}
                </div>
              ))}
            </section>
          )}
        </>
      );
    }
  } else if (state === "gone") {
    body = (
      <div className="empty">
        <h2>This board isn't here</h2>
        <p>
          It may have been archived, or you may not have access to it. Boards you can open are on
          the boards list.
        </p>
        <Link className="btn" to="/boards">
          Back to boards
        </Link>
      </div>
    );
  } else if (state === "network" || state === "server") {
    body = (
      <div className="empty error">
        {state === "network" ? (
          <>
            <h2>Can't reach Taskboard</h2>
            <p>
              The archived items could not be loaded because Taskboard isn't answering. Check your
              connection, or ask an admin whether the server is running.
            </p>
          </>
        ) : (
          <>
            <h2>Couldn't load archived items</h2>
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
  } else {
    body = (
      <div className="skel-list" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div className="skel" key={i}></div>
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="page gutter">
        {boardName && state === "ready" && (
          <div className="page-head">
            <div>
              <h1>{`Archived on ${boardName}`}</h1>
              <p className="muted" style={{ margin: "4px 0 0" }}>
                {ARCHIVED_HEAD_NOTE}
              </p>
            </div>
          </div>
        )}
        {body}
      </div>
      <Toast message={message ?? null} />
    </>
  );
}

type Loaded = { state: State; board: BoardDetail | null; data: ArchivedData | null };

async function fetchLoaded(id: number): Promise<Loaded | "expired"> {
  const [board, data] = await Promise.all([getBoard(id), getArchived(id)]);
  if (board.kind === "expired" || data.kind === "expired") return "expired";
  if (board.kind === "ok" && data.kind === "ok") {
    return { state: "ready", board: board.data, data: data.data };
  }
  if (board.kind === "not_found" || data.kind === "not_found") {
    return { state: "gone", board: null, data: null };
  }
  const network = board.kind === "network" || data.kind === "network";
  return { state: network ? "network" : "server", board: null, data: null };
}

export function Archived({
  id,
  onBoardName,
}: {
  id: number;
  onBoardName?: (name: string | null) => void;
}) {
  const [load, setLoad] = useState<Loaded>({ state: "loading", board: null, data: null });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, show] = useToast();
  const working = useRef(false);

  /** Applies one fetch; false means the page is leaving for the expired screen. */
  async function fetchAll(live: () => boolean = () => true): Promise<boolean> {
    const next = await fetchLoaded(id);
    if (!live()) return false;
    if (next === "expired") {
      // The app shell shows the expired screen once /api/me says so.
      window.location.reload();
      return false;
    }
    setLoad(next);
    return true;
  }

  useEffect(() => {
    let live = true;
    setLoad({ state: "loading", board: null, data: null });
    void fetchAll(() => live);
    return () => {
      live = false;
    };
  }, [id, attempt]);

  const name = load.board?.name ?? null;
  useEffect(() => {
    onBoardName?.(name);
    return () => onBoardName?.(null);
  }, [name]);

  /** Runs one restore: one at a time, the screen changes only when the server has answered. */
  async function restore<T>(
    call: Promise<{ kind: "ok"; data: T } | { kind: string }>,
    okText: (data: T) => Promise<string>,
  ) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      const res = await call;
      if (res.kind === "ok") {
        const text = await okText((res as { kind: "ok"; data: T }).data);
        if (await fetchAll()) show(text);
        return;
      }
      if (res.kind === "expired") {
        window.location.reload();
        return;
      }
      if (res.kind === "not_found") {
        setLoad({ state: "gone", board: null, data: null });
        return;
      }
      show(restoreFailureText(res.kind));
      // Forbidden, gone or changed: what is on screen is stale, so show the current items.
      if (res.kind !== "network" && res.kind !== "server" && res.kind !== "no_list") {
        await fetchAll();
      }
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  const owner = load.board?.my_role === "owner";

  return (
    <ArchivedView
      state={load.state}
      boardId={id}
      boardName={name}
      owner={owner}
      data={load.data}
      now={Date.now()}
      busy={busy}
      message={message}
      onRestoreList={(list) =>
        void restore(restoreList(id, list.id), async () => restoredListText(list.name, list.card_count))
      }
      onRestoreCard={(card) =>
        void restore(restoreCard(id, card.id), async (tile) => {
          // The card goes back to its own list unless that is archived: ask for the list's name.
          const lists = await getLists(id);
          const where =
            lists.kind === "ok" ? lists.data.find((l) => l.id === tile.list_id)?.name : undefined;
          return restoredCardText(card.key, where ?? card.list_name);
        })
      }
      onRetry={() => setAttempt((n) => n + 1)}
    />
  );
}
