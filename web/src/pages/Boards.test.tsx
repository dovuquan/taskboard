import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Boards } from "./Boards";

function render(memberCount: number | null, domain: string | null = "example.com") {
  const html = renderToString(<Boards domain={domain} memberCount={memberCount} />);
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
  return { html, text };
}

function disabledButtons(html: string): string[] {
  return (html.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? []).filter((b) =>
    /\sdisabled(=|\s|>)/.test(b),
  );
}

describe("Boards", () => {
  it("shows the heading and the workspace subtitle", () => {
    const { text } = render(2);
    expect(text).toContain("Boards");
    expect(text).toContain("example.com workspace");
  });

  it("shows the welcome variant when you are the only member", () => {
    const { text } = render(1);
    expect(text).toContain("Welcome to Taskboard");
    expect(text).toContain(
      "You're the first one here. Create a board for a project or team; colleagues join the workspace the first time they sign in with their example.com account.",
    );
    expect(text).toContain("Create the first board");
    expect(text).not.toContain("No boards yet");
  });

  it.each([2, null])("shows the empty variant for member count %s", (count) => {
    const { text } = render(count);
    expect(text).toContain("No boards yet");
    expect(text).toContain(
      'A board holds lists of cards for one project or team. Create the first one, for example "Q4 Launch".',
    );
    expect(text).not.toContain("Welcome to Taskboard");
    expect(text).not.toContain("Create the first board");
  });

  it("disables every create button with the M2 hint", () => {
    const solo = disabledButtons(render(1).html);
    expect(solo).toHaveLength(2);
    for (const b of solo) expect(b).toContain('title="Arrives with M2"');
    expect(solo.some((b) => b.includes("Create the first board"))).toBe(true);
    expect(solo.some((b) => b.includes("New board"))).toBe(true);

    const empty = disabledButtons(render(2).html);
    expect(empty).toHaveLength(2);
    for (const b of empty) {
      expect(b).toContain('title="Arrives with M2"');
      expect(b).toContain("New board");
    }
  });

  it("leaves no enabled button on the page", () => {
    const html = render(1).html;
    const all = html.match(/<button[^>]*>/g) ?? [];
    expect(all.length).toBeGreaterThan(0);
    expect(disabledButtons(html)).toHaveLength(all.length);
  });

  it("drops the domain when it is unknown", () => {
    const { text } = render(1, null);
    expect(text).not.toContain("null");
    expect(text).not.toContain("example.com");
  });
});
