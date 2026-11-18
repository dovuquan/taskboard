import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Refused } from "./Refused";

function render(reason: string | null, domain: string | null = "example.com") {
  const html = renderToString(<Refused domain={domain} reason={reason} />);
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return { html, text };
}

const FINE_TAIL = "ask a workspace admin to check it. This attempt was recorded.";

describe("Refused", () => {
  it("has exactly this text with a domain", () => {
    expect(render("wrong_domain").text).toBe(
      "We couldn't sign you in Taskboard accepts verified Google Workspace accounts on example.com only. " +
        "Reason: not an example.com Workspace account " +
        "Try another account " +
        `If you use an example.com account and still see this, ${FINE_TAIL}`,
    );
  });

  it("has exactly this text without a domain", () => {
    expect(render("wrong_domain", null).text).toBe(
      "We couldn't sign you in Taskboard accepts verified Google Workspace accounts on your organisation's domain only. " +
        "Reason: not a Workspace account of the allowed domain " +
        "Try another account " +
        `If you use your organisation's account and still see this, ${FINE_TAIL}`,
    );
  });

  it("has exactly this text for a hostile reason", () => {
    expect(render("<script>alert(1)</script>").text).toBe(
      "We couldn't sign you in Taskboard accepts verified Google Workspace accounts on example.com only. " +
        "Reason: the sign-in did not go through " +
        "Try another account " +
        `If you use an example.com account and still see this, ${FINE_TAIL}`,
    );
  });

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
