import { useEffect, useState } from "react";

import { type Me, type MeResult, getConfig, getMe, getMemberCount } from "./api";
import { AppBar } from "./components/AppBar";
import { Boards } from "./pages/Boards";
import { Expired } from "./pages/Expired";
import { Refused } from "./pages/Refused";
import { SignIn } from "./pages/SignIn";
import { type Screen, resolveScreen } from "./routes";

type AppViewProps = {
  screen: Screen;
  domain: string | null;
  reason: string | null;
  user: Me | null;
  memberCount: number | null;
};

export function AppView(props: AppViewProps) {
  const { screen, user } = props;
  return (
    <>
      {screen === "boards" && user && <AppBar user={user} />}
      <main id="screen">
        <Screen {...props} />
      </main>
    </>
  );
}

function Screen({ screen, domain, reason, memberCount }: AppViewProps) {
  switch (screen) {
    case "signin":
      return <SignIn domain={domain} />;
    case "refused":
      return <Refused domain={domain} reason={reason} />;
    case "expired":
      return <Expired />;
    case "boards":
      return (
        <Boards domain={domain} memberCount={memberCount} />
      );
    case "error":
      return (
        <div className="page gutter">
          <div className="empty error">
            <h2>Can't reach Taskboard</h2>
            <p>
              This page could not be loaded because Taskboard isn't answering. Check your
              connection, or ask an admin whether the server is running.
            </p>
            <button className="btn" type="button" onClick={() => window.location.reload()}>
              Try again
            </button>
          </div>
        </div>
      );
  }
}

type Loaded = AppViewProps | null;

export function App() {
  const [state, setState] = useState<Loaded>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [domain, me]: [string | null, MeResult] = await Promise.all([getConfig(), getMe()]);
      const user = me.kind === "user" ? me.user : null;
      const memberCount = user ? await getMemberCount() : null;
      const reason = new URLSearchParams(window.location.search).get("reason");
      const screen = resolveScreen(window.location.pathname, me.kind);
      if (live) setState({ screen, domain, reason, user, memberCount });
    })();
    return () => {
      live = false;
    };
  }, []);

  return state ? <AppView {...state} /> : null;
}
