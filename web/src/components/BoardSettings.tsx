import { useEffect, useState } from "react";

import {
  type BoardDetail,
  type BoardMember,
  type BoardResult,
  type BoardRole,
  type Me,
  type Member,
  type Visibility,
  addBoardMember,
  archiveBoard,
  getBoardMembers,
  getMembers,
  patchBoard,
  removeBoardMember,
  setBoardRole,
} from "../api";
import { addMatches, describeFailure, lastOwnerBlock, roleChangedText, roleChip } from "../boards/logic";
import { archiveBoardConfirmText } from "../archive/text";
import { workspaceVisibilityText } from "../boards/text";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";

type PeopleState = "loading" | "ready" | "error";

type ViewProps = {
  board: BoardDetail;
  people: BoardMember[];
  peopleState: PeopleState;
  workspace: Member[];
  me: Me;
  domain: string | null;
  name: string;
  query: string;
  busy: boolean;
  /** The archive box is asking "are you sure". */
  confirmArchive?: boolean;
  onName?: (name: string) => void;
  onNameCommit?: () => void;
  onVisibility?: (visibility: Visibility) => void;
  onRole?: (userId: number, value: BoardRole | "remove") => void;
  onQuery?: (query: string) => void;
  onAdd?: (userId: number) => void;
  onClose?: () => void;
  onRetry?: () => void;
  onAskArchive?: () => void;
  onCancelArchive?: () => void;
  onArchive?: () => void;
};

function PersonRow({
  person,
  mine,
  can,
  busy,
  onRole,
}: {
  person: BoardMember;
  mine: boolean;
  can: boolean;
  busy: boolean;
  onRole?: ViewProps["onRole"];
}) {
  const label = person.name ?? person.email;
  return (
    <div className="person">
      <Avatar user={person} large />
      <div className="body">
        {label}
        {mine && <span className="muted"> (you)</span>}
        {person.name && <small>{person.email}</small>}
      </div>
      {can ? (
        <select
          className="input"
          aria-label={`Board role for ${label}`}
          value={person.role}
          disabled={busy}
          onChange={(e) => onRole?.(person.id, e.target.value as BoardRole | "remove")}
        >
          <option value="owner">Owner</option>
          <option value="member">Member</option>
          <option value="observer">Observer</option>
          <option value="remove">Remove from board</option>
        </select>
      ) : (
        <span className="chip">{roleChip(person.role)}</span>
      )}
    </div>
  );
}

