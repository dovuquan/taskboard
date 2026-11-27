import { useEffect, useState } from "react";

import {
  type ArchivedBoard,
  type Me,
  type Tile,
  createBoard,
  getArchivedBoards,
  getBoards,
  getOwnerless,
  restoreBoard,
  takeOwnership,
} from "../api";
import { takeHandoff } from "../archive/handoff";
import { restoredBoardText } from "../archive/text";
import { AvatarStack } from "../components/Avatar";
import { Icon } from "../components/Icon";
import { Link } from "../components/Link";
import { Toast, useToast } from "../components/Toast";
import { describeFailure, roleChip, tileColor } from "../boards/logic";
import { formatUpdated, memberCountText } from "../boards/text";

type State = "loading" | "network" | "server" | "ready";
type Form = { open: boolean; name: string; priv: boolean; saving: boolean };

type ViewProps = {
  state: State;
  tiles: Tile[];
  ownerless: Tile[];
  /** Archived boards the person may restore; empty hides the section. */
  archived?: ArchivedBoard[];
  admin: boolean;
  domain: string | null;
  memberCount: number | null;
  now: Date;
  form: Form;
  message: string | null;
  busy?: boolean;
  onOpenForm?: () => void;
  onCancelForm?: () => void;
  onName?: (name: string) => void;
  onPriv?: (priv: boolean) => void;
  onCreate?: () => void;
  onTake?: (id: number) => void;
  onRestore?: (id: number) => void;
  onRetry?: () => void;
};

