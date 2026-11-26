import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { BoardDetail, Card, Label } from "../api";
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
  it("says there are no lists yet, with the button enabled for editors", () => {
    const { html, text } = render();
    expect(text).toContain("This board has no lists yet");
    expect(text).toContain(
      "Lists are the columns cards move through, for example To do, Doing and Done.",
    );
    const button = html.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*Add To do, Doing, Done<\/button>/);
    expect(button).not.toBeNull();
    expect(button![0]).not.toContain("disabled");
  });

  it("disables the button while the three lists are being added", () => {
    const { html } = render({ lanes: { seeding: true } });
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*Add To do, Doing, Done<\/button>/);
  });

  it("asks observers to find a member instead of showing the button", () => {
    const { html, text } = render({ board: board({ my_role: "observer" }) });
    expect(text).toContain("Ask a board member to add the first lists.");
    expect(html).not.toContain("Add To do, Doing, Done");
  });
});

const some = [
  { id: 11, name: "To do" },
  { id: 12, name: "Doing" },
  { id: 13, name: "Done" },
];

describe("BoardView lanes", () => {
  it("shows the lanes in the given order and not the empty state", () => {
    const { html, text } = render({ lists: [some[2], some[0], some[1]] });
    expect(text).not.toContain("This board has no lists yet");
    expect(html).toMatch(/aria-label="Done"[\s\S]*aria-label="To do"[\s\S]*aria-label="Doing"/);
    expect(html).toContain('class="lane"');
    expect(html).toContain("<h3");
  });

  it("gives editors the grip, the list menu button and Add list", () => {
    for (const my_role of ["owner", "member"] as const) {
      const { html, text } = render({ board: board({ my_role }), lists: some });
      expect(html).toContain('class="grip"');
      expect(html).toContain('draggable="true"');
      expect(html).toContain('aria-label="List actions for Doing"');
      expect(html).toContain('title="Click to rename"');
      expect(text).toContain("Add list");
    }
  });

  it("gives observers none of those", () => {
    const { html, text } = render({ board: board({ my_role: "observer" }), lists: some });
    expect(html).toContain('aria-label="Doing"');
    expect(html).not.toContain('class="grip"');
    expect(html).not.toContain("draggable");
    expect(html).not.toContain("List actions for");
    expect(html).not.toContain("Click to rename");
    expect(text).not.toContain("Add list");
  });

  it("replaces Add list with the limit text at 50 lists", () => {
    const fifty = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, name: `L${i + 1}` }));
    const { html, text } = render({ lists: fifty });
    expect(text).toContain("50 lists is the limit for one board. Archive a list to add another.");
    expect(html).not.toContain('class="add-lane"');
    const forty = render({ lists: fifty.slice(0, 49) });
    expect(forty.html).toContain('class="add-lane"');
    expect(forty.text).not.toContain("is the limit for one board");
  });

  it("opens the menu with Add a card first, then Rename list and Archive list", () => {
    const { html, text } = render({ lists: some, lanes: { menu: 12 } });
    expect(html).toContain('role="menu"');
    expect(html).toContain('aria-expanded="true"');
    const items = [...html.matchAll(/role="menuitem"[^>]*>([\s\S]*?)<\/button>/g)].map((m) =>
      m[1].replace(/<[^>]*>/g, "").trim(),
    );
    expect(items).toEqual(["Add a card", "Rename list", "Archive list"]);
    expect(text).toContain("Archive list");
  });

  it("shows the rename field for the list being renamed", () => {
    const { html } = render({ lists: some, lanes: { renaming: 12 } });
    expect(html).toContain('class="input lane-rename"');
    expect(html).toContain('value="Doing"');
    expect(html).toContain('maxLength="80"');
  });

  it("shows the add form when adding", () => {
    const { html } = render({ lists: some, lanes: { adding: true } });
    expect(html).toContain('aria-label="New list name"');
    expect(html).toContain('placeholder="List name"');
  });
});

const card = (id: number, list_id: number, title: string, over: Partial<Card> = {}): Card => ({
  id,
  key: `TB-${id}`,
  list_id,
  title,
  label_ids: [],
  member_ids: [],
  due_on: null,
  has_description: false,
  ...over,
});

const labels: Label[] = [
  { id: 1, name: "Launch", color: "launch" },
  { id: 2, name: "Bug", color: "bug" },
];

const people = [
  { id: 1, name: "Ann Lee", email: "ann@example.com", avatar_url: null },
  { id: 2, name: "Bo Tran", email: "bo@example.com", avatar_url: null },
  { id: 3, name: null, email: "cy@example.com", avatar_url: null },
  { id: 4, name: "Di Ho", email: "di@example.com", avatar_url: null },
  { id: 5, name: "Ed Fu", email: "ed@example.com", avatar_url: null },
];

