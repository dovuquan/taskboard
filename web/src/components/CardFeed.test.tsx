import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { CommentEntry, EventEntry, FeedEntry } from "../api";
import { CardFeedView } from "./CardFeed";

type Props = Parameters<typeof CardFeedView>[0];

const NOW = Date.parse("2026-11-20T12:00:00Z");
const ann = { id: 1, name: "Ann Lee", avatar_url: null };
const bo = { id: 2, name: "Bo Tran", avatar_url: null };

const comment = (id: number, over: Partial<CommentEntry> = {}): CommentEntry => ({
  type: "comment",
  id,
  author: ann,
  text: `Comment ${id}`,
  created_at: "2026-11-20T09:00:00Z",
  edited_at: null,
  editable_until: null,
  ...over,
});

const activity = (id: number, over: Partial<EventEntry> = {}): EventEntry => ({
  type: "event",
  id,
  at: "2026-11-19T09:00:00Z",
  actor: bo,
  kind: "card.moved",
  data: { key: "TB-3", from_list_id: 11, to_list_id: 12 },
  ...over,
});

function render(over: Partial<Props> = {}) {
  const props: Props = {
    feed: { state: "ready", entries: [], more: false },
    editor: true,
    lists: [
      { id: 11, name: "To do" },
      { id: 12, name: "Doing" },
    ],
    people: [],
    now: NOW,
    ...over,
  };
  const html = renderToString(<CardFeedView {...props} />);
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return { html, text };
}

const withEntries = (entries: FeedEntry[], over: Partial<Props> = {}) =>
  render({ feed: { state: "ready", entries, more: false }, ...over });

describe("CardFeedView comment box", () => {
  it("is there for someone who can edit, with the 5,000-character limit", () => {
    const { html, text } = render();
    expect(html).toMatch(/<textarea[^>]*aria-label="Write a comment"/);
    expect(html).toContain('maxLength="5000"');
    expect(html).toContain('placeholder="Write a comment"');
    expect(html).toMatch(/>Comment<\/button>/);
    expect(text).not.toContain("Observers can read comments");
  });

  it("is replaced by a line for an observer", () => {
    const { html, text } = render({ editor: false });
    expect(text).toContain("Observers can read comments but not post.");
    expect(html).not.toContain("<textarea");
    expect(html).not.toMatch(/>Comment<\/button>/);
  });

  it("shows the typed text and disables Comment while posting", () => {
    const { html } = render({ ui: { text: "Hello there", posting: true } });
    expect(html).toContain(">Hello there</textarea>");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Comment<\/button>/);
  });
});

describe("CardFeedView entries", () => {
  it("has a heading and says when there is nothing yet", () => {
    const { text } = render();
    expect(text).toContain("Comments and activity");
    expect(text).toContain("No comments yet.");
  });

  it("shows a comment with its author, text and age", () => {
    const { text } = withEntries([comment(1)]);
    expect(text).toContain("Ann Lee");
    expect(text).toContain("3h ago");
    expect(text).toContain("Comment 1");
    expect(text).not.toContain("No comments yet.");
  });

  it("marks an edited comment", () => {
    const { text } = withEntries([comment(1, { edited_at: "2026-11-20T10:00:00Z" })]);
    expect(text).toContain("· edited");
    expect(withEntries([comment(2)]).text).not.toContain("edited");
  });

  it("shows activity as who and what, with the list names", () => {
    const { html, text } = withEntries([activity(7)]);
    expect(text).toContain("Bo Tran moved this card from To do to Doing");
    expect(html).toContain('class="entry activity"');
  });

  it("shows Taskboard as the actor of an activity with none", () => {
    expect(withEntries([activity(7, { actor: null })]).text).toContain("Taskboard moved this card");
  });

  it("shows the first four entries and offers Show all with the count", () => {
    const nine = Array.from({ length: 9 }, (_, i) => comment(i + 1));
    const { text } = withEntries(nine);
    expect(text).toContain("Comment 4");
    expect(text).not.toContain("Comment 5");
    expect(text).toContain("Show all 9");
  });

  it("shows everything with Show fewer once expanded", () => {
    const nine = Array.from({ length: 9 }, (_, i) => comment(i + 1));
    const { text } = withEntries(nine, { ui: { all: true } });
    expect(text).toContain("Comment 9");
    expect(text).toContain("Show fewer");
  });

  it("says when only the newest entries are shown", () => {
    const { text } = render({ feed: { state: "ready", entries: [comment(1)], more: true } });
    expect(text).toContain("Only the newest 200 entries are shown.");
  });

  it("shows a placeholder while loading and a retry when it failed", () => {
    expect(render({ feed: { state: "loading", entries: [], more: false } }).html).toContain('aria-busy="true"');
    const failed = render({ feed: { state: "error", entries: [], more: false } });
    expect(failed.text).toContain("Couldn't load the comments and activity.");
    expect(failed.html).toMatch(/>Try again<\/button>/);
  });
});

