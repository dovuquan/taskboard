import { describe, expect, it } from "vitest";

import type { MeResult } from "./api";
import { type Screen, boardIdFromPath, needsMemberCount, resolveScreen } from "./routes";

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

describe("resolveScreen", () => {
  it.each(CASES)("%s with %s resolves to %s", (path, me, screen) => {
    expect(resolveScreen(path, me)).toBe(screen);
  });
});
