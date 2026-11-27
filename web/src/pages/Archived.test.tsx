import { type ReactNode, isValidElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Archived } from "../api";
import { ArchivedView } from "./Archived";

const NOW = Date.parse("2026-11-20T12:00:00Z");

const full: Archived = {
  lists: [
    { id: 21, name: "Backlog", card_count: 3, archived_at: "2026-11-20T11:59:30Z" },
    { id: 22, name: "Ideas", card_count: 1, archived_at: "2026-11-20T10:00:00Z" },
  ],
  cards: [
    {
      id: 31,
      key: "TB-5",
      title: "Pack boxes",
      list_id: 11,
      list_name: "To do",
      archived_at: "2026-11-20T11:15:00Z",
    },
    {
      id: 32,
      key: "TB-6",
      title: "Order tape",
      list_id: 21,
      list_name: "Backlog",
      archived_at: "2026-11-19T12:00:00Z",
    },
  ],
};

type Props = Parameters<typeof ArchivedView>[0];

function render(over: Partial<Props> = {}) {
  const props: Props = {
    state: "ready",
    boardId: 7,
    boardName: "Office move",
    owner: true,
    data: full,
    now: NOW,
    ...over,
  };
  const html = renderToString(<ArchivedView {...props} />);
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return { html, text };
}

const baseProps: Props = {
  state: "ready",
  boardId: 7,
  boardName: "Office move",
  owner: true,
  data: full,
  now: NOW,
};

/** Walks an element tree and lists every key that appears twice among the same siblings. */
function repeatedKeys(node: ReactNode): string[] {
  if (Array.isArray(node)) {
    const keys = node.flatMap((n) => (isValidElement(n) && n.key !== null ? [n.key] : []));
    const repeats = keys.filter((k, i) => keys.indexOf(k) !== i);
    return [...repeats, ...node.flatMap(repeatedKeys)];
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return repeatedKeys(node.props.children);
}

describe("ArchivedView head", () => {
  it("names the board and says what is kept", () => {
    const { html, text } = render();
    expect(html).toMatch(/<h1[^>]*>Archived on Office move<\/h1>/);
    expect(text).toContain("Archived lists and cards keep their comments, checklists and history.");
  });
});

describe("ArchivedView rows", () => {
  it("shows the lists with their card counts and age", () => {
    const { text } = render();
    expect(text).toContain("Lists (2)");
    expect(text).toContain("Backlog 3 cards · archived just now");
    expect(text).toContain("Ideas 1 card · archived 2h ago");
  });

  it("shows the cards with key, title, list and age", () => {
    const { text, html } = render();
    expect(text).toContain("Cards (2)");
    expect(text).toContain("TB-5 Pack boxes from To do · archived 45m ago");
    expect(text).toContain("TB-6 Order tape from Backlog · archived 19 Nov");
    expect(html).toContain('<span class="mono muted">TB-5</span>');
  });

  it("leaves out a section that has no rows", () => {
    const onlyCards = render({ data: { lists: [], cards: full.cards } }).text;
    expect(onlyCards).not.toContain("Lists (");
    expect(onlyCards).toContain("Cards (2)");
    const onlyLists = render({ data: { lists: full.lists, cards: [] } }).text;
    expect(onlyLists).not.toContain("Cards (");
    expect(onlyLists).toContain("Lists (2)");
  });

  it("gives every row its own key so React sees distinct siblings", () => {
    // A list and a card can share a numeric id; the rows must still render without a clash.
    const clash: Archived = {
      lists: [{ id: 5, name: "Same", card_count: 0, archived_at: "2026-11-20T11:00:00Z" }],
      cards: [
        {
          id: 5,
          key: "TB-9",
          title: "Same id",
          list_id: 5,
          list_name: "Same",
          archived_at: "2026-11-20T11:00:00Z",
        },
      ],
    };
    const twice: Archived = {
      lists: [...clash.lists, { ...clash.lists[0], id: 6 }],
      cards: [...clash.cards, { ...clash.cards[0], id: 6, key: "TB-10" }],
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { html } = render({ data: twice });
      expect(html).toContain("Same id");
      // renderToString only warns about a missing key, and never about a repeated one.
      const keyWarnings = spy.mock.calls.filter((args) => String(args[0]).includes("key"));
      expect(keyWarnings).toEqual([]);
    } finally {
      spy.mockRestore();
    }
    expect(repeatedKeys(ArchivedView({ ...baseProps, data: twice }))).toEqual([]);
  });
});

describe("ArchivedView restore buttons", () => {
  it("gives owners a Restore button on every row", () => {
    const { html } = render();
    expect((html.match(/>Restore<\/button>/g) ?? []).length).toBe(4);
  });

  it("gives non-owners no Restore button and the banner instead", () => {
    const { html, text } = render({ owner: false });
    expect(html).not.toContain(">Restore<");
    expect(text).toContain("Only board owners can restore archived items.");
    expect(html).toContain('class="banner"');
    expect(text).toContain("Backlog 3 cards");
  });

  it("shows no banner to owners", () => {
    expect(render().text).not.toContain("Only board owners can restore");
  });

  it("disables the buttons while a restore is out", () => {
    const { html } = render({ busy: true });
    expect((html.match(/<button[^>]*disabled[^>]*>Restore<\/button>/g) ?? []).length).toBe(4);
  });
});

describe("ArchivedView states", () => {
  it("shows the empty state with a way back", () => {
    const { html, text } = render({ data: { lists: [], cards: [] } });
    expect(text).toContain("Nothing is archived on this board");
    expect(text).toContain(
      "Archived lists and cards show up here. An owner can bring them back; nothing is deleted.",
    );
    expect(html).toMatch(/<a[^>]*href="\/boards\/7"[^>]*>Back to the board<\/a>/);
  });

  it("shows a skeleton while loading", () => {
    const { html } = render({ state: "loading", data: null });
    expect(html).toContain('aria-busy="true"');
  });

  it("says This board isn't here on a 404", () => {
    const { html, text } = render({ state: "gone", data: null, boardName: null });
    expect(text).toContain("This board isn't here");
    expect(html).toMatch(/<a[^>]*href="\/boards"[^>]*>Back to boards<\/a>/);
  });

  it("shows the load error with Try again", () => {
    const { html, text } = render({ state: "server", data: null });
    expect(text).toContain("Couldn't load archived items");
    expect(html).toMatch(/<button[^>]*>Try again<\/button>/);
    const network = render({ state: "network", data: null }).text;
    expect(network).toContain("Can't reach Taskboard");
    expect(network).toContain(
      "archived items could not be loaded because Taskboard isn't answering. Check your connection, or ask an admin whether the server is running.",
    );
  });

  it("renders the toast", () => {
    const { html } = render({ message: "Restored TB-5 to To do" });
    expect(html).toContain('<div class="toast" role="status"><span>Restored TB-5 to To do</span></div>');
  });
});
