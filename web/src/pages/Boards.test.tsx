import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Tile } from "../api";
import { BoardsView } from "./Boards";

const NOW = new Date("2026-11-20T12:00:00Z");

const ann = { id: 1, name: "Ann Lee", email: "ann@example.com", avatar_url: null };
const bob = { id: 2, name: "Bob Tran", email: "bob@example.com", avatar_url: null };

const tile = (over: Partial<Tile> = {}): Tile => ({
  id: 7,
  name: "Office move",
  visibility: "workspace",
  my_role: "member",
  member_count: 2,
  members: [ann, bob],
  updated_at: "2026-11-20T09:00:00Z",
  ...over,
});

type Props = Parameters<typeof BoardsView>[0];

function render(over: Partial<Props> = {}) {
  const props: Props = {
    state: "ready",
    tiles: [],
    ownerless: [],
    admin: false,
    domain: "example.com",
    memberCount: 2,
    now: NOW,
    form: { open: false, name: "", priv: false, saving: false },
    message: null,
    ...over,
  };
  const html = renderToString(<BoardsView {...props} />);
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return { html, text };
}

describe("BoardsView empty variants", () => {
  it("has exactly this text for the welcome variant", () => {
    expect(render({ memberCount: 1 }).text).toBe(
      "Boards example.com workspace New board " +
        "Welcome to Taskboard " +
        "You're the first one here. Create a board for a project or team; colleagues join the workspace the first time they sign in with their example.com account. " +
        "Create the first board",
    );
  });

  it("has exactly this text for the empty variant", () => {
    expect(render({ memberCount: 2 }).text).toBe(
      "Boards example.com workspace New board " +
        "No boards yet " +
        'A board holds lists of cards for one project or team. Create the first one, for example "Q4 Launch". ' +
        "New board",
    );
  });

  it.each([2, null])("shows the empty variant for member count %s", (memberCount) => {
    const { text } = render({ memberCount });
    expect(text).toContain("No boards yet");
    expect(text).not.toContain("Welcome to Taskboard");
  });

  it("enables the create buttons and drops the M2 hint", () => {
    const { html, text } = render({ memberCount: 1 });
    expect(html).not.toContain("disabled");
    expect(text).not.toContain("Arrives with M2");
    expect(html).not.toContain("Arrives with M2");
  });

  it("drops the domain when it is unknown", () => {
    const { text } = render({ memberCount: 1, domain: null });
    expect(text).not.toContain("null");
    expect(text).toContain("with their Workspace account");
  });
});

describe("BoardsView loading and errors", () => {
  it("shows the heading and four skeleton tiles while loading", () => {
    const { html, text } = render({ state: "loading" });
    expect(text).toContain("Boards example.com workspace");
    expect(html).toContain('aria-busy="true"');
    expect(html.match(/class="skel"/g)).toHaveLength(4);
    expect(text).not.toContain("No boards yet");
  });

  it("shows the server error state with Try again", () => {
    const { html, text } = render({ state: "server" });
    expect(text).toContain("Couldn't load boards");
    expect(html).toMatch(/<button[^>]*>Try again<\/button>/);
  });

  it("shows the network error state", () => {
    const { text } = render({ state: "network" });
    expect(text).toContain("Can't reach Taskboard");
    expect(text).toContain("The boards could not be loaded");
  });
});

describe("BoardsView tiles", () => {
  it("links each tile to its board with name, member count and updated time", () => {
    const { html, text } = render({ tiles: [tile()] });
    expect(html).toMatch(/<a[^>]*class="board-tile"[^>]*href="\/boards\/7"/);
    expect(text).toContain("Office move");
    expect(text).toContain("2 members · Updated 3h ago");
  });

  it("colours the square from the board id", () => {
    const { html } = render({ tiles: [tile({ id: 1 })] });
    expect(html).toMatch(/class="sq" style="background:var\(--l-[a-z]+\)"/);
  });

  it("shows a lock only on Private boards", () => {
    const priv = render({ tiles: [tile({ visibility: "private" })] }).html;
    expect(priv).toContain('title="Private board"');
    const open = render({ tiles: [tile()] }).html;
    expect(open).not.toContain("Private board");
  });

  it.each([
    ["owner", "Owner"],
    ["member", "Member"],
    ["observer", "Observer"],
  ] as const)("shows the %s role chip", (role, label) => {
    expect(render({ tiles: [tile({ my_role: role })] }).html).toContain(
      `<span class="chip">${label}</span>`,
    );
  });

  it("shows an avatar stack with the board's people", () => {
    const { html } = render({ tiles: [tile()] });
    expect(html).toMatch(/<span class="stack">[\s\S]*>AL<[\s\S]*>BT<[\s\S]*<\/span>/);
  });

  it("adds a +N chip when more people are on the board than shown", () => {
    const four = [1, 2, 3, 4].map((id) => ({ ...ann, id }));
    const { html } = render({ tiles: [tile({ member_count: 7, members: four })] });
    expect(html).toContain("+3");
  });

  it("keeps the page head button and the New board tile", () => {
    const { html } = render({ tiles: [tile()] });
    expect(html.match(/New board/g)).toHaveLength(2);
    expect(html).toContain('class="board-tile new-tile"');
    expect(html).not.toContain("No boards yet");
  });
});

