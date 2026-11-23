import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addBoardMember,
  archiveList,
  copyCard,
  createBoard,
  createCard,
  createList,
  getBoard,
  getCards,
  moveCard,
  getLists,
  moveList,
  renameList,
  restoreList,
  getBoardMembers,
  getBoards,
  getConfig,
  getMe,
  getMemberCount,
  getMembers,
  getOwnerless,
  getRefused,
  patchBoard,
  removeBoardMember,
  setBoardRole,
  setMemberRole,
  signOut,
  takeOwnership,
} from "./api";

const user = {
  id: 1,
  email: "ann@example.com",
  name: "Ann Lee",
  avatar_url: null,
  role: "admin",
};

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(impl: () => Promise<Response>) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getMe", () => {
  it("returns the user on 200 and sends the session cookie", async () => {
    const fetchMock = stubFetch(async () => reply(200, user));
    expect(await getMe()).toEqual({ kind: "user", user });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/me");
    expect(init.credentials).toBe("same-origin");
  });

  it("reports an expired session on 401 session_expired", async () => {
    stubFetch(async () => reply(401, { detail: "session_expired" }));
    expect(await getMe()).toEqual({ kind: "expired" });
  });

  it("reports signed out on any other 401", async () => {
    stubFetch(async () => reply(401, { detail: "not_authenticated" }));
    expect(await getMe()).toEqual({ kind: "signed_out" });
  });

  it("reports signed out on a 401 without a JSON body", async () => {
    stubFetch(async () => new Response("nope", { status: 401 }));
    expect(await getMe()).toEqual({ kind: "signed_out" });
  });

  it("reports an error on other statuses", async () => {
    stubFetch(async () => reply(500, { detail: "boom" }));
    expect(await getMe()).toEqual({ kind: "error" });
  });

  it("reports an error when the request throws", async () => {
    stubFetch(async () => {
      throw new TypeError("network down");
    });
    expect(await getMe()).toEqual({ kind: "error" });
  });
});

describe("getConfig", () => {
  it("returns allowed_hd", async () => {
    const fetchMock = stubFetch(async () => reply(200, { allowed_hd: "example.com" }));
    expect(await getConfig()).toBe("example.com");
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe("/api/config");
  });

  it("returns null on a failed status", async () => {
    stubFetch(async () => reply(500, {}));
    expect(await getConfig()).toBeNull();
  });

  it("returns null when the request throws", async () => {
    stubFetch(async () => {
      throw new TypeError("network down");
    });
    expect(await getConfig()).toBeNull();
  });
});

const member = {
  id: 2,
  email: "bob@example.com",
  name: "Bob Tran",
  avatar_url: null,
  role: "member",
  joined_at: "2026-10-22T08:00:00Z",
  last_seen_at: null,
  pending: true,
};

function throwing() {
  return stubFetch(async () => {
    throw new TypeError("network down");
  });
}

describe("getMembers", () => {
  it("returns the rows on 200 and sends the session cookie", async () => {
    const fetchMock = stubFetch(async () => reply(200, [member]));
    expect(await getMembers()).toEqual({ kind: "ok", data: [member] });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/members");
    expect(init.credentials).toBe("same-origin");
  });

  it("reports a non-array body as a server problem", async () => {
    stubFetch(async () => reply(200, { members: [] }));
    expect(await getMembers()).toEqual({ kind: "server" });
  });

  it("reports an expired session on 401 session_expired", async () => {
    stubFetch(async () => reply(401, { detail: "session_expired" }));
    expect(await getMembers()).toEqual({ kind: "expired" });
  });

  it("reports forbidden on 403", async () => {
    stubFetch(async () => reply(403, { detail: "forbidden" }));
    expect(await getMembers()).toEqual({ kind: "forbidden" });
  });

  it("reports a server problem on 500", async () => {
    stubFetch(async () => reply(500, { detail: "boom" }));
    expect(await getMembers()).toEqual({ kind: "server" });
  });

  it("reports a network problem when the request throws", async () => {
    throwing();
    expect(await getMembers()).toEqual({ kind: "network" });
  });
});

describe("getRefused", () => {
  const feed = [{ at: "2026-11-18T09:12:00Z", email: null, reason: "wrong_domain" }];

  it("returns the feed on 200", async () => {
    const fetchMock = stubFetch(async () => reply(200, feed));
    expect(await getRefused()).toEqual({ kind: "ok", data: feed });
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe("/api/auth-events/refused");
  });

  it("reports an expired session on 401", async () => {
    stubFetch(async () => reply(401, { detail: "session_expired" }));
    expect(await getRefused()).toEqual({ kind: "expired" });
  });

  it("reports forbidden on 403", async () => {
    stubFetch(async () => reply(403, { detail: "forbidden" }));
    expect(await getRefused()).toEqual({ kind: "forbidden" });
  });

  it("reports a server problem on 500", async () => {
    stubFetch(async () => reply(500, {}));
    expect(await getRefused()).toEqual({ kind: "server" });
  });

  it("reports a network problem when the request throws", async () => {
    throwing();
    expect(await getRefused()).toEqual({ kind: "network" });
  });
});

