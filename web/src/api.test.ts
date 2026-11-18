import { afterEach, describe, expect, it, vi } from "vitest";

import { getConfig, getMe, getMemberCount } from "./api";

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
