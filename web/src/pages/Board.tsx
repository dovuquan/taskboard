import { type ReactNode, useEffect, useState } from "react";

import { type BoardDetail, type Me, getBoard } from "../api";
import { AvatarStack } from "../components/Avatar";
import { BoardSettings } from "../components/BoardSettings";
import { Icon } from "../components/Icon";
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
  message?: string | null;
  onRetry?: () => void;
};

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

export function BoardView({ state, board, settings, message, onRetry }: ViewProps) {
  let content;
  if (state === "ready" && board) {
    const owner = board.my_role === "owner";
    const editor = board.my_role !== "observer";
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
          {!editor && (
            <div className="banner" style={{ marginBottom: 12 }}>
              <Icon name="eye" /> You can view this board but not change it. Ask a board owner for
              member access.
            </div>
          )}
        </div>
        <div className="page gutter">
          <div className="empty">
            <h2>This board has no lists yet</h2>
            <p>Lists are the columns cards move through, for example To do, Doing and Done.</p>
            {editor ? (
              <button
                className="btn primary"
                type="button"
                disabled
                title="Lists arrive in a later step"
              >
                <Icon name="plus" /> Add To do, Doing, Done
              </button>
            ) : (
              <p>Ask a board member to add the first lists.</p>
            )}
          </div>
        </div>
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
      <Toast message={message ?? null} />
    </>
  );
}

type Loaded = { state: State; board: BoardDetail | null };

export function Board({
  id,
  settings,
  me,
  domain,
  onBoardName,
}: {
  id: number;
  settings: boolean;
  me: Me;
  domain: string | null;
  onBoardName?: (name: string | null) => void;
}) {
  const [load, setLoad] = useState<Loaded>({ state: "loading", board: null });
  const [attempt, setAttempt] = useState(0);
  const [message, show] = useToast();

  useEffect(() => {
    let live = true;
    setLoad({ state: "loading", board: null });
    void getBoard(id).then((res) => {
      if (!live) return;
      if (res.kind === "ok") setLoad({ state: "ready", board: res.data });
      else if (res.kind === "expired") window.location.reload();
      else if (res.kind === "not_found") setLoad({ state: "gone", board: null });
      else setLoad({ state: res.kind === "network" ? "network" : "server", board: null });
    });
    return () => {
      live = false;
    };
  }, [id, attempt]);

  const name = load.board?.name ?? null;
  useEffect(() => {
    onBoardName?.(name);
    return () => onBoardName?.(null);
  }, [name]);

  /** Fetches the board again without the skeleton, after a change in the settings sheet. */
  async function reload() {
    const res = await getBoard(id);
    if (res.kind === "ok") setLoad({ state: "ready", board: res.data });
    else if (res.kind === "not_found") setLoad({ state: "gone", board: null });
    else if (res.kind === "expired") window.location.reload();
  }

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
      message={message}
      onRetry={() => setAttempt((n) => n + 1)}
    />
  );
}
