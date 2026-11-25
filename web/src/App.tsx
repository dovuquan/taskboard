import { useEffect, useState } from "react";

import { type Me, type MeResult, getConfig, getMe, getMemberCount } from "./api";
import { AppBar } from "./components/AppBar";
import { Board } from "./pages/Board";
import { Boards } from "./pages/Boards";
import { Expired } from "./pages/Expired";
import { Members } from "./pages/Members";
import { Refused } from "./pages/Refused";
import { SignIn } from "./pages/SignIn";
import {
  type Screen,
  boardIdFromPath,
  cardKeyFromPath,
  needsMemberCount,
  resolveScreen,
} from "./routes";

type AppViewProps = {
  screen: Screen;
  domain: string | null;
  reason: string | null;
  user: Me | null;
  memberCount: number | null;
  boardId?: number | null;
  cardKey?: string | null;
  boardName?: string | null;
  onBoardName?: (name: string | null) => void;
};

function barScreen(screen: Screen): "boards" | "members" | "board" | null {
  switch (screen) {
    case "boards":
    case "members":
      return screen;
    case "board":
    case "board-settings":
    case "board-card":
      return "board";
    default:
      return null;
  }
}

export function AppView(props: AppViewProps) {
  const { screen, user, boardName } = props;
  const bar = barScreen(screen);
  return (
    <>
      {bar && user && <AppBar user={user} screen={bar} boardName={boardName} />}
      <main id="screen">
        <Screen {...props} />
      </main>
    </>
  );
}

function Screen({
  screen,
  domain,
  reason,
  memberCount,
  user,
  boardId,
  cardKey,
  onBoardName,
}: AppViewProps) {
  switch (screen) {
    case "signin":
      return <SignIn domain={domain} />;
    case "refused":
      return <Refused domain={domain} reason={reason} />;
    case "expired":
      return <Expired />;
    case "boards":
      return user && <Boards me={user} domain={domain} memberCount={memberCount} />;
    case "board":
    case "board-settings":
    case "board-card":
      // The three share one element, so opening a card or the settings never remounts the board.
      return (
        user &&
        boardId != null && (
          <Board
            id={boardId}
            settings={screen === "board-settings"}
            cardKey={screen === "board-card" ? (cardKey ?? null) : null}
            me={user}
            domain={domain}
            onBoardName={onBoardName}
          />
        )
      );
    case "members":
      return user && <Members me={user} domain={domain} />;
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

type Boot = {
  domain: string | null;
  me: MeResult["kind"];
  user: Me | null;
  reason: string | null;
};

export function App() {
  const [boot, setBoot] = useState<Boot | null>(null);
  const [path, setPath] = useState(window.location.pathname);
  const [boardName, setBoardName] = useState<string | null>(null);
  const [memberCount, setMemberCount] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [domain, me]: [string | null, MeResult] = await Promise.all([getConfig(), getMe()]);
      const user = me.kind === "user" ? me.user : null;
      const screen = resolveScreen(window.location.pathname, me.kind);
      const count = user && needsMemberCount(screen) ? await getMemberCount() : null;
      const reason = new URLSearchParams(window.location.search).get("reason");
      if (!live) return;
      setMemberCount(count);
      setBoot({ domain, me: me.kind, user, reason });
    })();
    return () => {
      live = false;
    };
  }, []);

  // Links call `navigate`, which pushes history and fires `popstate`; Back and Forward do too.
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const screen = boot ? resolveScreen(path, boot.me) : null;
  const wantsCount = boot?.user != null && screen !== null && needsMemberCount(screen);

  // Coming back to Boards after the first screen was something else: the count is still unknown.
  useEffect(() => {
    if (!wantsCount || memberCount !== null) return;
    let live = true;
    void getMemberCount().then((n) => {
      if (live) setMemberCount(n);
    });
    return () => {
      live = false;
    };
  }, [wantsCount, memberCount]);

  if (!boot || !screen) return null;
  return (
    <AppView
      screen={screen}
      domain={boot.domain}
      reason={boot.reason}
      user={boot.user}
      memberCount={memberCount}
      boardId={boardIdFromPath(path)}
      cardKey={cardKeyFromPath(path)}
      boardName={boardName}
      onBoardName={setBoardName}
    />
  );
}