const cards = [
  card(1, 11, "Pack boxes"),
  card(2, 12, "Label crates"),
  card(3, 11, "Book movers"),
  card(4, 11, "Order tape"),
];

const lane = (html: string, name: string) => {
  const start = html.indexOf(`aria-label="${name}"`);
  const end = html.indexOf("</section>", start);
  return html.slice(start, end);
};

describe("BoardView cards", () => {
  it("shows each tile with its key and title, in order", () => {
    const { html } = render({ lists: some, cards });
    const todo = lane(html, "To do");
    expect(todo).toContain('<span class="cid mono">TB-1</span><span class="title">Pack boxes</span>');
    expect(todo.indexOf("Pack boxes")).toBeLessThan(todo.indexOf("Book movers"));
    expect(todo.indexOf("Book movers")).toBeLessThan(todo.indexOf("Order tape"));
    expect(todo).not.toContain("Label crates");
    expect(lane(html, "Doing")).toContain("Label crates");
  });

  it("puts the tiles in a lane body that is a drop target", () => {
    const { html } = render({ lists: some, cards });
    expect(html).toContain('class="lane-body" data-drop="11"');
    expect(html).toContain('data-card="1"');
  });

  it("leaves out cards of lists that are not shown", () => {
    const { html } = render({ lists: [some[1]], cards });
    expect(html).toContain("Label crates");
    expect(html).not.toContain("Pack boxes");
  });

  it("makes every tile a button that can take focus, for observers too", () => {
    for (const my_role of ["owner", "member", "observer"] as const) {
      const { html } = render({ board: board({ my_role }), lists: some, cards });
      const tiles = html.match(/<div class="card[^"]*"[^>]*>/g) ?? [];
      expect(tiles).toHaveLength(4);
      for (const tile of tiles) {
        expect(tile).toContain('role="button"');
        expect(tile).toContain('tabindex="0"');
      }
    }
  });

  it("leaves the tile's own text as its accessible name", () => {
    const { html } = render({ lists: some, cards });
    expect(html).not.toMatch(/<div class="card[^"]*"[^>]*aria-label=/);
  });

  it("shows the number of cards in each lane header", () => {
    const { html } = render({ lists: some, cards });
    expect(html).toContain('<span class="n">3</span>');
    expect(html).toContain('<span class="n">1</span>');
    expect(html).toContain('<span class="n">0</span>');
    expect(lane(html, "To do")).toContain('<span class="n">3</span>');
    expect(lane(html, "Done")).toContain('<span class="n">0</span>');
  });

  it("shows the count to observers too", () => {
    const { html } = render({ board: board({ my_role: "observer" }), lists: some, cards });
    expect(html).toContain('<span class="n">3</span>');
  });

  it("makes cards draggable and shows Add a card for owners and members", () => {
    for (const my_role of ["owner", "member"] as const) {
      const { html } = render({ board: board({ my_role }), lists: some, cards });
      const todo = lane(html, "To do");
      expect(todo).toMatch(/class="card"[^>]*draggable="true"|draggable="true"[^>]*class="card"/);
      expect((html.match(/class="add-card"/g) ?? []).length).toBe(3);
      expect(html).toContain("Add a card");
    }
  });

  it("gives observers no drag, no add button, no composer and no menu", () => {
    const { html, text } = render({
      board: board({ my_role: "observer" }),
      lists: some,
      cards,
      lanes: { composer: 11 },
    });
    expect(html).toContain("Pack boxes");
    expect(html).not.toContain("draggable");
    expect(html).not.toContain('class="add-card"');
    expect(html).not.toContain("New card title");
    expect(html).not.toContain("List actions for");
    expect(text).not.toContain("Add a card");
  });

  it("marks the dragged card and the drop slot", () => {
    const dragged = render({ lists: some, cards, lanes: { cardDragId: 1 } }).html;
    expect(dragged).toMatch(/class="card dragging"/);
    const before = render({
      lists: some,
      cards,
      lanes: { cardDragId: 2, cardDrop: { listId: 11, index: 1 } },
    }).html;
    expect(before).toMatch(/class="card drop-before"[^>]*data-card="3"|data-card="3"[^>]*class="card drop-before"/);
    const end = render({
      lists: some,
      cards,
      lanes: { cardDragId: 2, cardDrop: { listId: 11, index: 3 } },
    }).html;
    expect(end).toContain('class="lane-body drop-end" data-drop="11"');
    expect(end).not.toContain("drop-before");
  });

  it("opens the composer for one lane with the prototype's fields", () => {
    const { html, text } = render({ lists: some, cards, lanes: { composer: 12 } });
    const doing = lane(html, "Doing");
    expect(doing).toContain('class="composer"');
    expect(doing).toContain('placeholder="Card title"');
    expect(doing).toContain('maxLength="200"');
    expect(doing).toContain('aria-label="New card title"');
    expect(doing).toContain("Add card</button>");
    expect(doing).toContain("Cancel</button>");
    expect(text).toContain("Enter to add · Esc to close");
    expect(lane(html, "To do")).not.toContain("composer");
    expect(lane(html, "To do")).toContain("Add a card");
    expect(doing).not.toContain('class="add-card"');
  });

  it("words the archive item with the card count", () => {
    const three = render({ lists: some, cards, lanes: { menu: 11 } }).text;
    expect(three).toContain("Archive list and its 3 cards");
    const one = render({ lists: some, cards, lanes: { menu: 12 } }).text;
    expect(one).toContain("Archive list and its 1 card");
    expect(one).not.toContain("1 cards");
    const none = render({ lists: some, cards, lanes: { menu: 13 } }).text;
    expect(none).toContain("Archive list");
    expect(none).not.toContain("Archive list and its");
  });
});

