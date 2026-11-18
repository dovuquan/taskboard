import { Icon } from "../components/Icon";

export function Expired() {
  return (
    <div className="center gutter">
      <div className="signin">
        <span className="refused-icon">
          <Icon name="lock" />
        </span>
        <div>
          <h1>Your session has ended</h1>
          <p className="muted lead">
            Taskboard signs you out after 14 days. Sign in again to carry on. Nothing you saved is
            lost.
          </p>
        </div>
        <a className="btn primary" href="/auth/login">
          <Icon name="key" /> Sign in again with Google
        </a>
      </div>
    </div>
  );
}
