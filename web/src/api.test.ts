import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getConfig,
  getMe,
  getMemberCount,
  getMembers,
  getRefused,
  setMemberRole,
  signOut,
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
