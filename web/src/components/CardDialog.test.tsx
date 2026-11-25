import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { BoardMember, BoardRole, Card, Label } from "../api";
import { CardDialogView } from "./CardDialog";

const person = (id: number, role: BoardRole = "member", name = `Person ${id}`): BoardMember => ({
  id,
  name,
  email: `p${id}@example.com`,
  avatar_url: null,
  role,
  added_at: "2026-11-01T09:00:00Z",
  pending: false,
});

const labels: Label[] = [
  { id: 1, name: "Launch", color: "launch" },
  { id: 2, name: "Bug", color: "bug" },
  { id: 3, name: "Docs", color: "docs" },
  { id: 4, name: "Ops", color: "ops" },
  { id: 5, name: "Marketing", color: "marketing" },
  { id: 6, name: "Research", color: "research" },
  { id: 7, name: "Design", color: "design" },
];

const lists = [
  { id: 11, name: "To do" },
  { id: 12, name: "Doing" },
  { id: 13, name: "Done" },
];

const tile = (over: Partial<Card> = {}): Card => ({
  id: 3,
  key: "TB-3",
  list_id: 11,
  title: "Pack boxes",
  label_ids: [],
  member_ids: [],
  due_on: null,
  has_description: false,
  ...over,
});

type Props = Parameters<typeof CardDialogView>[0];

function render(over: Partial<Props> = {}, role: BoardRole = "owner") {
  const props: Props = {
    board: { name: "Office move", my_role: role },
    tile: tile(),
    lists,
    labels,
    people: [person(1, "owner", "Ann Lee"), person(2, "member", "Bo Tran"), person(3, "observer", "Cy Ng")],
    total: 4,
    detail: { state: "ready", description: null },
    ...over,
  };
  const html = renderToString(<CardDialogView {...props} />);
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return { html, text };
}

const items = (html: string) =>
  [...html.matchAll(/role="menuitem"[^>]*>([\s\S]*?)<\/button>/g)].map((m) =>
    m[1].replace(/<[^>]*>/g, "").trim(),
  );

describe("CardDialogView frame", () => {
  it("is a labelled modal dialog that can take focus", () => {
    const { html } = render();
    expect(html).toMatch(/<div[^>]*role="dialog"[^>]*>/);
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="card-title"');
    expect(html).toContain('id="card-title"');
    expect(html).toMatch(/<div[^>]*role="dialog"[^>]*tabindex="-1"|<div[^>]*tabindex="-1"[^>]*role="dialog"/);
  });

  it("says where the card is", () => {
    const { text } = render();
    expect(text).toContain("TB-3 · in list To do on Office move");
  });

  it("has a close button", () => {
    expect(render().html).toContain('aria-label="Close (Esc)"');
  });

  it("shows a stale note when the card left the board but a draft keeps the dialog", () => {
    const { text } = render({ ui: { stale: true, draft: "my words" } });
    expect(text).toContain("This card is no longer on the board.");
  });
});

describe.each(["owner", "member"] as const)("CardDialogView for a board %s", (role) => {
  it("gives the title as a growing textarea with the limit", () => {
    const { html } = render({}, role);
    expect(html).toMatch(/<textarea[^>]*id="card-title"/);
    expect(html).toContain('maxLength="200"');
    expect(html).toContain('aria-label="Card title"');
    expect(html).toContain(">Pack boxes</textarea>");
    expect(html).not.toMatch(/<h2[^>]*id="card-title"/);
  });

  it("shows the change buttons, the date input and the description prompt", () => {
    const { html, text } = render({}, role);
    expect(html).toContain('aria-label="Change members"');
    expect(html).toContain('aria-label="Change labels"');
    expect(html).toMatch(/<input[^>]*type="date"[^>]*aria-label="Due date"|<input[^>]*aria-label="Due date"[^>]*type="date"/);
    expect(text).toContain("Nobody yet");
    expect(text).toContain("None");
    expect(text).toContain("Add a description. Markdown is supported.");
  });

  it("offers Move to, Copy card and Copy link in the menu", () => {
    const { html, text } = render({ ui: { pop: "menu" } }, role);
    expect(html).toContain('role="menu"');
    expect(text).toContain("Move to");
    expect(items(html)).toEqual(["Doing", "Done", "Copy card", "Copy link"]);
  });

  it("hides Copy card at 1,000 cards", () => {
    const { html } = render({ ui: { pop: "menu" }, total: 1000 }, role);
    expect(items(html)).toEqual(["Doing", "Done", "Copy link"]);
    const at999 = render({ ui: { pop: "menu" }, total: 999 }, role);
    expect(items(at999.html)).toContain("Copy card");
  });

  it("has no Archive card item (it arrives later)", () => {
    expect(render({ ui: { pop: "menu" } }, role).text).not.toContain("Archive card");
  });

  it("shows a Clear button once a due date is set", () => {
    expect(render({}, role).html).not.toMatch(/>Clear<\/button>/);
    const { html } = render({ tile: tile({ due_on: "2026-12-01" }) }, role);
    expect(html).toMatch(/>Clear<\/button>/);
    expect(html).toContain('value="2026-12-01"');
  });

  it("offers Edit on a description that exists", () => {
    const { html, text } = render(
      { tile: tile({ has_description: true }), detail: { state: "ready", description: "Hello **there**" } },
      role,
    );
    expect(html).toMatch(/>Edit<\/button>/);
    expect(html).toContain("<strong>there</strong>");
    expect(text).not.toContain("Add a description");
  });
});

