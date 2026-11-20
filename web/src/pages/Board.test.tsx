import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { BoardDetail } from "../api";
import { BoardView } from "./Board";

const ann = { id: 1, name: "Ann Lee", email: "ann@example.com", avatar_url: null };

const board = (over: Partial<BoardDetail> = {}): BoardDetail => ({
  id: 7,
  name: "Office move",
  visibility: "workspace",
  my_role: "owner",
  member_count: 1,
  members: [ann],
  updated_at: "2026-11-20T09:00:00Z",
  created_at: "2026-11-01T09:00:00Z",
  ...over,
});

type Props = Parameters<typeof BoardView>[0];

function render(over: Partial<Props> = {}) {
  const props: Props = { state: "ready", board: board(), ...over };
  const html = renderToString(<BoardView {...props} />);
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return { html, text };
}

describe("BoardView header", () => {
  it("shows the name, the Workspace chip and your role", () => {
    const { html, text } = render();
    expect(html).toMatch(/<h1[^>]*>Office move<\/h1>/);
    expect(text).toContain("Workspace");
    expect(html).toContain('<span class="chip accent">You: Owner</span>');
  });

  it("shows the Private chip for a Private board", () => {
    const { text } = render({ board: board({ visibility: "private" }) });
    expect(text).toContain("Private");
    expect(text).not.toContain("Workspace");
  });

  it.each([
    ["member", "You: Member"],
    ["observer", "You: Observer"],
  ] as const)("shows %s as %s", (my_role, label) => {
    expect(render({ board: board({ my_role }) }).text).toContain(label);
  });

  it("shows the people on the board and a +N chip for the rest", () => {
    const four = [1, 2, 3, 4].map((id) => ({ ...ann, id }));
    const { html } = render({ board: board({ members: four, member_count: 6 }) });
    expect(html).toContain("+2");
    expect(html).toContain('title="6 people on this board"');
  });

  it("links to the settings sheet: Settings and members for owners", () => {
    const { html } = render();
    expect(html).toMatch(/<a[^>]*href="\/boards\/7\/settings"[^>]*>[\s\S]*Settings and members<\/a>/);
  });

  it.each(["member", "observer"] as const)("calls it Board info for a %s", (my_role) => {
    const { html, text } = render({ board: board({ my_role }) });
    expect(text).toContain("Board info");
    expect(text).not.toContain("Settings and members");
    expect(html).toContain('href="/boards/7/settings"');
  });

  it("has no Archived button yet", () => {
    expect(render().text).not.toContain("Archived");
  });
});

describe("BoardView observer banner", () => {
  it("tells observers they can look but not change", () => {
    const { html, text } = render({ board: board({ my_role: "observer" }) });
    expect(html).toContain('class="banner"');
    expect(text).toContain(
      "You can view this board but not change it. Ask a board owner for member access.",
    );
  });

  it("is not shown to owners or members", () => {
    expect(render().text).not.toContain("You can view this board");
    expect(render({ board: board({ my_role: "member" }) }).text).not.toContain(
      "You can view this board",
    );
  });
});

describe("BoardView empty board", () => {
  it("says there are no lists yet, with the button disabled until lists exist", () => {
    const { html, text } = render();
    expect(text).toContain("This board has no lists yet");
    expect(text).toContain(
      "Lists are the columns cards move through, for example To do, Doing and Done.",
    );
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*Add To do, Doing, Done<\/button>/);
  });

  it("asks observers to find a member instead of showing the button", () => {
    const { html, text } = render({ board: board({ my_role: "observer" }) });
    expect(text).toContain("Ask a board member to add the first lists.");
    expect(html).not.toContain("Add To do, Doing, Done");
  });
});

describe("BoardView other states", () => {
  it("shows a skeleton while loading", () => {
    const { html } = render({ state: "loading", board: null });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('class="skel"');
  });

  it("says This board isn't here on a 404", () => {
    const { html, text } = render({ state: "gone", board: null });
    expect(text).toContain("This board isn't here");
    expect(text).toContain(
      "It may have been archived, or you may not have access to it. Boards you can open are on the boards list.",
    );
    expect(html).toMatch(/<a[^>]*href="\/boards"[^>]*>Back to boards<\/a>/);
  });

  it("shows the load error with Try again", () => {
    const { html, text } = render({ state: "server", board: null });
    expect(text).toContain("Couldn't load this board");
    expect(html).toMatch(/<button[^>]*>Try again<\/button>/);
    expect(render({ state: "network", board: null }).text).toContain("Can't reach Taskboard");
  });

  it("renders the settings slot and the toast after the board", () => {
    const { html } = render({ settings: <aside id="slot">sheet</aside>, message: "Saved" });
    expect(html.indexOf("Office move")).toBeLessThan(html.indexOf('id="slot"'));
    expect(html).toContain('<div class="toast" role="status"><span>Saved</span></div>');
  });
});