function AddPerson({
  matches,
  query,
  onQuery,
  onAdd,
  busy,
}: {
  matches: Member[];
  query: string;
  onQuery?: (q: string) => void;
  onAdd?: (id: number) => void;
  busy: boolean;
}) {
  return (
    <>
      <div className="add-person">
        <input
          className="input"
          placeholder="Add a workspace member by name or email"
          aria-label="Find a workspace member to add"
          autoComplete="off"
          value={query}
          onChange={(e) => onQuery?.(e.target.value)}
        />
        {query.trim() &&
          (matches.length ? (
            <div className="matches">
              {matches.map((m) => (
                <button
                  className="item"
                  type="button"
                  key={m.id}
                  disabled={busy}
                  onClick={() => onAdd?.(m.id)}
                >
                  <Avatar user={m} />
                  <span>
                    {m.name ?? m.email}
                    {m.name && <small>{m.email}</small>}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="fine">
              Nobody in the workspace matches. People join the workspace the first time they sign
              in to Taskboard; then you can add them here.
            </p>
          ))}
      </div>
      <span className="fine">
        Owners change settings and members. Members edit lists and cards. Observers only read.
      </span>
    </>
  );
}

export function BoardSettingsView(props: ViewProps) {
  const { board, people, peopleState, workspace, me, domain, name, query, busy } = props;
  const { onName, onNameCommit, onVisibility, onRole, onQuery, onAdd, onClose, onRetry } = props;
  const { confirmArchive = false, onAskArchive, onCancelArchive, onArchive } = props;
  const can = board.my_role === "owner";
  const count = peopleState === "ready" ? people.length : board.member_count;

  return (
    <>
      <div className="scrim" onClick={onClose} style={{ padding: 0 }}></div>
      <aside className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <div className="sheet-head">
          <h2 id="sheet-title">{can ? "Board settings" : "Board info"}</h2>
          <button
            className="icon-btn"
            type="button"
            aria-label="Close (Esc)"
            autoFocus
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </div>
        <div className="sheet-body">
          {!can && (
            <div className="banner">
              <Icon name="lock" /> Only board owners can change these settings.
            </div>
          )}
          <div className="group">
            <label className="lab" htmlFor="bs-name">
              Name
            </label>
            <input
              className="input"
              id="bs-name"
              value={name}
              maxLength={80}
              disabled={!can || busy}
              onChange={(e) => onName?.(e.target.value)}
              onBlur={onNameCommit}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
          </div>
          <div className="group">
            <span className="lab">Who can see this board</span>
            <label className="radio">
              <input
                type="radio"
                name="vis"
                value="workspace"
                checked={board.visibility === "workspace"}
                disabled={!can || busy}
                onChange={() => onVisibility?.("workspace")}
              />
              <span>
                <b>Workspace</b>
                <small>{workspaceVisibilityText(domain)}</small>
              </span>
            </label>
            <label className="radio">
              <input
                type="radio"
                name="vis"
                value="private"
                checked={board.visibility === "private"}
                disabled={!can || busy}
                onChange={() => onVisibility?.("private")}
              />
              <span>
                <b>Private</b>
                <small>Only the people listed below can see it.</small>
              </span>
            </label>
          </div>
          <div className="group">
            <span className="lab">{`Board members (${count})`}</span>
            {peopleState === "loading" && (
              <div className="skel-list" aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <div className="skel" key={i}></div>
                ))}
              </div>
            )}
            {peopleState === "error" && (
              <>
                <p className="fine">Couldn't load the member list.</p>
                <div>
                  <button className="btn sm" type="button" onClick={onRetry}>
                    Try again
                  </button>
                </div>
              </>
            )}
            {peopleState === "ready" &&
              people.map((p) => (
                <PersonRow
                  key={p.id}
                  person={p}
                  mine={p.id === me.id}
                  can={can}
                  busy={busy}
                  onRole={onRole}
                />
              ))}
            {can && (
              <AddPerson
                matches={addMatches(query, workspace, people)}
                query={query}
                onQuery={onQuery}
                onAdd={onAdd}
                busy={busy}
              />
            )}
          </div>
          {can && (
            <div className="dangerbox">
              <b>Archive this board</b>
              {confirmArchive ? (
                <>
                  <p>{archiveBoardConfirmText(board.name)}</p>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      className="btn danger solid sm"
                      type="button"
                      disabled={busy}
                      onClick={onArchive}
                    >
                      Archive board
                    </button>
                    <button className="btn ghost sm" type="button" onClick={onCancelArchive}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p>Hides the board from everyone. You can restore it later.</p>
                  <div>
                    <button
                      className="btn danger sm"
                      type="button"
                      disabled={busy}
                      onClick={onAskArchive}
                    >
                      Archive board…
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

type Props = {
  board: BoardDetail;
  me: Me;
  domain: string | null;
  notify: (text: string) => void;
  onChanged: () => void;
  onGone: () => void;
  /** The session ended (401): the page decides whether to reload, so typed text is not lost. */
  onExpired: () => void;
  onClose: () => void;
  /** The server archived the board: the page leaves for the Boards screen. */
  onArchived: (board: { id: number; name: string }) => void;
};

export function BoardSettings({
  board,
  me,
  domain,
  notify,
  onChanged,
  onGone,
  onExpired,
  onClose,
  onArchived,
}: Props) {
  const id = board.id;
  const can = board.my_role === "owner";
  const [people, setPeople] = useState<BoardMember[]>([]);
  const [peopleState, setPeopleState] = useState<PeopleState>("loading");
  const [workspace, setWorkspace] = useState<Member[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [name, setName] = useState(board.name);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  useEffect(() => setName(board.name), [board.name]);

  useEffect(() => {
    let live = true;
    void Promise.all([getBoardMembers(id), can ? getMembers() : Promise.resolve(null)]).then(
      ([list, all]) => {
        if (!live) return;
        if (list.kind === "expired" || all?.kind === "expired") onExpired();
        else if (list.kind === "not_found") onGone();
        else if (list.kind !== "ok") setPeopleState("error");
        else {
          setPeople(list.data);
          setPeopleState("ready");
          // Only the add-person search needs this; without it the search finds nobody.
          setWorkspace(all?.kind === "ok" ? all.data : []);
        }
      },
    );
    return () => {
      live = false;
    };
  }, [id, can, attempt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** Waits for the server, then reloads; nothing changes on screen until it answers. */
  async function run<T>(call: Promise<BoardResult<T>>, okText: (data: T) => string) {
    setBusy(true);
    const res = await call;
    setBusy(false);
    if (res.kind === "ok") {
      notify(okText(res.data));
      setQuery("");
      onChanged();
      setAttempt((n) => n + 1);
      return;
    }
    setName(board.name);
    const failure = describeFailure(res.kind);
    if (failure.expired) onExpired();
    else if (failure.gone) onGone();
    else {
      notify(failure.message);
      // A 403 or 409 means what we show is stale: fetch the current state.
      onChanged();
      setAttempt((n) => n + 1);
    }
  }

  function onNameCommit() {
    const next = name.trim();
    if (busy || !can) return;
    if (!next || next === board.name) {
      setName(board.name);
      return;
    }
    void run(patchBoard(id, { name: next }), () => "Board renamed");
  }

  function onVisibility(visibility: Visibility) {
    if (busy || visibility === board.visibility) return;
    void run(patchBoard(id, { visibility }), () =>
      visibility === "private" ? "Board is now private" : "Board is visible to the workspace",
    );
  }

  function onRole(userId: number, value: BoardRole | "remove") {
    const person = people.find((p) => p.id === userId);
    if (busy || !person || value === person.role) return;
    const block = lastOwnerBlock(people, userId, value);
    if (block) {
      notify(block);
      return;
    }
    const label = person.name ?? person.email;
    if (value === "remove") {
      void run(removeBoardMember(id, userId), () => `${label} removed from the board`);
    } else {
      void run(setBoardRole(id, userId, value), () => roleChangedText(label, value));
    }
  }

  async function onArchive() {
    if (busy || !can) return;
    setBusy(true);
    const res = await archiveBoard(id);
    setBusy(false);
    if (res.kind === "ok") {
      onArchived(res.data);
      return;
    }
    setConfirmArchive(false);
    const failure = describeFailure(res.kind);
    if (failure.expired) onExpired();
    else if (failure.gone) onGone();
    else {
      notify(failure.message);
      // A 403 means the role changed under us: fetch the current state.
      onChanged();
      setAttempt((n) => n + 1);
    }
  }

  function onAdd(userId: number) {
    if (busy) return;
    const who = workspace.find((m) => m.id === userId);
    const label = who?.name ?? who?.email ?? "Person";
    void run(addBoardMember(id, userId), () => `${label} added as a member`);
  }

  return (
    <BoardSettingsView
      board={board}
      people={people}
      peopleState={peopleState}
      workspace={workspace}
      me={me}
      domain={domain}
      name={name}
      query={query}
      busy={busy}
      confirmArchive={confirmArchive}
      onAskArchive={() => setConfirmArchive(true)}
      onCancelArchive={() => setConfirmArchive(false)}
      onArchive={() => void onArchive()}
      onName={setName}
      onNameCommit={onNameCommit}
      onVisibility={onVisibility}
      onRole={onRole}
      onQuery={setQuery}
      onAdd={onAdd}
      onClose={onClose}
      onRetry={() => {
        setPeopleState("loading");
        setAttempt((n) => n + 1);
      }}
    />
  );
}
