import { describe, expect, it, vi } from "vitest";

import type { ListResult, Me, Member, Refusal, RoleResult } from "../api";
import { type MembersApi, loadMembers, saveRole, shouldLoad } from "./logic";

const row = (id: number, role: "admin" | "member", name: string | null = `User ${id}`): Member => ({
  id,
  email: `u${id}@example.com`,
  name,
  avatar_url: null,
  role,
  joined_at: null,
  last_seen_at: null,
  pending: false,
});

const ann = row(1, "admin");
const bob = row(2, "member", "Bob Tran");
const feed: Refusal[] = [{ at: "2026-11-18T09:12:00Z", email: null, reason: "wrong_domain" }];

function fakeApi(over: Partial<MembersApi> = {}): MembersApi {
  return {
    getMembers: async () => ({ kind: "ok", data: [ann, bob] }),
    getRefused: async () => ({ kind: "ok", data: feed }),
    setMemberRole: async () => ({ kind: "ok", data: { ...bob, role: "admin" } }),
    ...over,
  };
}

const me = (role: "admin" | "member"): Me => ({ ...ann, role });

describe("shouldLoad", () => {
  it("is true for admins only", () => {
    expect(shouldLoad(me("admin"))).toBe(true);
    expect(shouldLoad(me("member"))).toBe(false);
  });
});

describe("loadMembers", () => {
  it("returns the rows and the feed when both calls work", async () => {
    expect(await loadMembers(fakeApi())).toEqual({
      expired: false,
      state: "ready",
      rows: [ann, bob],
      refused: feed,
    });
  });

  it.each([
    ["getMembers", "forbidden", "denied"],
    ["getRefused", "forbidden", "denied"],
    ["getMembers", "network", "network"],
    ["getRefused", "network", "network"],
    ["getMembers", "server", "server"],
    ["getRefused", "server", "server"],
  ] as const)("%s %s gives %s with no rows", async (which, kind, state) => {
    const failing = async (): Promise<ListResult<never[]>> => ({ kind });
    const out = await loadMembers(fakeApi({ [which]: failing }));
    expect(out).toEqual({ expired: false, state, rows: [], refused: [] });
  });

  it("signals an expired session from either call", async () => {
    const gone = async (): Promise<ListResult<never[]>> => ({ kind: "expired" });
    expect(await loadMembers(fakeApi({ getMembers: gone }))).toEqual({ expired: true });
    expect(await loadMembers(fakeApi({ getRefused: gone }))).toEqual({ expired: true });
  });
});

describe("saveRole", () => {
  it("waits for the server, swaps in the returned row and says so", async () => {
    const setMemberRole = vi.fn(async (): Promise<RoleResult> => ({
      kind: "ok",
      data: { ...bob, role: "admin" },
    }));
    const out = await saveRole(fakeApi({ setMemberRole }), [ann, bob], 2, "admin");
    expect(setMemberRole).toHaveBeenCalledWith(2, "admin");
    expect(out).toEqual({
      rows: [ann, { ...bob, role: "admin" }],
      message: "Bob Tran is now a workspace admin",
      expired: false,
      denied: false,
    });
  });

  it("names a member without a name by email and says member for a demotion", async () => {
    const nameless = row(3, "admin", null);
    const out = await saveRole(
      fakeApi({
        setMemberRole: async () => ({ kind: "ok", data: { ...nameless, role: "member" } }),
      }),
      [ann, nameless],
      3,
      "member",
    );
    expect(out.message).toBe("u3@example.com is now a workspace member");
  });

  it.each([
    ["last_admin", "A workspace needs at least one admin. Make someone else an admin first."],
    ["own_role", "You cannot change your own role"],
    ["network", "Can't reach Taskboard. Your change was undone."],
    ["server", "That did not go through. Your change was undone; try again."],
  ] as const)("%s keeps the rows and shows the mapped toast", async (kind, message) => {
    const rows = [ann, bob];
    const out = await saveRole(fakeApi({ setMemberRole: async () => ({ kind }) }), rows, 2, "admin");
    expect(out).toEqual({ rows, message, expired: false, denied: false });
    expect(out.rows[1].role).toBe("member");
  });

  it("signals an expired session and keeps the rows", async () => {
    const rows = [ann, bob];
    const out = await saveRole(
      fakeApi({ setMemberRole: async () => ({ kind: "expired" }) }),
      rows,
      2,
      "admin",
    );
    expect(out).toEqual({ rows, message: null, expired: true, denied: false });
  });

  it("signals denied on 403 and keeps the rows", async () => {
    const rows = [ann, bob];
    const out = await saveRole(
      fakeApi({ setMemberRole: async () => ({ kind: "forbidden" }) }),
      rows,
      2,
      "admin",
    );
    expect(out).toEqual({ rows, message: null, expired: false, denied: true });
  });
});
