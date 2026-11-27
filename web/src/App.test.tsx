import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppView } from "./App";

const user = {
  id: 1,
  email: "ann@example.com",
  name: "Ann Lee",
  avatar_url: null,
  role: "admin",
} as const;

function view(screen: Parameters<typeof AppView>[0]["screen"], signedIn = false) {
  const html = renderToString(
    <AppView
      screen={screen}
      domain="example.com"
      reason="wrong_domain"
      user={signedIn ? user : null}
      memberCount={2}
    />,
  );
  const text = (s: string) =>
    s
      .replace(/<[^>]*>/g, " ")
      .replace(/&#x27;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? null;
  const h2 = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1] ?? null;
  return { html, text, h1: h1 && text(h1), h2: h2 && text(h2) };
}

describe("AppView", () => {
  it("renders the sign-in screen inside main", () => {
    const { html, h1 } = view("signin");
    expect(h1).toBe("Sign in");
    expect(html).toMatch(/^<main id="screen">[\s\S]*<\/main>$/);
  });

  it("renders the refused screen", () => {
    const { h1, html } = view("refused");
    expect(h1).toBe("We couldn't sign you in");
    expect(html).toMatch(/^<main id="screen">/);
  });

  it("renders the expired screen", () => {
    const { h1, html } = view("expired");
    expect(h1).toBe("Your session has ended");
    expect(html).toMatch(/^<main id="screen">/);
  });

  it("renders the boards screen with the app bar outside main", () => {
    const { html, h1, text } = view("boards", true);
    expect(h1).toBe("Boards");
    expect(html).toMatch(/^<header class="appbar gutter">[\s\S]*<\/header><main id="screen">/);
    const bar = html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
    expect(text(bar)).toBe("Taskboard / Boards Boards Members AL Ann Lee Workspace admin");
  });

  it("renders the board screen with the app bar and a skeleton while it loads", () => {
    const html = renderToString(
      <AppView
        screen="board"
        domain="example.com"
        reason={null}
        user={user}
        memberCount={2}
        boardId={7}
        boardName="Office move"
      />,
    );
    const bar = html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
    expect(bar).toContain("<span>Office move</span>");
    expect(html.indexOf("<header")).toBeLessThan(html.indexOf("<main"));
    expect(html).toContain('aria-busy="true"');
  });

  it("renders the members screen with the app bar outside main", () => {
    const { html, h1, text } = view("members", true);
    expect(h1).toBe("Workspace members");
    expect(html).toMatch(/^<header class="appbar gutter">[\s\S]*<\/header><main id="screen">/);
    const bar = html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
    expect(text(bar)).toBe("Taskboard / Members Boards Members AL Ann Lee Workspace admin");
    expect(html).toContain('<a class="navlink on" href="/members">Members</a>');
    expect(html.match(/<header/g)).toHaveLength(1);
    expect(html.indexOf("<header")).toBeLessThan(html.indexOf("<main"));
    expect(html.indexOf("Workspace members")).toBeGreaterThan(html.indexOf("<main"));
  });

  it("renders the error screen with a retry button", () => {
    const { html, h2, text } = view("error");
    expect(h2).toBe("Can't reach Taskboard");
    expect(text(html.match(/<p>[\s\S]*?<\/p>/)?.[0] ?? "")).toBe(
      "This page could not be loaded because Taskboard isn't answering. Check your connection, or ask an admin whether the server is running.",
    );
    expect(html).toMatch(/<button class="btn" type="button">Try again<\/button>/);
    expect(html).toMatch(/^<main id="screen">/);
  });
});
