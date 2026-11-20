import { describe, expect, it } from "vitest";

import type { BoardError, BoardMember, BoardRole, Member } from "../api";
import {
  LAST_OWNER_TEXT,
  addMatches,
  boardErrorText,
  describeFailure,
  lastOwnerBlock,
  roleChangedText,
  roleChip,
  tileColor,
} from "./logic";

const person = (id: number, name: string | null, role: BoardRole = "member"): BoardMember => ({
  id,
  name,
  email: `u${id}@example.com`,
  avatar_url: null,
  role,
  added_at: "2026-11-20T08:00:00Z",
  pending: false,
});

const ws = (id: number, name: string | null, email = `u${id}@example.com`): Member => ({
  id,
  name,
  email,
  avatar_url: null,
  role: "member",
  joined_at: null,
  last_seen_at: null,
  pending: false,
});

describe("roleChip", () => {
  it("names each board role", () => {
    expect(roleChip("owner")).toBe("Owner");
    expect(roleChip("member")).toBe("Member");
    expect(roleChip("observer")).toBe("Observer");
  });
});

describe("roleChangedText", () => {
  it("reads like the prototype's toast", () => {
    expect(roleChangedText("Bob Tran", "owner")).toBe("Bob Tran is now an owner");
    expect(roleChangedText("Bob Tran", "member")).toBe("Bob Tran is now a member");
    expect(roleChangedText("Bob Tran", "observer")).toBe("Bob Tran is now an observer");
  });
});

describe("addMatches", () => {
  const everyone = [
    ws(1, "Ann Lee"),
    ws(2, "Bob Tran"),
    ws(3, "Cara Nguyen", "cara.n@example.com"),
    ws(4, null, "dan@example.com"),
  ];

  it("matches the name, case-insensitively", () => {
    expect(addMatches("tran", everyone, []).map((m) => m.id)).toEqual([2]);
  });

  it("matches the email", () => {
    expect(addMatches("CARA.N@", everyone, []).map((m) => m.id)).toEqual([3]);
    expect(addMatches("dan", everyone, []).map((m) => m.id)).toEqual([4]);
  });

  it("leaves out people who are already on the board", () => {
    const onBoard = [person(2, "Bob Tran")];
    expect(addMatches("tran", everyone, onBoard)).toEqual([]);
    expect(addMatches("example", everyone, onBoard).map((m) => m.id)).toEqual([1, 3, 4]);
  });

  it("returns nothing for a blank query", () => {
    expect(addMatches("", everyone, [])).toEqual([]);
    expect(addMatches("   ", everyone, [])).toEqual([]);
  });

  it("returns at most 6 people", () => {
    const many = Array.from({ length: 10 }, (_, i) => ws(i + 1, `Person ${i + 1}`));
    expect(addMatches("person", many, [])).toHaveLength(6);
  });
});

describe("lastOwnerBlock", () => {
  const solo = [person(1, "Ann", "owner"), person(2, "Bob", "member")];
  const pair = [person(1, "Ann", "owner"), person(2, "Bob", "owner")];

  it("blocks demoting or removing the only owner", () => {
    expect(lastOwnerBlock(solo, 1, "member")).toBe(LAST_OWNER_TEXT);
    expect(lastOwnerBlock(solo, 1, "observer")).toBe(LAST_OWNER_TEXT);
    expect(lastOwnerBlock(solo, 1, "remove")).toBe(LAST_OWNER_TEXT);
  });

  it("has the prototype's wording", () => {
    expect(LAST_OWNER_TEXT).toBe(
      "A board needs at least one owner. Make someone else an owner first.",
    );
  });

  it("allows the change when another owner remains", () => {
    expect(lastOwnerBlock(pair, 1, "member")).toBeNull();
    expect(lastOwnerBlock(pair, 2, "remove")).toBeNull();
  });

  it("allows anything that leaves the owner an owner, or touches a non-owner", () => {
    expect(lastOwnerBlock(solo, 1, "owner")).toBeNull();
    expect(lastOwnerBlock(solo, 2, "remove")).toBeNull();
    expect(lastOwnerBlock(solo, 2, "owner")).toBeNull();
  });
});

describe("tileColor", () => {
  const TOKENS = [
    "launch",
    "bug",
    "docs",
    "ops",
    "marketing",
    "research",
    "design",
  ].map((n) => `var(--l-${n})`);

  it("always returns one of the seven label tokens", () => {
    for (const id of [1, 2, 7, 8, 100, 2 ** 40]) expect(TOKENS).toContain(tileColor(id));
  });

  it("is stable for an id and cycles through all seven", () => {
    expect(tileColor(5)).toBe(tileColor(5));
    expect(new Set([1, 2, 3, 4, 5, 6, 7].map(tileColor)).size).toBe(7);
    expect(tileColor(8)).toBe(tileColor(1));
  });
});

describe("boardErrorText", () => {
  const KINDS: BoardError[] = [
    "forbidden",
    "expired",
    "network",
    "server",
    "not_found",
    "member_not_found",
    "already_member",
    "last_owner",
    "has_owner",
    "invalid",
    "conflict",
  ];

  it("has text for every error code", () => {
    for (const k of KINDS) expect(boardErrorText(k).length).toBeGreaterThan(10);
  });

  it("explains the cases a person can fix", () => {
    expect(boardErrorText("last_owner")).toBe(LAST_OWNER_TEXT);
    expect(boardErrorText("already_member")).toBe("That person is already on this board.");
    expect(boardErrorText("forbidden")).toBe("Only board owners can change this.");
    expect(boardErrorText("network")).toBe("Can't reach Taskboard. Your change was not saved.");
  });

  it("falls back to the generic line", () => {
    expect(boardErrorText("server")).toBe("That did not go through. Try again.");
    expect(boardErrorText("conflict")).toBe("That did not go through. Try again.");
  });
});

describe("describeFailure", () => {
  it("flags an expired session so the page reloads", () => {
    expect(describeFailure("expired")).toMatchObject({ expired: true, gone: false });
  });

  it("flags a missing board so the page shows the not-here state", () => {
    expect(describeFailure("not_found")).toMatchObject({ expired: false, gone: true });
  });

  it("shows a toast for everything else", () => {
    const out = describeFailure("last_owner");
    expect(out).toEqual({ expired: false, gone: false, message: LAST_OWNER_TEXT });
  });
});
