import { describe, expect, it } from "vitest";

import type { MeResult } from "./api";
import { type Screen, resolveScreen } from "./routes";

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
];

describe("resolveScreen", () => {
  it.each(CASES)("%s with %s resolves to %s", (path, me, screen) => {
    expect(resolveScreen(path, me)).toBe(screen);
  });
});
