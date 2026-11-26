import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ChecklistItem } from "../api";
import { ChecklistView } from "./Checklist";

type Props = Parameters<typeof ChecklistView>[0];

const items = (done: boolean[]): ChecklistItem[] =>
  done.map((d, i) => ({ id: i + 1, text: `Item ${i + 1}`, done: d }));

function render(over: Partial<Props> = {}) {
  const props: Props = { items: items([true, false]), editor: true, ...over };
  const html = renderToString(<ChecklistView {...props} />);
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return { html, text };
}

const checkboxes = (html: string) => html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];

describe("ChecklistView for someone who can edit", () => {
  const editor = true;
  it("shows the add form with the 200-character limit", () => {
    const { html } = render({ editor });
    expect(html).toMatch(/<input[^>]*placeholder="Add an item"/);
    expect(html).toContain('maxLength="200"');
    expect(html).toContain('aria-label="New checklist item"');
    expect(html).toMatch(/>Add<\/button>/);
  });

  it("shows a delete button for each item, named after it", () => {
    const { html } = render({ editor });
    expect(html).toContain('aria-label="Delete item: Item 1"');
    expect(html).toContain('aria-label="Delete item: Item 2"');
    expect((html.match(/class="del"/g) ?? []).length).toBe(2);
  });

  it("gives enabled checkboxes, checked for done items", () => {
    const boxes = checkboxes(render({ editor }).html);
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toContain('checked=""');
    expect(boxes[1]).not.toContain("checked");
    for (const box of boxes) expect(box).not.toContain("disabled");
  });

  it("disables the checkbox of an item whose save is out, and only that one", () => {
    const boxes = checkboxes(render({ editor, busyIds: [2] }).html);
    expect(boxes[0]).not.toContain("disabled");
    expect(boxes[1]).toContain("disabled");
  });

  it("disables Add while an item is being added, and shows the typed text", () => {
    const { html } = render({ editor, adding: true, draft: "Buy tape" });
    expect(html).toContain('value="Buy tape"');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Add<\/button>/);
  });
});

describe("ChecklistView for an observer", () => {
  it("shows disabled checkboxes, no add form and no delete buttons", () => {
    const { html } = render({ editor: false });
    const boxes = checkboxes(html);
    expect(boxes).toHaveLength(2);
    for (const box of boxes) expect(box).toContain("disabled");
    expect(html).not.toContain("Add an item");
    expect(html).not.toContain('class="del"');
    expect(html).not.toContain("Delete item");
  });

  it("says there is no checklist when it is empty", () => {
    const { text } = render({ editor: false, items: [] });
    expect(text).toContain("No checklist.");
  });
});

describe("ChecklistView progress", () => {
  it("shows done of total, a bar and the percentage", () => {
    const { html, text } = render({ items: items([true, true, false, false, false]) });
    expect(text).toContain("2/5");
    expect(text).toContain("40%");
    expect(html).toContain('style="width:40%"');
    expect(html).toContain('class="bar"');
    expect(html).not.toContain("bar full");
    expect(html).toContain('aria-label="Checklist: 2/5 · 40%"');
  });

  it("turns the bar to its full style at 100 %", () => {
    const { html } = render({ items: items([true, true]) });
    expect(html).toContain('class="bar full"');
  });

  it("shows no progress for an empty list", () => {
    const { html } = render({ items: [] });
    expect(html).not.toContain('class="progress"');
  });

  it("marks done items with the done style", () => {
    const { html } = render();
    expect(html).toContain('class="check done"');
    expect(html).toContain('class="check"');
  });
});

describe("ChecklistView hide and show", () => {
  it("offers to hide checked items only when some are checked", () => {
    expect(render({ items: items([false, false]) }).text).not.toContain("Hide checked items");
    expect(render().text).toContain("Hide checked items");
  });

  it("hides the checked items and offers to show them with their count", () => {
    const { html, text } = render({ items: items([true, false, true]), hideChecked: true });
    expect(text).toContain("Show checked items (2)");
    expect(text).toContain("Item 2");
    expect(text).not.toContain("Item 1");
    expect(checkboxes(html)).toHaveLength(1);
  });

  it("says everything is checked when all are hidden", () => {
    const { text } = render({ items: items([true, true]), hideChecked: true });
    expect(text).toContain("Everything is checked.");
  });

  it("does not say it while the items are showing", () => {
    expect(render({ items: items([true, true]) }).text).not.toContain("Everything is checked.");
  });

  it("shows six items and offers Show all with the count", () => {
    const nine = items(Array.from({ length: 9 }, () => false));
    const { html, text } = render({ items: nine });
    expect(checkboxes(html)).toHaveLength(6);
    expect(text).toContain("Show all 9");
    expect(text).not.toContain("Item 7");
  });

  it("shows every item with Show fewer once expanded", () => {
    const nine = items(Array.from({ length: 9 }, () => false));
    const { html, text } = render({ items: nine, showAll: true });
    expect(checkboxes(html)).toHaveLength(9);
    expect(text).toContain("Show fewer");
  });

  it("offers no Show all at six items", () => {
    const six = items(Array.from({ length: 6 }, () => false));
    expect(render({ items: six }).text).not.toContain("Show all");
  });
});

describe("ChecklistView item text", () => {
  const withText = (text: string) => render({ items: [{ id: 1, text, done: false }] });

  it("shows a web address as a link in a new tab, with host and path start, full address in the tooltip", () => {
    const { html } = withText("Read https://www.example.com/docs/setup/long/path/that/goes/on first");
    expect(html).toContain('class="ext"');
    expect(html).toContain('href="https://www.example.com/docs/setup/long/path/that/goes/on"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('title="https://www.example.com/docs/setup/long/path/that/goes/on"');
    expect(html).toContain(">example.com/docs/setup/long/path/…</a>");
  });

  it("never makes a link of a javascript: address", () => {
    const { html } = withText("javascript:alert(1) and [x](javascript:alert(2))");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("href=");
  });

  it("shows text that looks like markup as plain text", () => {
    const { html } = withText("<b>bold</b> **x**");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt; **x**");
  });
});
