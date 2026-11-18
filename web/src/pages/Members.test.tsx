import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Me, Member, Refusal } from "../api";
import { MembersView } from "./Members";

const NOW = new Date(2026, 10, 18, 12, 0);
const at = (m: number, d: number, h = 12, min = 0) => new Date(2026, m - 1, d, h, min).toISOString();

const ann: Me = {
  id: 1,
  email: "ann@example.com",
  name: "Ann Lee",
  avatar_url: null,
  role: "admin",
};

const annRow: Member = {
  ...ann,
  joined_at: at(10, 20),
  last_seen_at: at(11, 18, 11),
  pending: false,
};
const bobRow: Member = {
  id: 2,
  email: "bob@example.com",
  name: "Bob Tran",
  avatar_url: null,
  role: "member",
  joined_at: at(10, 22),
  last_seen_at: at(11, 17, 20),
  pending: false,
};
const cyRow: Member = {
  id: 3,
  email: "cy@example.com",
  name: null,
  avatar_url: null,
  role: "member",
  joined_at: at(11, 5),
  last_seen_at: null,
  pending: true,
};

type Props = Parameters<typeof MembersView>[0];

function render(over: Partial<Props> = {}) {
  const html = renderToString(
    <MembersView
      state="ready"
      me={ann}
      rows={[annRow, bobRow, cyRow]}
      refused={[]}
      message={null}
      domain="example.com"
      now={NOW}
      {...over}
    />,
  );
  const text = html
    .replace(/<span class="mono">(.*?)<\/span>/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return { html, text };
}

const HEAD =
  "Workspace members Anyone with a verified example.com Google account joins as a member on first sign-in. Board access is set on each board. ";
const CLI =
  "The first admin is created from the command line (taskboard admin --email). Admins can promote others here. ";
const FEED_EMPTY = "Refused sign-ins last 7 days No refused sign-ins in the last 7 days.";
const SOLE =
  "You are the only admin. Make someone else an admin before you can step down; a workspace always keeps one admin. ";
const ALONE =
  "Nobody else has signed in yet. Colleagues appear here the first time they sign in with their example.com account; there is nothing to send them. ";

describe("MembersView", () => {
  it("has exactly this text for an admin", () => {
    expect(render().text).toBe(
      HEAD +
        "Person Workspace role Joined Last active " +
        "AL Ann Lee ann@example.com Admin Member 20 Oct Today " +
        "BT Bob Tran bob@example.com Admin Member 22 Oct Yesterday " +
        "C cy@example.com Admin Member 5 Nov Not yet " +
        SOLE +
        CLI +
        FEED_EMPTY,
    );
  });

  it("selects each member's role", () => {
    const { html } = render();
    expect(html).toMatch(/aria-label="Workspace role for Bob Tran"[^>]*>\s*<option value="admin">/);
    expect(html).toMatch(/<option value="member" selected="">Member<\/option>/);
    expect(html).toMatch(/<option value="admin" selected="">Admin<\/option>/);
  });

  it("disables the select on your own row with the hint", () => {
    const { html } = render();
    const selects = html.match(/<select[^>]*>/g) ?? [];
    expect(selects).toHaveLength(3);
    const own = selects.filter((s) => s.includes("disabled"));
    expect(own).toHaveLength(1);
    expect(own[0]).toContain('aria-label="Workspace role for Ann Lee"');
    expect(own[0]).toContain('title="You cannot change your own role"');
  });

  it("shows the sole-admin note only with other members and one admin", () => {
    expect(render().text).toContain(SOLE);
    expect(render({ rows: [annRow, { ...bobRow, role: "admin" }] }).text).not.toContain(SOLE);
    expect(render({ rows: [annRow] }).text).not.toContain(SOLE);
  });

  it("shows the alone note only when you are the only member", () => {
    const alone = render({ rows: [annRow] }).text;
    expect(alone).toContain(ALONE);
    expect(alone).toBe(
      HEAD +
        "Person Workspace role Joined Last active " +
        "AL Ann Lee ann@example.com Admin Member 20 Oct Today " +
        ALONE +
        CLI +
        FEED_EMPTY,
    );
    expect(render().text).not.toContain("Nobody else has signed in yet");
  });

  it("lists refused sign-ins as the server sent them", () => {
    const refused: Refusal[] = [
      { at: at(11, 18, 9, 12), email: "minh.home@gmail.com", reason: "wrong_domain" },
      { at: at(11, 17, 14, 5), email: null, reason: "oauth_error" },
    ];
    const { text } = render({ refused });
    expect(text.endsWith(
      "Refused sign-ins last 7 days When Account Why it was refused " +
        "Today 09:12 minh.home@gmail.com Not an example.com Workspace account " +
        "Yesterday 14:05 Unknown account Google sign-in was cancelled or did not finish",
    )).toBe(true);
    expect(text).not.toContain("No refused sign-ins");
  });

  it("shows the empty feed text", () => {
    expect(render().text).toContain(FEED_EMPTY);
  });

  it("shows a toast with the message", () => {
    const { html, text } = render({
      message: "A workspace needs at least one admin. Make someone else an admin first.",
    });
    expect(html).toContain('role="status"');
    expect(text.endsWith(
      "A workspace needs at least one admin. Make someone else an admin first.",
    )).toBe(true);
    expect(render().html).not.toContain('role="status"');
  });

  it("shows the explanation for non-admins without a table", () => {
    const { html, text } = render({
      state: "denied",
      me: { ...ann, role: "member" },
      rows: [],
      refused: [],
    });
    expect(text).toBe(
      "Only workspace admins can see members You are signed in as a workspace member. Back to boards",
    );
    expect(html).toContain('<a class="btn" href="/boards">Back to boards</a>');
    expect(html).not.toContain("<table");
  });

  it("shows five skeleton rows with aria-busy while loading", () => {
    const { html, text } = render({ state: "loading", rows: [], refused: [] });
    expect(html).toContain('aria-busy="true"');
    expect(html.match(/class="skel"/g)).toHaveLength(5);
    expect(text).toBe(HEAD.trim());
  });

  it("shows the unreachable error", () => {
    const { html, text } = render({ state: "network", rows: [], refused: [] });
    expect(text).toBe(
      HEAD +
        "Can't reach Taskboard The member list could not be loaded because Taskboard isn't answering. Check your connection, or ask an admin whether the server is running. Try again",
    );
    expect(html).toContain('<div class="empty error">');
    expect(html).toContain('<button class="btn" type="button">Try again</button>');
  });

  it("shows the server error", () => {
    const { text } = render({ state: "server", rows: [], refused: [] });
    expect(text).toBe(
      HEAD +
        "Couldn't load members Something went wrong on the server (error 500). Nothing you saved is lost. Try again; if it keeps happening, tell a workspace admin. Try again",
    );
  });

  it("never renders null when the domain is unknown", () => {
    const { text } = render({ domain: null, rows: [annRow] });
    expect(text).not.toContain("null");
    expect(text).not.toContain("example.com Google");
    expect(text).toContain(
      "Anyone with a verified Google account from your organisation joins as a member on first sign-in.",
    );
    expect(text).toContain("with their organisation's account;");
  });
});