describe("setMemberRole", () => {
  it("sends the role as JSON and returns the updated row on 200", async () => {
    const updated = { ...member, role: "admin" };
    const fetchMock = stubFetch(async () => reply(200, updated));
    expect(await setMemberRole(2, "admin")).toEqual({ kind: "ok", data: updated });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/members/2");
    expect(init.method).toBe("PATCH");
    expect(init.credentials).toBe("same-origin");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(init.body).toBe('{"role":"admin"}');
  });

  it("reports an expired session on 401", async () => {
    stubFetch(async () => reply(401, { detail: "session_expired" }));
    expect(await setMemberRole(2, "admin")).toEqual({ kind: "expired" });
  });

  it("reports forbidden on 403", async () => {
    stubFetch(async () => reply(403, { detail: "forbidden" }));
    expect(await setMemberRole(2, "admin")).toEqual({ kind: "forbidden" });
  });

  it("reports last_admin on 409 last_admin", async () => {
    stubFetch(async () => reply(409, { detail: "last_admin" }));
    expect(await setMemberRole(1, "member")).toEqual({ kind: "last_admin" });
  });

  it("reports own_role on 409 own_role", async () => {
    stubFetch(async () => reply(409, { detail: "own_role" }));
    expect(await setMemberRole(1, "member")).toEqual({ kind: "own_role" });
  });

  it("reports a server problem on an unknown 409", async () => {
    stubFetch(async () => reply(409, { detail: "other" }));
    expect(await setMemberRole(1, "member")).toEqual({ kind: "server" });
  });

  it("reports a server problem on 404 and 500", async () => {
    stubFetch(async () => reply(404, { detail: "member_not_found" }));
    expect(await setMemberRole(9, "admin")).toEqual({ kind: "server" });
    stubFetch(async () => reply(500, {}));
    expect(await setMemberRole(2, "admin")).toEqual({ kind: "server" });
  });

  it("reports a network problem when the request throws", async () => {
    throwing();
    expect(await setMemberRole(2, "admin")).toEqual({ kind: "network" });
  });
});

describe("getMemberCount", () => {
  it("returns the length of the members array", async () => {
    const fetchMock = stubFetch(async () => reply(200, [user, { ...user, id: 2 }]));
    expect(await getMemberCount()).toBe(2);
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe("/api/members");
  });

  it("returns null for a non-array body", async () => {
    stubFetch(async () => reply(200, { members: [] }));
    expect(await getMemberCount()).toBeNull();
  });

  it("returns null on 403 for a plain member", async () => {
    stubFetch(async () => reply(403, { detail: "forbidden" }));
    expect(await getMemberCount()).toBeNull();
  });

  it("returns null when the request throws", async () => {
    stubFetch(async () => {
      throw new TypeError("network down");
    });
    expect(await getMemberCount()).toBeNull();
  });
});

