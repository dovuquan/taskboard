import { describe, expect, it } from "vitest";

import {
  formatJoined,
  formatLastActive,
  formatWhen,
  roleChangedText,
  saveErrorText,
} from "./text";

// Built from local parts so the tests do not depend on the time zone of the machine.
const NOW = new Date(2026, 10, 18, 12, 0);
const at = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m - 1, d, h, min).toISOString();

describe("saveErrorText", () => {
  it.each([
    ["last_admin", "A workspace needs at least one admin. Make someone else an admin first."],
    ["own_role", "You cannot change your own role"],
    ["network", "Can't reach Taskboard. Your change was undone."],
    ["expired", "Your session has ended. Your change was undone; sign in again."],
    ["server", "That did not go through. Your change was undone; try again."],
    ["forbidden", "That did not go through. Your change was undone; try again."],
  ] as const)("%s", (kind, text) => {
    expect(saveErrorText(kind)).toBe(text);
  });
});

describe("roleChangedText", () => {
  it("names the new workspace role", () => {
    expect(roleChangedText("Bob Tran", "admin")).toBe("Bob Tran is now a workspace admin");
    expect(roleChangedText("Bob Tran", "member")).toBe("Bob Tran is now a workspace member");
  });
});

describe("formatJoined", () => {
  it("shows day and short month", () => {
    expect(formatJoined(at(2026, 10, 20), NOW)).toBe("20 Oct");
    expect(formatJoined(at(2026, 11, 5), NOW)).toBe("5 Nov");
  });

  it("adds the year when it is not this year", () => {
    expect(formatJoined(at(2025, 12, 31), NOW)).toBe("31 Dec 2025");
  });
});

describe("formatLastActive", () => {
  it("says Not yet without a last-seen time", () => {
    expect(formatLastActive(null, NOW)).toBe("Not yet");
  });

  it("says Today and Yesterday by local calendar day", () => {
    expect(formatLastActive(at(2026, 11, 18, 0, 5), NOW)).toBe("Today");
    expect(formatLastActive(at(2026, 11, 17, 23, 55), NOW)).toBe("Yesterday");
  });

  it("shows the date for older days", () => {
    expect(formatLastActive(at(2026, 11, 8), NOW)).toBe("8 Nov");
  });
});

describe("formatWhen", () => {
  it("shows the day word or date, then HH:MM", () => {
    expect(formatWhen(at(2026, 11, 18, 9, 12), NOW)).toBe("Today 09:12");
    expect(formatWhen(at(2026, 11, 17, 14, 5), NOW)).toBe("Yesterday 14:05");
    expect(formatWhen(at(2026, 11, 13, 7, 0), NOW)).toBe("13 Nov 07:00");
  });
});
