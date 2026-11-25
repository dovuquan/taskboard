import { describe, expect, it } from "vitest";

import type { MeResult } from "./api";
import {
  type Screen,
  boardIdFromPath,
  cardKeyFromPath,
  cardPath,
  needsMemberCount,
  resolveScreen,
} from "./routes";

type Kind = MeResult["kind"];

const CASES: [string, Kind, Screen][] = [
  ["/signin/refused", "user", "refused"],
  ["/signin/refused", "signed_out", "refused"],
  ["/signin/refused", "expired", "refused"],
  ["/signin/refused", "error", "refused"],

  ["/", "error", "error"],
  ["/signin", "error", "error"],
  ["/boards", "error", "error"],
  ["/nowhere", "error", "error"],

  ["/signin", "user", "boards"],
  ["/signin", "signed_out", "signin"],
  ["/signin", "expired", "signin"],

  ["/", "user", "boards"],
  ["/boards", "user", "boards"],
  ["/nowhere", "user", "boards"],
  ["/", "expired", "expired"],
  ["/boards", "expired", "expired"],
  ["/nowhere", "expired", "expired"],
  ["/", "signed_out", "signin"],
  ["/boards", "signed_out", "signin"],
  ["/nowhere", "signed_out", "signin"],

  ["/members", "user", "members"],
  ["/members", "error", "error"],
  ["/members", "expired", "expired"],
  ["/members", "signed_out", "signin"],

  ["/boards/7", "user", "board"],
  ["/boards/7/", "user", "board"],
  ["/boards/7/settings", "user", "board-settings"],
  ["/boards/7", "expired", "expired"],
  ["/boards/7/settings", "signed_out", "signin"],
  ["/boards/7", "error", "error"],
  ["/boards/abc", "user", "boards"],
  ["/boards/0", "user", "boards"],
  ["/boards/-3", "user", "boards"],
  ["/boards/007", "user", "boards"],
  ["/boards/7/other", "user", "boards"],
  ["/boards/99999999999999999999", "user", "boards"],

  ["/boards/7/cards/TB-3", "user", "board-card"],
  ["/boards/7/cards/TB-3/", "user", "board-card"],
  ["/boards/7/cards/tb-3", "user", "board-card"],
  ["/boards/7/cards/TB-3", "expired", "expired"],
  ["/boards/7/cards/TB-3", "signed_out", "signin"],
  ["/boards/7/cards/TB-3", "error", "error"],
  ["/boards/7/cards/TB-3/extra", "user", "boards"],
  ["/boards/7/cards/", "user", "boards"],
  ["/boards/7/cards", "user", "boards"],
  ["/boards/0/cards/TB-3", "user", "boards"],
  ["/boards/abc/cards/TB-3", "user", "boards"],
];

describe("needsMemberCount", () => {
  it("is true for the boards screen only", () => {
    expect(needsMemberCount("boards")).toBe(true);
    for (const s of ["members", "signin", "refused", "expired", "error"] as const) {
      expect(needsMemberCount(s)).toBe(false);
    }
  });
});

describe("boardIdFromPath", () => {
  it("reads the id from a board path and its settings path", () => {
    expect(boardIdFromPath("/boards/7")).toBe(7);
    expect(boardIdFromPath("/boards/12/settings")).toBe(12);
  });

  it.each(["/boards", "/boards/abc", "/boards/0", "/boards/1.5", "/members", "/boards/7/x"])(
    "is null for %s",
    (path) => {
      expect(boardIdFromPath(path)).toBeNull();
    },
  );
});

describe("card paths", () => {
  it("reads the board id from a card path too", () => {
    expect(boardIdFromPath("/boards/7/cards/TB-3")).toBe(7);
    expect(boardIdFromPath("/boards/12/cards/TB-3/")).toBe(12);
  });

  it("reads the key as one whole path segment", () => {
    expect(cardKeyFromPath("/boards/7/cards/TB-3")).toBe("TB-3");
    expect(cardKeyFromPath("/boards/7/cards/TB-3/")).toBe("TB-3");
    expect(cardKeyFromPath("/boards/7/cards/TB-123")).toBe("TB-123");
  });

  it("keeps the case and everything else of the segment, so a lookup can refuse it", () => {
    expect(cardKeyFromPath("/boards/7/cards/tb-3")).toBe("tb-3");
    expect(cardKeyFromPath("/boards/7/cards/TB-3abc")).toBe("TB-3abc");
    expect(cardKeyFromPath("/boards/7/cards/TB-3%20")).toBe("TB-3 ");
    expect(cardKeyFromPath("/boards/7/cards/TB%2D3")).toBe("TB-3");
  });

  it("keeps an undecodable segment as it is", () => {
    expect(cardKeyFromPath("/boards/7/cards/TB-%E0%A4%A")).toBe("TB-%E0%A4%A");
  });

  it.each([
    "/boards/7",
    "/boards/7/settings",
    "/boards/7/cards",
    "/boards/7/cards/",
    "/boards/7/cards/TB-3/more",
    "/boards/7/cards/TB-3/settings",
    "/boards/0/cards/TB-3",
    "/boards/x/cards/TB-3",
    "/members",
    "/",
  ])("has no key in %s", (path) => {
    expect(cardKeyFromPath(path)).toBeNull();
  });

  it("builds the path and encodes the key", () => {
    expect(cardPath(7, "TB-3")).toBe("/boards/7/cards/TB-3");
    expect(cardPath(7, "a/b?c")).toBe("/boards/7/cards/a%2Fb%3Fc");
  });
});

describe("resolveScreen", () => {
  it.each(CASES)("%s with %s resolves to %s", (path, me, screen) => {
    expect(resolveScreen(path, me)).toBe(screen);
  });
});
