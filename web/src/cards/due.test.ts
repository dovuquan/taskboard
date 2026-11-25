import { describe, expect, it } from "vitest";

import { DUE_LABEL, dueState, dueTitle, formatDue } from "./due";

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);

/** The calendar date `offset` days from y-m-d, as YYYY-MM-DD, in local time. */
function day(y: number, m: number, d: number, offset: number): string {
  const date = new Date(y, m - 1, d + offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

describe("dueState", () => {
  const now = at(2026, 11, 25);

  it("is over for yesterday", () => {
    expect(dueState("2026-11-24", now)).toBe("over");
  });

  it("is soon for today, tomorrow and the day after", () => {
    expect(dueState("2026-11-25", now)).toBe("soon");
    expect(dueState("2026-11-26", now)).toBe("soon");
    expect(dueState("2026-11-27", now)).toBe("soon");
  });

  it("is none three days out and beyond", () => {
    expect(dueState("2026-11-28", now)).toBeNull();
    expect(dueState("2027-01-01", now)).toBeNull();
  });

  it("is over a long time after", () => {
    expect(dueState("2020-01-01", now)).toBe("over");
  });

  it("has no state without a date or with an unreadable one", () => {
    expect(dueState(null, now)).toBeNull();
    expect(dueState("", now)).toBeNull();
    expect(dueState("tomorrow", now)).toBeNull();
    expect(dueState("2026-13-45", now)).toBeNull();
    expect(dueState("2026-02-30", now)).toBeNull();
  });

  it("does not depend on the time of day", () => {
    for (const [h, min] of [[0, 0], [0, 1], [12, 0], [23, 59]]) {
      const t = at(2026, 11, 25, h, min);
      expect(dueState("2026-11-24", t)).toBe("over");
      expect(dueState("2026-11-25", t)).toBe("soon");
      expect(dueState("2026-11-27", t)).toBe("soon");
      expect(dueState("2026-11-28", t)).toBeNull();
    }
  });

  it("reads the date as a calendar day, not a UTC instant", () => {
    // Late evening or early morning must not shift the day, in any viewer time zone.
    expect(dueState("2026-11-25", at(2026, 11, 25, 23, 59))).toBe("soon");
    expect(dueState("2026-11-24", at(2026, 11, 25, 0, 1))).toBe("over");
  });

  // Days around the clock changes of the US (8 Mar, 1 Nov 2026) and Europe (29 Mar, 25 Oct 2026):
  // a day is 23 or 25 hours there, so the day count must be rounded, not cut.
  const changes: [number, number, number][] = [
    [2026, 3, 8],
    [2026, 3, 29],
    [2026, 10, 25],
    [2026, 11, 1],
  ];

  it.each(changes)("counts whole days around the clock change on %i-%i-%i", (y, m, d) => {
    for (let before = -3; before <= 3; before++) {
      const today = new Date(y, m - 1, d + before, 12);
      const [ty, tm, td] = [today.getFullYear(), today.getMonth() + 1, today.getDate()];
      for (let offset = -4; offset <= 5; offset++) {
        const expected = offset < 0 ? "over" : offset <= 2 ? "soon" : null;
        expect(dueState(day(ty, tm, td, offset), today), `${before} ${offset}`).toBe(expected);
      }
    }
  });

  it("counts correctly early in the morning on a clock change day", () => {
    for (const [y, m, d] of changes) {
      const early = new Date(y, m - 1, d, 0, 30);
      expect(dueState(day(y, m, d, 2), early)).toBe("soon");
      expect(dueState(day(y, m, d, 3), early)).toBeNull();
      expect(dueState(day(y, m, d, -1), early)).toBe("over");
    }
  });
});

describe("due text", () => {
  it("writes the date as day and month", () => {
    expect(formatDue("2026-11-08")).toBe("8 Nov");
    expect(formatDue("2026-12-31")).toBe("31 Dec");
  });

  it("adds the state to the accessible title", () => {
    expect(dueTitle("2026-11-08", null)).toBe("Due 8 Nov");
    expect(dueTitle("2026-11-08", "over")).toBe("Due 8 Nov, overdue");
    expect(dueTitle("2026-11-08", "soon")).toBe("Due 8 Nov, due soon");
  });

  it("labels the two chips", () => {
    expect(DUE_LABEL).toEqual({ over: "Overdue", soon: "Due soon" });
  });
});
