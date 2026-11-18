import { useEffect, useRef, useState } from "react";

import {
  type Me,
  type Member,
  type Refusal,
  type Role,
  getMembers,
  getRefused,
  setMemberRole,
} from "../api";
import { refusalText } from "../auth/refusal";
import { Avatar } from "../components/Avatar";
import {
  formatJoined,
  formatLastActive,
  formatWhen,
  roleChangedText,
  saveErrorText,
} from "../members/text";

export type MembersState = "denied" | "loading" | "network" | "server" | "ready";

type ViewProps = {
  state: MembersState;
  me: Me;
  rows: Member[];
  refused: Refusal[];
  message: string | null;
  domain: string | null;
  now: Date;
  onRole?: (id: number, role: Role) => void;
  onRetry?: () => void;
};

function Head({ domain }: { domain: string | null }) {
  const text = `Anyone with a verified ${domain ? `${domain} Google account` : "Google account from your organisation"} joins as a member on first sign-in. Board access is set on each board.`;
  return (
    <div className="page-head">
      <div>
        <h1>Workspace members</h1>
        <p className="muted lead">{text}</p>
      </div>
    </div>
  );
}

function LoadFailure({ kind, onRetry }: { kind: "network" | "server"; onRetry?: () => void }) {
  return (
    <div className="empty error">
      {kind === "network" ? (
        <>
          <h2>Can't reach Taskboard</h2>
          <p>
            The member list could not be loaded because Taskboard isn't answering. Check your
            connection, or ask an admin whether the server is running.
          </p>
        </>
      ) : (
        <>
          <h2>Couldn't load members</h2>
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

function MemberRow({
  row,
  mine,
  now,
  onRole,
}: {
  row: Member;
  mine: boolean;
  now: Date;
  onRole?: (id: number, role: Role) => void;
}) {
  const label = row.name ?? row.email;
  return (
    <tr>
      <td>
        <div className="person">
          <Avatar user={row} />
          <div className="body">
            {label}
            {row.name && <small>{row.email}</small>}
          </div>
        </div>
      </td>
      <td>
        <select
          className="input"
          aria-label={`Workspace role for ${label}`}
          value={row.role}
          disabled={mine}
          title={mine ? "You cannot change your own role" : undefined}
          onChange={(e) => onRole?.(row.id, e.target.value as Role)}
        >
          <option value="admin">Admin</option>
          <option value="member">Member</option>
        </select>
      </td>
      <td>{row.joined_at ? formatJoined(row.joined_at, now) : "Not yet"}</td>
      <td>{formatLastActive(row.pending ? null : row.last_seen_at, now)}</td>
    </tr>
  );
}

export function MembersView(props: ViewProps) {
  const { state, me, rows, refused, message, domain, now, onRole, onRetry } = props;

  if (state === "denied") {
    return (
      <div className="page gutter">
        <div className="empty">
          <h2>Only workspace admins can see members</h2>
          <p>You are signed in as a workspace member.</p>
          <a className="btn" href="/boards">
            Back to boards
          </a>
        </div>
      </div>
    );
  }

  const account = domain ? `${domain} account` : "organisation's account";
  const admins = rows.filter((r) => r.role === "admin").length;
  const alone = rows.length === 1;

  let body;
  if (state === "loading") {
    body = (
      <div className="skel-list" aria-busy="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <div className="skel" key={i}></div>
        ))}
      </div>
    );
  } else if (state === "network" || state === "server") {
    body = <LoadFailure kind={state} onRetry={onRetry} />;
  } else {
    body = (
      <>
        <div className="table-wrap">
          <table className="people">
            <thead>
              <tr>
                <th>Person</th>
                <th>Workspace role</th>
                <th>Joined</th>
                <th>Last active</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <MemberRow key={row.id} row={row} mine={row.id === me.id} now={now} onRole={onRole} />
              ))}
            </tbody>
          </table>
        </div>
        {admins === 1 && !alone && (
          <p className="fine">
            You are the only admin. Make someone else an admin before you can step down; a
            workspace always keeps one admin.
          </p>
        )}
        {alone && (
          <p className="fine">
            {`Nobody else has signed in yet. Colleagues appear here the first time they sign in with their ${account}; there is nothing to send them.`}
          </p>
        )}
        <p className="fine">
          The first admin is created from the command line (
          <span className="mono">taskboard admin --email</span>). Admins can promote others here.
        </p>
        <section className="feed">
          <h2>
            Refused sign-ins <span className="muted">last 7 days</span>
          </h2>
          {refused.length ? (
            <div className="table-wrap">
              <table className="people">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Account</th>
                    <th>Why it was refused</th>
                  </tr>
                </thead>
                <tbody>
                  {refused.map((r, i) => (
                    <tr key={i}>
                      <td className="nowrap">{formatWhen(r.at, now)}</td>
                      <td className="wrap">{r.email ?? "Unknown account"}</td>
                      <td>{refusalText(r.reason, domain)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">No refused sign-ins in the last 7 days.</p>
          )}
        </section>
      </>
    );
  }

  return (
    <>
      <div className="page gutter">
        <Head domain={domain} />
        {body}
      </div>
      {message && (
        <div className="toast" role="status">
          <span>{message}</span>
        </div>
      )}
    </>
  );
}

type Loaded = {
  state: MembersState;
  rows: Member[];
  refused: Refusal[];
  now: Date;
};

export function Members({ me, domain }: { me: Me; domain: string | null }) {
  const admin = me.role === "admin";
  const [load, setLoad] = useState<Loaded>({
    state: "loading",
    rows: [],
    refused: [],
    now: new Date(),
  });
  const [attempt, setAttempt] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    if (!admin) return;
    let live = true;
    void (async () => {
      const [m, r] = await Promise.all([getMembers(), getRefused()]);
      if (!live) return;
      if (m.kind === "expired" || r.kind === "expired") {
        // The app shell shows the expired screen once /api/me says so.
        window.location.reload();
        return;
      }
      if (m.kind === "ok" && r.kind === "ok") {
        setLoad({ state: "ready", rows: m.data, refused: r.data, now: new Date() });
      } else {
        // A 403 means the admin was demoted since the page loaded.
        const denied = m.kind === "forbidden" || r.kind === "forbidden";
        const network = m.kind === "network" || r.kind === "network";
        const state = denied ? "denied" : network ? "network" : "server";
        setLoad({ state, rows: [], refused: [], now: new Date() });
      }
    })();
    return () => {
      live = false;
    };
  }, [admin, attempt]);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 6000);
    return () => clearTimeout(timer);
  }, [message]);

  async function onRole(id: number, role: Role) {
    if (saving.current) return;
    saving.current = true;
    const res = await setMemberRole(id, role);
    saving.current = false;
    if (res.kind === "ok") {
      setLoad((l) => ({ ...l, rows: l.rows.map((r) => (r.id === id ? res.data : r)) }));
      setMessage(roleChangedText(res.data.name ?? res.data.email, res.data.role));
    } else if (res.kind === "expired") {
      window.location.reload();
    } else {
      setMessage(saveErrorText(res.kind));
    }
  }

  function onRetry() {
    setLoad((l) => ({ ...l, state: "loading" }));
    setAttempt((n) => n + 1);
  }

  return (
    <MembersView
      state={admin ? load.state : "denied"}
      me={me}
      rows={load.rows}
      refused={load.refused}
      message={message}
      domain={domain}
      now={load.now}
      onRole={(id, role) => void onRole(id, role)}
      onRetry={onRetry}
    />
  );
}
