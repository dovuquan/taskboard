import type { MeResult } from "./api";

export type Screen =
  | "signin"
  | "refused"
  | "expired"
  | "boards"
  | "board"
  | "board-settings"
  | "board-archived"
  | "board-card"
  | "members"
  | "error";

/** Only the boards screen shows the member count (the welcome variant). */
export function needsMemberCount(screen: Screen): boolean {
  return screen === "boards";
}

const BOARD_PATH = /^\/boards\/([1-9]\d{0,14})(\/settings|\/archived|\/cards\/[^/]+)?\/?$/;
const CARD_PATH = /^\/boards\/[1-9]\d{0,14}\/cards\/([^/]+)\/?$/;

/**
 * The board id in `/boards/7`, `/boards/7/settings`, `/boards/7/archived` or
 * `/boards/7/cards/TB-3`; null otherwise.
 */
export function boardIdFromPath(path: string): number | null {
  const match = BOARD_PATH.exec(path);
  return match ? Number(match[1]) : null;
}

/**
 * The card key in `/boards/7/cards/TB-3`: the one path segment after `cards`, decoded and kept
 * whole (case and all), so a lookup by exact key can refuse `tb-3` or `TB-3abc`. Null for any
 * other path.
 */
export function cardKeyFromPath(path: string): string | null {
  const match = CARD_PATH.exec(path);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/** The path of a card's dialog on its board. */
export function cardPath(boardId: number, key: string): string {
  return `/boards/${boardId}/cards/${encodeURIComponent(key)}`;
}

function signedInScreen(path: string): Screen {
  if (path === "/members") return "members";
  if (boardIdFromPath(path) !== null) {
    if (cardKeyFromPath(path) !== null) return "board-card";
    const end = path.replace(/\/$/, "");
    if (end.endsWith("/archived")) return "board-archived";
    return end.endsWith("/settings") ? "board-settings" : "board";
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