describe("CardDialogView for an observer", () => {
  const observer = (over: Partial<Props> = {}) => render(over, "observer");

  it("shows the title as plain text", () => {
    const { html } = observer();
    expect(html).toMatch(/<h2[^>]*id="card-title"[^>]*>Pack boxes<\/h2>/);
    expect(html).not.toContain("<textarea");
  });

  it("shows no way to change anything", () => {
    const { html, text } = observer({
      tile: tile({ due_on: "2026-12-01", label_ids: [1], member_ids: [1] }),
      detail: { state: "ready", description: "Some text" },
    });
    expect(html).not.toContain('aria-label="Change members"');
    expect(html).not.toContain('aria-label="Change labels"');
    expect(html).not.toContain('type="date"');
    expect(html).not.toMatch(/>Clear<\/button>/);
    expect(html).not.toMatch(/>Edit<\/button>/);
    expect(html).not.toContain("<input");
    expect(text).toContain("1 Dec");
    expect(text).toContain("Launch");
    expect(text).toContain("Some text");
  });

  it("says when there is no description", () => {
    const { text } = observer();
    expect(text).toContain("No description.");
    expect(text).not.toContain("Add a description");
  });

  it("offers Copy link only in the menu", () => {
    const { html, text } = observer({ ui: { pop: "menu" } });
    expect(items(html)).toEqual(["Copy link"]);
    expect(text).not.toContain("Move to");
    expect(text).not.toContain("Copy card");
  });

  it("ignores a popup or an edit state it should never have", () => {
    const { html } = observer({ ui: { pop: "members", draft: "x" } });
    expect(html).not.toContain("Board members");
    expect(html).not.toContain("<textarea");
  });
});

describe("CardDialogView labels and members on the card", () => {
  it("shows the card's labels with their names and colours", () => {
    const { html } = render({ tile: tile({ label_ids: [2, 1] }) });
    expect(html).toContain('class="lbl"');
    expect(html).toContain("--c:var(--l-bug)");
    expect(html).toContain("--c:var(--l-launch)");
    expect(html.indexOf("Bug")).toBeLessThan(html.indexOf("Launch"));
  });

  it("skips a label id it does not know", () => {
    const { html } = render({ tile: tile({ label_ids: [99] }) });
    expect(html).not.toContain('class="lbl"');
  });

  it("shows the assigned people as avatars with their names", () => {
    const { html } = render({ tile: tile({ member_ids: [1, 2] }) });
    expect(html).toContain('title="Ann Lee"');
    expect(html).toContain('title="Bo Tran"');
    expect(html).not.toContain("Nobody yet");
  });

  it("keeps an assignee who is not on the board list, shown as unknown", () => {
    const { html } = render({ tile: tile({ member_ids: [42] }) });
    expect(html).toContain('title="Unknown person"');
  });
});

describe("CardDialogView members picker", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => person(i + 1, "member", `Person ${i + 1}`));

  it("lists owners and members and leaves observers out", () => {
    const { html, text } = render({ ui: { pop: "members" } });
    expect(text).toContain("Board members");
    expect(html).toContain("Ann Lee");
    expect(html).toContain("Bo Tran");
    expect(html).not.toContain("Cy Ng");
    expect(text).toContain("Observers can't be assigned.");
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(2);
  });

  it("checks the people already on the card", () => {
    const { html } = render({ tile: tile({ member_ids: [2] }), ui: { pop: "members" } });
    const boxes = [...html.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)].map((m) => m[0]);
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).not.toContain("checked");
    expect(boxes[1]).toContain("checked");
  });

  it("has no search box for 8 people", () => {
    const { html } = render({ people: many(8), ui: { pop: "members" } });
    expect(html).not.toContain('aria-label="Find a board member"');
  });

  it("has a search box for 9 people", () => {
    const { html } = render({ people: many(9), ui: { pop: "members" } });
    expect(html).toContain('aria-label="Find a board member"');
    expect(html).toContain('placeholder="Find a person"');
  });

  it("counts only people who can be assigned toward the search box", () => {
    const people = [...many(8), person(50, "observer", "Watcher One"), person(51, "observer", "Watcher Two")];
    const { html } = render({ people, ui: { pop: "members" } });
    expect(html).not.toContain('aria-label="Find a board member"');
    expect(html).not.toContain("Watcher");
  });

  it("filters by the query and says when nobody matches", () => {
    const people = many(9);
    const hit = render({ people, ui: { pop: "members", memberQuery: "person 7" } });
    expect((hit.html.match(/type="checkbox"/g) ?? []).length).toBe(1);
    expect(hit.html).toContain("Person 7");
    const miss = render({ people, ui: { pop: "members", memberQuery: "zzz" } });
    expect(miss.text).toContain("Nobody on this board matches.");
  });

  it("does not open when another popup is open", () => {
    const { html } = render({ ui: { pop: "labels" } });
    expect(html).not.toContain("Board members");
  });
});

