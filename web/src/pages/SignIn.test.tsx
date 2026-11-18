import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SignIn } from "./SignIn";

function render(domain: string | null) {
  const html = renderToString(<SignIn domain={domain} />);
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return { html, text };
}

const FIRST_TIME =
  "First time here? You join the workspace as a member the first time you sign in. Personal Gmail accounts are not accepted.";

describe("SignIn", () => {
  it("has exactly this text with a domain", () => {
    expect(render("example.com").text).toBe(
      `Taskboard Sign in Use your example.com Google Workspace account. Continue with Google ${FIRST_TIME}`,
    );
  });

  it("has exactly this text without a domain", () => {
    expect(render(null).text).toBe(
      `Taskboard Sign in Use your Google Workspace account. Continue with Google ${FIRST_TIME}`,
    );
  });

  it("shows the heading and the domain line", () => {
    const { text } = render("example.com");
    expect(text).toContain("Sign in");
    expect(text).toContain("Use your example.com Google Workspace account.");
  });

  it("drops the domain when it is unknown", () => {
    const { text } = render(null);
    expect(text).toContain("Use your Google Workspace account.");
    expect(text).not.toContain("null");
  });

  it("links Continue with Google to the login route", () => {
    const { html } = render("example.com");
    expect(html).toMatch(/<a[^>]*href="\/auth\/login"[^>]*>[\s\S]*Continue with Google[\s\S]*<\/a>/);
  });

  it("explains first-time sign-in", () => {
    const { text } = render("example.com");
    expect(text).toContain(
      "First time here? You join the workspace as a member the first time you sign in. Personal Gmail accounts are not accepted.",
    );
  });

  it("never shows the gated banner", () => {
    expect(render("example.com").text).not.toContain("Sign in to open that page");
  });
});