function LoadFailure({ kind, onRetry }: { kind: "network" | "server"; onRetry?: () => void }) {
  return (
    <div className="empty error">
      {kind === "network" ? (
        <>
          <h2>Can't reach Taskboard</h2>
          <p>
            The boards could not be loaded because Taskboard isn't answering. Check your
            connection, or ask an admin whether the server is running.
          </p>
        </>
      ) : (
        <>
          <h2>Couldn't load boards</h2>
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

function BoardTile({ tile, now }: { tile: Tile; now: Date }) {
  return (
    <Link className="board-tile" to={`/boards/${tile.id}`}>
      <span className="top">
        <span className="sq" style={{ background: tileColor(tile.id) }}></span>
        <strong>{tile.name}</strong>
        {tile.visibility === "private" && (
          <span title="Private board">
            <Icon name="lock" />
          </span>
        )}
      </span>
      <span className="meta">
        <span>{memberCountText(tile.member_count)}</span>
        <span>·</span>
        <span>{`Updated ${formatUpdated(tile.updated_at, now)}`}</span>
      </span>
      <span className="foot">
        <AvatarStack people={tile.members} total={tile.member_count} />
        {tile.my_role && <span className="chip">{roleChip(tile.my_role)}</span>}
      </span>
    </Link>
  );
}

function NewBoardForm({ form, onName, onPriv, onCreate, onCancelForm }: Pick<
  ViewProps,
  "form" | "onName" | "onPriv" | "onCreate" | "onCancelForm"
>) {
  return (
    <form
      className="board-tile new-form"
      onSubmit={(e) => {
        e.preventDefault();
        onCreate?.();
      }}
    >
      <strong>New board</strong>
      <input
        className="input"
        placeholder="Board name"
        aria-label="Board name"
        maxLength={80}
        required
        autoFocus
        value={form.name}
        onChange={(e) => onName?.(e.target.value)}
      />
      <label className="fine">
        <input
          type="checkbox"
          checked={form.priv}
          onChange={(e) => onPriv?.(e.target.checked)}
        />{" "}
        Private: only people you add can see it
      </label>
      <span className="foot">
        <button className="btn primary sm" type="submit" disabled={form.saving || !form.name.trim()}>
          Create
        </button>
        <button className="btn ghost sm" type="button" onClick={onCancelForm}>
          Cancel
        </button>
      </span>
    </form>
  );
}

export function BoardsView(props: ViewProps) {
  const { state, tiles, ownerless, admin, domain, memberCount, now, form, message, busy } = props;
  const { onOpenForm, onTake, onRestore, onRetry } = props;
  const archived = props.archived ?? [];
  const solo = memberCount === 1;

  let body;
  if (state === "loading") {
    body = (
      <div className="boards" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <div className="skel" style={{ height: 132 }} key={i}></div>
        ))}
      </div>
    );
  } else if (state === "network" || state === "server") {
    body = <LoadFailure kind={state} onRetry={onRetry} />;
  } else if (!tiles.length && !form.open) {
    body = solo ? (
      <div className="empty">
        <h2>Welcome to Taskboard</h2>
        <p>
          You're the first one here. Create a board for a project or team; colleagues join the
          workspace the first time they sign in with their {domain ?? "Workspace"} account.
        </p>
        <button className="btn primary" type="button" onClick={onOpenForm}>
          <Icon name="plus" /> Create the first board
        </button>
      </div>
    ) : (
      <div className="empty">
        <h2>No boards yet</h2>
        <p>
          A board holds lists of cards for one project or team. Create the first one, for example
          "Q4 Launch".
        </p>
        <button className="btn primary" type="button" onClick={onOpenForm}>
          <Icon name="plus" /> New board
        </button>
      </div>
    );
  } else {
    body = (
      <div className="boards">
        {tiles.map((t) => (
          <BoardTile key={t.id} tile={t} now={now} />
        ))}
        {form.open ? (
          <NewBoardForm {...props} />
        ) : (
          <button className="board-tile new-tile" type="button" onClick={onOpenForm}>
            <Icon name="plus" /> New board
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="page gutter">
        <div className="page-head">
          <div>
            <h1>Boards</h1>
            {domain && <p className="muted lead">{domain} workspace</p>}
          </div>
          {state === "ready" && (
            <button className="btn primary" type="button" onClick={onOpenForm}>
              <Icon name="plus" /> New board
            </button>
          )}
        </div>
        {body}
        {state === "ready" && admin && ownerless.length > 0 && (
          <section className="sub-sec">
            <h2>Boards without an owner</h2>
            <p className="fine">
              Private boards whose owners have all left. Only admins see this list.
            </p>
            {ownerless.map((t) => (
              <div className="person-row" key={t.id}>
                <Icon name="lock" />
                <b>{t.name}</b>
                <span className="muted">{`Updated ${formatUpdated(t.updated_at, now)}`}</span>
                <button
                  className="btn sm"
                  type="button"
                  disabled={busy}
                  onClick={() => onTake?.(t.id)}
                >
                  Take ownership
                </button>
              </div>
            ))}
          </section>
        )}
        {state === "ready" && archived.length > 0 && (
          <section className="sub-sec">
            <h2>Archived boards</h2>
            {archived.map((t) => (
              <div className="person-row" key={t.id}>
                <span className="sq" style={{ background: tileColor(t.id) }}></span>
                <b>{t.name}</b>
                <span className="muted">{`Archived ${formatUpdated(t.archived_at, now)} · its lists and cards are kept`}</span>
                <button
                  className="btn sm"
                  type="button"
                  disabled={busy}
                  onClick={() => onRestore?.(t.id)}
                >
                  Restore
                </button>
              </div>
            ))}
          </section>
        )}
      </div>
      <Toast message={message} />
    </>
  );
}

type Loaded = {
  state: State;
  tiles: Tile[];
  ownerless: Tile[];
  archived: ArchivedBoard[];
  now: Date;
};

export function Boards({
  me,
  domain,
  memberCount,
}: {
  me: Me;
  domain: string | null;
  memberCount: number | null;
}) {
  const admin = me.role === "admin";
  const [load, setLoad] = useState<Loaded>({
    state: "loading",
    tiles: [],
    ownerless: [],
    archived: [],
    now: new Date(),
  });
  const [attempt, setAttempt] = useState(0);
  const [form, setForm] = useState<Form>({ open: false, name: "", priv: false, saving: false });
  const [busy, setBusy] = useState(false);
  const [message, show] = useToast();

  useEffect(() => {
    let live = true;
    void Promise.all([
      getBoards(),
      admin ? getOwnerless() : Promise.resolve(null),
      getArchivedBoards(),
    ]).then(
      ([boards, orphans, gone]) => {
        if (!live) return;
        if (boards.kind === "expired" || orphans?.kind === "expired" || gone.kind === "expired") {
          // The app shell shows the expired screen once /api/me says so.
          window.location.reload();
          return;
        }
        if (boards.kind !== "ok") {
          setLoad((l) => ({
            ...l,
            state: boards.kind === "network" ? "network" : "server",
          }));
          return;
        }
        // A failing ownerless list only hides that section; the boards still show.
        const ownerless = orphans?.kind === "ok" ? orphans.data : [];
        // The same for the archived list: failing only hides its section.
        const archived = gone.kind === "ok" ? gone.data : [];
        setLoad({ state: "ready", tiles: boards.data, ownerless, archived, now: new Date() });
      },
    );
    return () => {
      live = false;
    };
  }, [admin, attempt]);

  function refresh() {
    setAttempt((n) => n + 1);
  }

  function onRetry() {
    setLoad((l) => ({ ...l, state: "loading" }));
    refresh();
  }

  async function onCreate() {
    const name = form.name.trim();
    if (form.saving || !name) return;
    setForm((f) => ({ ...f, saving: true }));
    const res = await createBoard(name, form.priv ? "private" : "workspace");
    if (res.kind === "ok") {
      setForm({ open: false, name: "", priv: false, saving: false });
      show(`Created ${res.data.name}`);
      refresh();
      return;
    }
    setForm((f) => ({ ...f, saving: false }));
    const failure = describeFailure(res.kind);
    if (failure.expired) window.location.reload();
    else show(failure.message);
  }

  async function onTake(id: number) {
    if (busy) return;
    setBusy(true);
    const res = await takeOwnership(id);
    setBusy(false);
    if (res.kind === "ok") {
      show(`You now own ${res.data.name}`);
      refresh();
      return;
    }
    const failure = describeFailure(res.kind);
    if (failure.expired) window.location.reload();
    else {
      show(failure.message);
      // The board changed under us (taken, or gone): show the current lists.
      if (res.kind === "has_owner" || res.kind === "not_found") refresh();
    }
  }

  // Archiving a board leaves for this screen; its toast, with Undo, shows here.
  useEffect(() => {
    const waiting = takeHandoff();
    if (waiting) show(waiting.text, () => void onRestore(waiting.undoBoardId));
  }, []);

  async function onRestore(id: number) {
    if (busy) return;
    setBusy(true);
    const res = await restoreBoard(id);
    setBusy(false);
    if (res.kind === "ok") {
      show(restoredBoardText(res.data.name));
      refresh();
      return;
    }
    const failure = describeFailure(res.kind);
    if (failure.expired) window.location.reload();
    else {
      show(failure.message);
      // Restored by someone else, or no longer ours to restore: show the current list.
      if (res.kind === "not_found" || res.kind === "forbidden") refresh();
    }
  }

  return (
    <BoardsView
      state={load.state}
      tiles={load.tiles}
      ownerless={load.ownerless}
      archived={load.archived}
      admin={admin}
      domain={domain}
      memberCount={memberCount}
      now={load.now}
      form={form}
      message={message}
      busy={busy}
      onOpenForm={() => setForm((f) => ({ ...f, open: true }))}
      onCancelForm={() => setForm({ open: false, name: "", priv: false, saving: false })}
      onName={(name) => setForm((f) => ({ ...f, name }))}
      onPriv={(priv) => setForm((f) => ({ ...f, priv }))}
      onCreate={() => void onCreate()}
      onTake={(id) => void onTake(id)}
      onRestore={(id) => void onRestore(id)}
      onRetry={onRetry}
    />
  );
}