describe("BoardView card tile checklist and comment badges", () => {
  const tileOf = (html: string, key: string) => {
    const start = html.indexOf(`>${key}</span>`);
    const end = html.indexOf("</div>", start);
    return html.slice(start, end);
  };
  const draw = (c: Card) => render({ lists: some, cards: [c], labels, people });

  it("shows done of total as a checklist badge", () => {
    const tile = tileOf(draw(card(1, 11, "Pack boxes", { checklist_done: 2, checklist_total: 5 })).html, "TB-1");
    expect(tile).toContain('class="b" title="Checklist"');
    expect(tile).toContain("2/5");
    expect(tile).toMatch(/class="sr"[^>]*>Checklist: 2 of 5 done</);
    expect(tile).not.toContain("b done");
  });

  it("gives the checklist badge the done style when every item is checked", () => {
    const tile = tileOf(draw(card(1, 11, "Pack boxes", { checklist_done: 5, checklist_total: 5 })).html, "TB-1");
    expect(tile).toContain('class="b done" title="Checklist"');
    expect(tile).toContain("5/5");
  });

  it("shows no checklist badge for an empty checklist", () => {
    const tile = tileOf(draw(card(1, 11, "Pack boxes", { checklist_done: 0, checklist_total: 0 })).html, "TB-1");
    expect(tile).not.toContain("Checklist");
    expect(tile).not.toContain('class="badges"');
  });

  it("shows the number of comments", () => {
    const tile = tileOf(draw(card(1, 11, "Pack boxes", { comment_count: 3 })).html, "TB-1");
    expect(tile).toContain('class="b" title="Comments"');
    expect(tile).toMatch(/class="sr"[^>]*>3 comments</);
    expect(tile).toContain(">3<");
  });

  it("says 1 comment in the singular and shows no badge for none", () => {
    expect(tileOf(draw(card(1, 11, "Pack boxes", { comment_count: 1 })).html, "TB-1")).toMatch(/>1 comment</);
    expect(tileOf(draw(card(1, 11, "Pack boxes", { comment_count: 0 })).html, "TB-1")).not.toContain("Comments");
  });

  it("puts the badges after the description badge and before the people", () => {
    const tile = tileOf(
      draw(card(1, 11, "Pack boxes", { has_description: true, checklist_done: 1, checklist_total: 2, comment_count: 1, member_ids: [1] }))
        .html,
      "TB-1",
    );
    expect(tile.indexOf("Has a description")).toBeLessThan(tile.indexOf('title="Checklist"'));
    expect(tile.indexOf('title="Checklist"')).toBeLessThan(tile.indexOf('title="Comments"'));
    expect(tile.indexOf('title="Comments"')).toBeLessThan(tile.indexOf('class="stack"'));
  });
});

