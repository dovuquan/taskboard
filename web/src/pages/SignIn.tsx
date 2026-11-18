import { BrandMark } from "../components/BrandMark";
import { Icon } from "../components/Icon";

export function SignIn({ domain }: { domain: string | null }) {
  return (
    <div className="center gutter">
      <div className="signin">
        <span className="brand">
          <BrandMark />
          Taskboard
        </span>
        <div>
          <h1>Sign in</h1>
          <p className="muted lead">
            {domain ? `Use your ${domain} Google Workspace account.` : "Use your Google Workspace account."}
          </p>
        </div>
        <a className="btn primary" href="/auth/login">
          <Icon name="key" /> Continue with Google
        </a>
        <p className="fine">
          First time here? You join the workspace as a member the first time you sign in. Personal
          Gmail accounts are not accepted.
        </p>
      </div>
    </div>
  );
}
