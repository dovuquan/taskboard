import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Refused } from "./Refused";

function render(reason: string | null, domain: string | null = "example.com") {
  const html = renderToString(<Refused domain={domain} reason={reason} />);
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
  return { html, text };
}

describe("Refused", () => {
  it("shows the heading and the domain rule", () => {
    const { text } = render("wrong_domain");
    expect(text).toContain("We couldn't sign you in");
    expect(text).toContain(
      "Taskboard accepts verified Google Workspace accounts on example.com only.",
    );
  });

  it("uses grammatical sentences when the domain is unknown", () => {
    const { text } = render("wrong_domain", null);
    expect(text).toContain(
      "Taskboard accepts verified Google Workspace accounts on your organisation's domain only.",
    );
    expect(text).toContain(
      "If you use your organisation's account and still see this, ask a workspace admin to check it. This attempt was recorded.",
    );
    expect(text).not.toContain("null");
  });

  it("shows the reason with a lower-cased first letter", () => {
    const { text } = render("wrong_domain");
    expect(text).toContain("Reason: not an example.com Workspace account");
    const other = render("expired_token").text;
    expect(other).toContain("Reason: the sign-in took too long");
  });

  it("links Try another account to the sign-in page", () => {
    const { html } = render("wrong_domain");
    expect(html).toMatch(/<a[^>]*href="\/signin"[^>]*>[\s\S]*Try another account[\s\S]*<\/a>/);
  });

  it("shows the fine print and no attempted-email line", () => {
    const { text } = render("wrong_domain");
    expect(text).toContain(
      "If you use an example.com account and still see this, ask a workspace admin to check it. This attempt was recorded.",
    );
    expect(text).not.toContain("You tried");
  });

  it("renders the fallback for a hostile reason and never echoes it", () => {
    const hostile = "<script>alert(1)</script>";
    const { html, text } = render(hostile);
    expect(text).toContain("Reason: the sign-in did not go through");
    expect(html).not.toContain(hostile);
    expect(html).not.toContain("<script");
  });

  it("falls back when there is no reason", () => {
    expect(render(null).text).toContain("Reason: the sign-in did not go through");
  });
});