describe("CardDialogView labels picker", () => {
  it("offers all seven labels as checkboxes", () => {
    const { html, text } = render({ ui: { pop: "labels" } });
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(7);
    for (const l of labels) expect(text).toContain(l.name);
  });

  it("checks the labels on the card", () => {
    const { html } = render({ tile: tile({ label_ids: [3] }), ui: { pop: "labels" } });
    const boxes = [...html.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)].map((m) => m[0]);
    expect(boxes.filter((b) => b.includes("checked"))).toHaveLength(1);
    expect(boxes[2]).toContain("checked");
  });

  it("uses the text colour on the chip, with a coloured dot", () => {
    const { html } = render({ ui: { pop: "labels" } });
    expect(html).toContain('class="lbl"');
    expect(html).toContain("--c:var(--l-docs)");
  });
});

describe("CardDialogView due date", () => {
  it("marks an overdue card and a card due soon", () => {
    const past = render({ tile: tile({ due_on: "2000-01-01" }) });
    expect(past.html).toContain("Overdue");
    expect(past.html).toContain("chip over");
    const soon = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const today = `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}`;
    const now = render({ tile: tile({ due_on: today }) });
    expect(now.html).toContain("Due soon");
    expect(now.html).toContain("chip soon");
  });

  it("shows no chip for a date far away or none at all", () => {
    expect(render({ tile: tile({ due_on: "2999-01-01" }) }).text).not.toMatch(/Overdue|Due soon/);
    expect(render().text).not.toMatch(/Overdue|Due soon/);
  });
});

describe("CardDialogView description", () => {
  it("shows a skeleton while the detail loads and no edit button", () => {
    const { html } = render({ tile: tile({ has_description: true }), detail: { state: "loading", description: null } });
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toMatch(/>Edit<\/button>/);
    expect(html).not.toContain("Add a description");
  });

  it("says it could not load the description and offers Try again", () => {
    const { html, text } = render({ detail: { state: "error", description: null } });
    expect(text).toContain("Couldn't load the description.");
    expect(html).toMatch(/>Try again<\/button>/);
  });

  it("edits in a textarea with the limit, a counter, the hint, Save and Cancel", () => {
    const { html, text } = render({
      tile: tile({ has_description: true }),
      detail: { state: "ready", description: "Hello" },
      ui: { draft: "Hello!" },
    });
    expect(html).toMatch(/<textarea[^>]*maxLength="10000"/);
    expect(html).toContain(">Hello!</textarea>");
    expect(text).toContain("6 / 10,000");
    expect(text).toContain("HTML tags are removed");
    expect(html).toMatch(/>Save<\/button>/);
    expect(html).toMatch(/>Cancel<\/button>/);
    expect(html).not.toMatch(/>Edit<\/button>/);
  });

  it("formats the counter with a thousands separator", () => {
    const { text } = render({ ui: { draft: "a".repeat(1234) } });
    expect(text).toContain("1,234 / 10,000");
  });

  it("disables Save while the server has the text", () => {
    const { html } = render({ ui: { draft: "x", saving: true } });
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Save<\/button>|<button[^>]*>Saving…<\/button>/);
  });

  it("can start an edit with an empty description", () => {
    const { html } = render({ ui: { draft: "" } });
    expect(html).toMatch(/<textarea[^>]*maxLength="10000"/);
    expect(html).toContain("0 / 10,000");
  });
});

describe("CardDialogView when the card is gone", () => {
  it("shows the prototype's text and a way back", () => {
    const { html, text } = render({ tile: null });
    expect(text).toContain("This card isn't on the board");
    expect(text).toContain("It may have been archived or moved to another board.");
    expect(html).toContain('aria-labelledby="gone-title"');
    expect(html).toContain('id="gone-title"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toMatch(/>Back to the board<\/button>/);
    expect(html).not.toContain("<textarea");
  });
});