describe("CardFeedView Edit and Delete", () => {
  const future = "2026-11-21T09:00:00Z";
  const past = "2026-11-20T11:59:00Z";
  const actions = (html: string) => (html.match(/class="linkish"/g) ?? []).length;

  it("shows both on a comment whose edit window is still open", () => {
    const { html, text } = withEntries([comment(1, { editable_until: future })]);
    expect(html).toMatch(/class="linkish"[^>]*>Edit<\/button>/);
    expect(html).toMatch(/class="linkish"[^>]*>Delete<\/button>/);
    expect(text).toContain("Edit · Delete");
  });

  it("shows neither when the server gave no deadline (not the author, observer, or too old)", () => {
    const { html } = withEntries([comment(1, { editable_until: null })]);
    expect(actions(html)).toBe(0);
  });

  it("shows neither once the deadline has passed on this device's clock", () => {
    expect(actions(withEntries([comment(1, { editable_until: past })]).html)).toBe(0);
  });

  it("shows them on the comments that qualify and not on the others", () => {
    const { html } = withEntries([
      comment(1, { editable_until: future }),
      comment(2, { author: bo }),
      comment(3, { editable_until: past }),
    ]);
    expect(actions(html)).toBe(2);
  });

  it("shows neither to an observer, even with a deadline", () => {
    expect(actions(withEntries([comment(1, { editable_until: future })], { editor: false }).html)).toBe(0);
  });

  it("shows the edit box in place of the text, with Save, Cancel and the hint", () => {
    const { html, text } = withEntries([comment(1, { editable_until: future })], {
      ui: { edit: { id: 1, text: "Changed", original: "Comment 1" } },
    });
    expect(html).toContain("data-comment-edit");
    expect(html).toMatch(/<textarea[^>]*aria-label="Edit your comment"/);
    expect(html).toContain(">Changed</textarea>");
    expect(html).toContain('maxLength="5000"');
    expect(html).toMatch(/>Save<\/button>/);
    expect(html).toMatch(/>Cancel<\/button>/);
    expect(text).toContain("Ctrl/⌘+Enter · Esc");
    expect(html).not.toContain(">Comment 1<");
  });

  it("disables Save and Cancel while the edit is being saved", () => {
    const { html } = withEntries([comment(1, { editable_until: future })], {
      ui: { edit: { id: 1, text: "Changed", original: "Comment 1" }, saving: true },
    });
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Save<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Cancel<\/button>/);
  });
});

describe("CardFeedView text", () => {
  it("shows a web address in a comment as a link in a new tab, full address in the tooltip", () => {
    const { html } = withEntries([comment(1, { text: "See https://example.com/a/b for more" })]);
    expect(html).toContain('href="https://example.com/a/b"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('title="https://example.com/a/b"');
    expect(html).toContain(">example.com/a/b</a>");
  });

  it("never makes a link of a javascript: address", () => {
    const { html } = withEntries([comment(1, { text: "javascript:alert(1) [x](javascript:alert(1))" })]);
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("href=");
  });

  it("shows tag-like text as text", () => {
    const { html } = withEntries([comment(1, { text: "<b>hi</b><script>x</script>" })]);
    expect(html).not.toContain("<b>hi");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;b&gt;hi&lt;/b&gt;");
  });

  it("keeps the line breaks of a comment", () => {
    const { html } = withEntries([comment(1, { text: "one\ntwo" })]);
    expect(html).toContain('class="text"');
    expect(html).toContain("one\ntwo");
  });
});
