import { describe, expect, it, vi } from "vitest";

import { menuAfter, signOutAndLeave } from "./signOut";

describe("menuAfter", () => {
  it("toggles open and closed from the avatar button", () => {
    expect(menuAfter(false, "toggle")).toBe(true);
    expect(menuAfter(true, "toggle")).toBe(false);
  });

  it.each(["escape", "outside", "choose"] as const)("closes on %s", (event) => {
    expect(menuAfter(true, event)).toBe(false);
    expect(menuAfter(false, event)).toBe(false);
  });
});

describe("signOutAndLeave", () => {
  it("signs out, then goes to the Sign in page", async () => {
    const order: string[] = [];
    const post = vi.fn(async () => {
      order.push("post");
    });
    const go = vi.fn((path: string) => {
      order.push(`go ${path}`);
    });

    await signOutAndLeave(post, go);

    expect(order).toEqual(["post", "go /signin"]);
  });

  it("still goes to Sign in when the sign-out call fails", async () => {
    const go = vi.fn();

    await signOutAndLeave(async () => {
      throw new Error("offline");
    }, go);

    expect(go).toHaveBeenCalledWith("/signin");
  });
});
