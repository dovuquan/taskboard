import type { MeResult } from "./api";

export type Screen =
  | "signin"
  | "refused"
  | "expired"
  | "boards"
  | "board"
  | "board-settings"
  | "members"
  | "error";

/** Only the boards screen shows the member count (the welcome variant). */
export function needsMemberCount(screen: Screen): boolean {
  return screen === "boards";
}

const BOARD_PATH = /^\/boards\/([1-9]\d{0,14})(\/settings)?\/?$/;

/** The board id in `/boards/7` or `/boards/7/settings`; null for anything else. */
export function boardIdFromPath(path: string): number | null {
  const match = BOARD_PATH.exec(path);
  return match ? Number(match[1]) : null;
}

function signedInScreen(path: string): Screen {
  if (path === "/members") return "members";
  if (boardIdFromPath(path) !== null) {
    return path.replace(/\/$/, "").endsWith("/settings") ? "board-settings" : "board";
  }
  return "boards";
}

export function resolveScreen(path: string, me: MeResult["kind"]): Screen {
  if (path === "/signin/refused") return "refused";
  switch (me) {
    case "error":
      return "error";
    case "user":
      return signedInScreen(path);
    case "expired":
      return path === "/signin" ? "signin" : "expired";
    case "signed_out":
      return "signin";
  }
}

/** Moves to another screen without a page load; the app listens for `popstate`. */
export function navigate(path: string): void {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