describe("boards api", () => {
  const tile = { id: 7, name: "Office move", visibility: "workspace" };

  it("lists boards and sends the session cookie", async () => {
    const fetchMock = stubFetch(async () => reply(200, [tile]));
    expect(await getBoards()).toEqual({ kind: "ok", data: [tile] });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/boards");
    expect(init.credentials).toBe("same-origin");
  });

  it("reads the ownerless list and reports 403 as forbidden", async () => {
    const fetchMock = stubFetch(async () => reply(403, { detail: "forbidden" }));
    expect(await getOwnerless()).toEqual({ kind: "forbidden" });
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe("/api/boards/ownerless");
  });

  it("creates a board with a JSON body and accepts 201", async () => {
    const fetchMock = stubFetch(async () => reply(201, tile));
    expect(await createBoard("Office move", "private")).toEqual({ kind: "ok", data: tile });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/boards");
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"name":"Office move","visibility":"private"}');
  });

  it("patches a board with only the given fields", async () => {
    const fetchMock = stubFetch(async () => reply(200, tile));
    await patchBoard(7, { name: "New" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/boards/7");
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe('{"name":"New"}');
  });

  it("adds, re-roles and removes a board member", async () => {
    const fetchMock = stubFetch(async () => reply(200, {}));
    await addBoardMember(7, 3);
    await setBoardRole(7, 3, "owner");
    stubFetch(async () => new Response(null, { status: 204 }));
    expect(await removeBoardMember(7, 3)).toEqual({ kind: "ok", data: undefined });
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toBe("/api/boards/7/members");
    expect(calls[0][1].body).toBe('{"user_id":3}');
    expect(calls[1][0]).toBe("/api/boards/7/members/3");
    expect(calls[1][1].method).toBe("PATCH");
    expect(calls[1][1].body).toBe('{"role":"owner"}');
  });

  it("posts take-ownership", async () => {
    const fetchMock = stubFetch(async () => reply(200, tile));
    await takeOwnership(9);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/boards/9/take-ownership");
    expect(init.method).toBe("POST");
  });

  it.each([
    [401, { detail: "session_expired" }, "expired"],
    [403, { detail: "forbidden" }, "forbidden"],
    [404, { detail: "board_not_found" }, "not_found"],
    [404, { detail: "member_not_found" }, "member_not_found"],
    [409, { detail: "already_member" }, "already_member"],
    [409, { detail: "last_owner" }, "last_owner"],
    [409, { detail: "has_owner" }, "has_owner"],
    [409, { detail: "conflict" }, "conflict"],
    [409, { detail: "other" }, "server"],
    [422, { detail: [] }, "invalid"],
    [500, {}, "server"],
  ])("maps %s %j to %s", async (status, body, kind) => {
    stubFetch(async () => reply(status, body));
    expect(await getBoard(7)).toEqual({ kind });
  });

  it("reports a network problem when the request throws", async () => {
    throwing();
    expect(await getBoardMembers(7)).toEqual({ kind: "network" });
  });

  it("reports a server problem when a 200 has no body", async () => {
    stubFetch(async () => new Response("", { status: 200 }));
    expect(await getBoard(7)).toEqual({ kind: "server" });
  });
});

describe("lists api", () => {
  const list = { id: 4, name: "Doing" };

  function lastCall(fetchMock: ReturnType<typeof stubFetch>, n = 0) {
    return fetchMock.mock.calls[n] as unknown as [string, RequestInit];
  }

  it("reads the lists of a board", async () => {
    const fetchMock = stubFetch(async () => reply(200, [list]));
    expect(await getLists(7)).toEqual({ kind: "ok", data: [list] });
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe("/api/boards/7/lists");
    expect(init.method).toBe("GET");
  });

  it("creates a list and accepts 201", async () => {
    const fetchMock = stubFetch(async () => reply(201, list));
    expect(await createList(7, "Doing")).toEqual({ kind: "ok", data: list });
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe("/api/boards/7/lists");
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"name":"Doing"}');
  });

  it("renames a list with PATCH", async () => {
    const fetchMock = stubFetch(async () => reply(200, list));
    await renameList(7, 4, "Doing now");
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe("/api/boards/7/lists/4");
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe('{"name":"Doing now"}');
  });

  it("moves a list after an anchor, or to the front with null", async () => {
    const fetchMock = stubFetch(async () => reply(200, list));
    await moveList(7, 4, 2);
    await moveList(7, 4, null);
    const first = lastCall(fetchMock, 0);
    expect(first[0]).toBe("/api/boards/7/lists/4/move");
    expect(first[1].method).toBe("POST");
    expect(first[1].body).toBe('{"after_id":2}');
    expect(lastCall(fetchMock, 1)[1].body).toBe('{"after_id":null}');
  });

  it("archives and restores with POST and no body", async () => {
    const fetchMock = stubFetch(async () => reply(200, list));
    await archiveList(7, 4);
    expect(await restoreList(7, 4)).toEqual({ kind: "ok", data: list });
    const first = lastCall(fetchMock, 0);
    expect(first[0]).toBe("/api/boards/7/lists/4/archive");
    expect(first[1].method).toBe("POST");
    expect(first[1].body).toBeUndefined();
    const second = lastCall(fetchMock, 1);
    expect(second[0]).toBe("/api/boards/7/lists/4/restore");
    expect(second[1].method).toBe("POST");
  });

  it.each([
    [422, { detail: "list_limit" }, "list_limit"],
    [422, { detail: "card_limit" }, "card_limit"],
    [422, { detail: [{ loc: ["body", "name"] }] }, "invalid"],
    [422, { detail: "invalid_anchor" }, "invalid"],
    [404, { detail: "list_not_found" }, "list_not_found"],
    [404, { detail: "board_not_found" }, "not_found"],
    [409, { detail: "conflict" }, "conflict"],
    [403, { detail: "forbidden" }, "forbidden"],
    [401, { detail: "session_expired" }, "expired"],
    [500, {}, "server"],
  ])("maps %s %j to %s", async (status, body, kind) => {
    stubFetch(async () => reply(status, body));
    expect(await renameList(7, 4, "x")).toEqual({ kind });
  });

  it("maps a 422 card_limit on restoring a list to card_limit", async () => {
    stubFetch(async () => reply(422, { detail: "card_limit" }));
    expect(await restoreList(7, 4)).toEqual({ kind: "card_limit" });
  });

  it("reports a network problem when the request throws", async () => {
    throwing();
    expect(await getLists(7)).toEqual({ kind: "network" });
  });
});

