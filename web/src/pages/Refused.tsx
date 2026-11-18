import { refusalText } from "../auth/refusal";
import { Icon } from "../components/Icon";

function lowerFirst(text: string): string {
  return text.startsWith("Google") ? text : text.charAt(0).toLowerCase() + text.slice(1);
}

export function Refused({ domain, reason }: { domain: string | null; reason: string | null }) {
  const who = domain ?? "your organisation's";
  return (
    <div className="center gutter">
      <div className="signin">
        <span className="refused-icon">
          <Icon name="alert" />
        </span>
        <div>
          <h1>We couldn't sign you in</h1>
          <p className="muted lead">
            Taskboard accepts verified Google Workspace accounts on {who} only.
          </p>
        </div>
        <div className="kv">Reason: {lowerFirst(refusalText(reason, domain))}</div>
        <a className="btn primary" href="/signin">
          Try another account
        </a>
        <p className="fine">
          If you use an {who} account and still see this, ask a workspace admin to check it. This
          attempt was recorded.
        </p>
      </div>
    </div>
  );
}