describe("BoardView card tile details", () => {
  const tileOf = (html: string, key: string) => {
    const start = html.indexOf(`>${key}</span>`);
    const end = html.indexOf("</div>", start);
    return html.slice(start, end);
  };
  const draw = (c: Card, over: Partial<Props> = {}) =>
    render({ lists: some, cards: [c], labels, people, ...over });

  it("shows the labels with their names, colour and text colour", () => {
    const { html } = draw(card(1, 11, "Pack boxes", { label_ids: [2, 1] }));
    const tile = tileOf(html, "TB-1");
    expect(tile).toContain('<span class="labels">');
    expect(tile).toContain('class="lbl"');
    expect(tile).toContain("--c:var(--l-bug)");
    expect(tile.indexOf("Bug")).toBeLessThan(tile.indexOf("Launch"));
    expect(tile.indexOf('class="labels"')).toBeLessThan(tile.indexOf('class="title"'));
  });

  it("shows no label row or badges for a plain card", () => {
    const { html } = draw(card(1, 11, "Pack boxes"));
    expect(tileOf(html, "TB-1")).not.toContain('class="labels"');
    expect(tileOf(html, "TB-1")).not.toContain('class="badges"');
  });

  it("shows an overdue due date with the date and words for screen readers", () => {
    const { html } = draw(card(1, 11, "Pack boxes", { due_on: "2000-01-05" }));
    const tile = tileOf(html, "TB-1");
    expect(tile).toContain("b due over");
    expect(tile).toContain("5 Jan");
    expect(tile).toContain('title="Due 5 Jan, overdue"');
    expect(tile).toMatch(/class="sr"[^>]*>Due 5 Jan, overdue</);
  });

  it("shows a far due date with no state", () => {
    const { html } = draw(card(1, 11, "Pack boxes", { due_on: "2999-12-31" }));
    const tile = tileOf(html, "TB-1");
    expect(tile).toContain('class="b due"');
    expect(tile).toContain('title="Due 31 Dec"');
    expect(tile).not.toContain("overdue");
    expect(tile).not.toContain("due soon");
  });

  it("marks a card that has a description", () => {
    const { html } = draw(card(1, 11, "Pack boxes", { has_description: true }));
    expect(tileOf(html, "TB-1")).toContain('title="Has a description"');
    expect(tileOf(html, "TB-1")).toMatch(/class="sr"[^>]*>Has a description</);
  });

  it("shows the assigned people, names for screen readers and the avatars hidden from them", () => {
    const { html } = draw(card(1, 11, "Pack boxes", { member_ids: [1, 3] }));
    const tile = tileOf(html, "TB-1");
    expect(tile).toContain('class="stack" aria-hidden="true"');
    expect(tile).toContain(">AL<");
    expect(tile).toMatch(/class="sr"[^>]*>Assigned to Ann Lee, cy@example.com</);
  });

  it("shows four avatars and a +N chip for more", () => {
    const { html } = draw(card(1, 11, "Pack boxes", { member_ids: [1, 2, 3, 4, 5] }));
    const tile = tileOf(html, "TB-1");
    expect((tile.match(/class="avatar"/g) ?? []).length).toBe(4);
    expect(tile).toContain("+1");
  });

  it("shows the same to an observer", () => {
    const { html } = draw(
      card(1, 11, "Pack boxes", { label_ids: [1], due_on: "2000-01-05", has_description: true, member_ids: [1] }),
      { board: board({ my_role: "observer" }) },
    );
    const tile = tileOf(html, "TB-1");
    expect(tile).toContain("Launch");
    expect(tile).toContain("5 Jan");
    expect(tile).toContain("Has a description");
    expect(tile).toContain(">AL<");
  });

  it("renders the card dialog slot after the board", () => {
    const { html } = render({ lists: some, cards, dialog: <aside id="card-slot">dialog</aside> });
    expect(html.indexOf("Office move")).toBeLessThan(html.indexOf('id="card-slot"'));
  });
});

describe("BoardView card limit", () => {
  const many = Array.from({ length: 1000 }, (_, i) => card(i + 1, 11, `Card ${i + 1}`));

  it("shows the banner to editors and hides every way to add a card", () => {
    const { html, text } = render({ lists: some, cards: many, lanes: { composer: 11, menu: 11 } });
    expect(html).toContain('class="banner warn"');
    expect(text).toContain(
      "This board has reached 1,000 cards, the limit for one board. Archive cards to add new ones.",
    );
    expect(html).not.toContain('class="add-card"');
    expect(html).not.toContain("New card title");
    expect(html).not.toContain("Enter to add");
    expect(text).not.toContain("Add a card");
    expect(text).toContain("Archive list and its 1000 cards");
  });

  it("does not show the banner to observers", () => {
    const { html, text } = render({
      board: board({ my_role: "observer" }),
      lists: some,
      cards: many,
    });
    expect(html).not.toContain("banner warn");
    expect(text).not.toContain("1,000 cards");
  });

  it("does not show the banner at 999 cards", () => {
    const { html, text } = render({ lists: some, cards: many.slice(0, 999) });
    expect(html).not.toContain("banner warn");
    expect(html).toContain('class="add-card"');
    expect(text).toContain("Add a card");
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
