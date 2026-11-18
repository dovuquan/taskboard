import { Icon } from "../components/Icon";

const HINT = "Arrives with M2";

export function Boards({ domain, memberCount }: { domain: string | null; memberCount: number | null }) {
  const solo = memberCount === 1;
  return (
    <div className="page gutter">
      <div className="page-head">
        <div>
          <h1>Boards</h1>
          {domain && <p className="muted lead">{domain} workspace</p>}
        </div>
        <button className="btn primary" type="button" disabled title={HINT}>
          <Icon name="plus" /> New board
        </button>
      </div>
      {solo ? (
        <div className="empty">
          <h2>Welcome to Taskboard</h2>
          <p>
            You're the first one here. Create a board for a project or team; colleagues join the
            workspace the first time they sign in with their {domain ?? "Workspace"} account.
          </p>
          <button className="btn primary" type="button" disabled title={HINT}>
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
          <button className="btn primary" type="button" disabled title={HINT}>
            <Icon name="plus" /> New board
          </button>
        </div>
      )}
    </div>
  );
}