describe("BoardsView new board form", () => {
  const open = { open: true, name: "Q4 Launch", priv: false, saving: false };

  it("shows the inline form instead of the New board tile", () => {
    const { html, text } = render({ tiles: [tile()], form: open });
    expect(html).toContain('class="board-tile new-form"');
    expect(html).not.toContain("new-tile");
    expect(html).toMatch(/<input[^>]*maxLength="80"|<input[^>]*maxlength="80"/);
    expect(html).toContain('value="Q4 Launch"');
    expect(text).toContain("Private: only people you add can see it");
    expect(html).toMatch(/<input[^>]*type="checkbox"/);
    expect(text).toContain("Create Cancel");
  });

  it("checks the Private box when chosen", () => {
    const { html } = render({ tiles: [tile()], form: { ...open, priv: true } });
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
  });

  it("disables Create while the server is answering or the name is blank", () => {
    const saving = render({ tiles: [tile()], form: { ...open, saving: true } }).html;
    expect(saving).toMatch(/<button[^>]*disabled[^>]*>Create<\/button>/);
    const blank = render({ tiles: [tile()], form: { ...open, name: "  " } }).html;
    expect(blank).toMatch(/<button[^>]*disabled[^>]*>Create<\/button>/);
  });

  it("shows the form even before the first board exists", () => {
    const { html, text } = render({ form: open });
    expect(html).toContain("new-form");
    expect(text).not.toContain("No boards yet");
  });
});

describe("BoardsView boards without an owner", () => {
  const orphan = tile({ id: 9, name: "Old project", visibility: "private", my_role: null });

  it("lists them with Take ownership for admins", () => {
    const { html, text } = render({ admin: true, ownerless: [orphan], tiles: [tile()] });
    expect(text).toContain("Boards without an owner");
    expect(text).toContain(
      "Private boards whose owners have all left. Only admins see this list.",
    );
    expect(text).toContain("Old project");
    expect(html).toMatch(/<button[^>]*>Take ownership<\/button>/);
  });

  it("is hidden from non-admins and when the list is empty", () => {
    expect(render({ admin: false, ownerless: [orphan], tiles: [tile()] }).text).not.toContain(
      "Boards without an owner",
    );
    expect(render({ admin: true, ownerless: [], tiles: [tile()] }).text).not.toContain(
      "Boards without an owner",
    );
  });
});

describe("BoardsView archived boards", () => {
  const old = { ...tile({ id: 9, name: "Old project" }), archived_at: "2026-11-20T11:59:30Z" };
  const older = { ...tile({ id: 10, name: "Older project" }), archived_at: "2026-11-20T10:00:00Z" };

  it("lists them with when they were archived and a Restore button", () => {
    const { html, text } = render({ archived: [old, older], tiles: [tile()] });
    expect(text).toContain("Archived boards");
    expect(text).toContain("Old project Archived just now · its lists and cards are kept");
    expect(text).toContain("Older project Archived 2h ago · its lists and cards are kept");
    expect((html.match(/>Restore<\/button>/g) ?? []).length).toBe(2);
  });

  it("is hidden when nothing is archived", () => {
    expect(render({ archived: [], tiles: [tile()] }).text).not.toContain("Archived boards");
    expect(render({ tiles: [tile()] }).text).not.toContain("Archived boards");
  });

  it("is hidden while the boards are loading or failed to load", () => {
    expect(render({ state: "loading", archived: [old] }).text).not.toContain("Archived boards");
    expect(render({ state: "server", archived: [old] }).text).not.toContain("Archived boards");
  });

  it("disables Restore while a restore is out", () => {
    const { html } = render({ archived: [old], tiles: [tile()], busy: true });
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Restore<\/button>/);
  });

  it("does not list an archived board among the tiles", () => {
    const { html } = render({ archived: [old], tiles: [tile()] });
    expect(html).not.toContain('href="/boards/9"');
  });
});

describe("BoardsView toast", () => {
  it("shows the message as a status", () => {
    const { html } = render({ tiles: [tile()], message: "Created Q4 Launch" });
    expect(html).toContain('<div class="toast" role="status"><span>Created Q4 Launch</span></div>');
  });
});