describe("cards api", () => {
  const card = { id: 9, key: "TB-9", list_id: 4, title: "Pack boxes" };
  const move = { list_id: 4, after_id: null, from_list_id: 3, from_after_id: 8 };

  function lastCall(fetchMock: ReturnType<typeof stubFetch>, n = 0) {
    return fetchMock.mock.calls[n] as unknown as [string, RequestInit];
  }

  it("reads the cards of a board", async () => {
    const fetchMock = stubFetch(async () => reply(200, [card]));
    expect(await getCards(7)).toEqual({ kind: "ok", data: [card] });
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe("/api/boards/7/cards");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("same-origin");
  });

  it("creates a card and accepts 201", async () => {
    const fetchMock = stubFetch(async () => reply(201, card));
    expect(await createCard(7, 4, "Pack boxes")).toEqual({ kind: "ok", data: card });
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe("/api/boards/7/cards");
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"list_id":4,"title":"Pack boxes"}');
  });

  it("moves a card with all four fields, nulls included", async () => {
    const fetchMock = stubFetch(async () => reply(200, card));
    expect(await moveCard(7, 9, move)).toEqual({ kind: "ok", data: card });
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe("/api/boards/7/cards/9/move");
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"list_id":4,"after_id":null,"from_list_id":3,"from_after_id":8}');
  });

  it("maps 409 card_moved to the card, its place and who moved it", async () => {
    stubFetch(async () =>
      reply(409, { detail: "card_moved", card, after_id: 5, moved_by: "Duc Le" }),
    );
    expect(await moveCard(7, 9, move)).toEqual({
      kind: "card_moved",
      card,
      after_id: 5,
      moved_by: "Duc Le",
    });
  });

  it("keeps a null after_id and a null name on 409 card_moved", async () => {
    stubFetch(async () =>
      reply(409, { detail: "card_moved", card, after_id: null, moved_by: null }),
    );
    expect(await moveCard(7, 9, move)).toEqual({
      kind: "card_moved",
      card,
      after_id: null,
      moved_by: null,
    });
  });

  it("reports a 409 card_moved without a card as a server problem", async () => {
    stubFetch(async () => reply(409, { detail: "card_moved" }));
    expect(await moveCard(7, 9, move)).toEqual({ kind: "server" });
  });

  it("copies a card with POST and an empty JSON body", async () => {
    const copy = { id: 10, key: "TB-10", list_id: 4, title: "Pack boxes (copy)" };
    const fetchMock = stubFetch(async () => reply(201, copy));
    expect(await copyCard(7, 9)).toEqual({ kind: "ok", data: copy });
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe("/api/boards/7/cards/9/copy");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
  });

  it.each([
    [422, { detail: "card_limit" }, "card_limit"],
    [422, { detail: [{ loc: ["body", "title"] }] }, "invalid"],
    [422, { detail: "invalid_anchor" }, "invalid"],
    [404, { detail: "card_not_found" }, "card_not_found"],
    [404, { detail: "list_not_found" }, "list_not_found"],
    [404, { detail: "board_not_found" }, "not_found"],
    [409, { detail: "conflict" }, "conflict"],
    [403, { detail: "forbidden" }, "forbidden"],
    [401, { detail: "session_expired" }, "expired"],
    [500, {}, "server"],
  ])("maps %s %j to %s", async (status, body, kind) => {
    stubFetch(async () => reply(status, body));
    expect(await createCard(7, 4, "x")).toEqual({ kind });
    expect(await moveCard(7, 9, move)).toEqual({ kind });
    expect(await copyCard(7, 9)).toEqual({ kind });
    expect(await getCards(7)).toEqual({ kind });
  });

  it("reports a network problem when the request throws", async () => {
    throwing();
    expect(await getCards(7)).toEqual({ kind: "network" });
    expect(await moveCard(7, 9, move)).toEqual({ kind: "network" });
  });
});

describe("signOut", () => {
  it("posts to /auth/logout with the session cookie", async () => {
    const fetchMock = stubFetch(async () => new Response(null, { status: 204 }));
    await signOut();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/auth/logout");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
  });

  it("resolves when the server fails or cannot be reached", async () => {
    stubFetch(async () => reply(500, { detail: "boom" }));
    await expect(signOut()).resolves.toBeUndefined();
    stubFetch(async () => {
      throw new TypeError("offline");
    });
    await expect(signOut()).resolves.toBeUndefined();
  });
});
