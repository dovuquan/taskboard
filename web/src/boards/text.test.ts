import { describe, expect, it } from "vitest";

import { formatUpdated, memberCountText, visibilityText } from "./text";

const now = new Date("2026-11-20T12:00:00Z");

describe("formatUpdated", () => {
  it("reads just now under a minute", () => {
    expect(formatUpdated("2026-11-20T11:59:30Z", now)).toBe("just now");
  });

  it("counts minutes and hours", () => {
    expect(formatUpdated("2026-11-20T11:55:00Z", now)).toBe("5 min ago");
    expect(formatUpdated("2026-11-20T09:00:00Z", now)).toBe("3 h ago");
  });

  it("treats a time slightly in the future as just now", () => {
    expect(formatUpdated("2026-11-20T12:00:20Z", now)).toBe("just now");
  });

  it("falls back to a day word or date after a day", () => {
    expect(formatUpdated("2026-10-01T12:00:00Z", now)).toMatch(/^1 Oct$/);
  });
});

describe("memberCountText", () => {
  it("is singular for one", () => {
    expect(memberCountText(1)).toBe("1 member");
    expect(memberCountText(5)).toBe("5 members");
  });
});

describe("visibilityText", () => {
  it("names the two kinds", () => {
    expect(visibilityText("workspace")).toBe("Workspace");
    expect(visibilityText("private")).toBe("Private");
  });
});
