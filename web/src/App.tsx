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

export function AppView({ screen, domain, reason, user, memberCount }: AppViewProps) {
  switch (screen) {
    case "signin":
      return <SignIn domain={domain} />;
    case "refused":
      return <Refused domain={domain} reason={reason} />;
    case "expired":
      return <Expired />;
    case "boards":
      return (
        <>
          {user && <AppBar user={user} />}
          <Boards domain={domain} memberCount={memberCount} />
        </>
      );
    case "error":
      return (
        <div className="center gutter">
          <div className="empty error">
            <h2>Can't reach Taskboard. Try again in a moment.</h2>
            <a className="btn" href="">
              Reload
            </a>
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
