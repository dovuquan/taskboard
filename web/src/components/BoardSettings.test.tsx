import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { BoardDetail, BoardMember, Me, Member } from "../api";
import { BoardSettingsView } from "./BoardSettings";

const me: Me = { id: 1, email: "ann@example.com", name: "Ann Lee", avatar_url: null, role: "member" };

const board = (over: Partial<BoardDetail> = {}): BoardDetail => ({
  id: 7,
  name: "Office move",
  visibility: "workspace",
  my_role: "owner",
  member_count: 2,
  members: [],
  updated_at: "2026-11-20T09:00:00Z",
  created_at: "2026-11-01T09:00:00Z",
  ...over,
});

const bm = (id: number, name: string | null, role: BoardMember["role"]): BoardMember => ({
  id,
  name,
  email: `u${id}@example.com`,
  avatar_url: null,
  role,
  added_at: "2026-11-02T09:00:00Z",
  pending: false,
});

const people = [bm(1, "Ann Lee", "owner"), bm(2, "Bob Tran", "member")];

const ws = (id: number, name: string, email: string): Member => ({
  id,
  name,
  email,
  avatar_url: null,
  role: "member",
  joined_at: null,
  last_seen_at: null,
  pending: false,
});

type Props = Parameters<typeof BoardSettingsView>[0];

function render(over: Partial<Props> = {}) {
  const props: Props = {
    board: board(),
    people,
    peopleState: "ready",
    workspace: [],
    me,
    domain: "example.com",
    name: "Office move",
    query: "",
    busy: false,
    ...over,
  };
  const html = renderToString(<BoardSettingsView {...props} />);
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return { html, text };
}

/** The opening tag of one visibility radio, whatever order React writes its attributes in. */
function radio(html: string, value: string): string {
  const tags = html.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
  return tags.find((t) => t.includes(`value="${value}"`)) ?? "";
}

describe("BoardSettingsView as an owner", () => {
  it("is a modal dialog titled Board settings with a close button", () => {
    const { html, text } = render();
    expect(html).toMatch(/<aside[^>]*class="sheet"[^>]*role="dialog"[^>]*aria-modal="true"/);
    expect(html).toContain('aria-labelledby="sheet-title"');
    expect(text).toContain("Board settings");
    expect(html).toContain('aria-label="Close (Esc)"');
    expect(html).toContain('class="scrim"');
  });

  it("has an editable name limited to 80 characters", () => {
    const { html } = render();
    expect(html).toMatch(/<input[^>]*id="bs-name"[^>]*value="Office move"/);
    expect(html).toMatch(/id="bs-name"[^>]*maxLength="80"|maxLength="80"[^>]*id="bs-name"|maxlength="80"/);
    expect(html).not.toMatch(/<input[^>]*id="bs-name"[^>]*disabled/);
  });

  it("offers Workspace and Private with the domain from the config", () => {
    const { html, text } = render();
    expect(text).toContain("Who can see this board");
    expect(text).toContain(
      "Everyone in the example.com workspace can open it as an observer. Members and owners are added below.",
    );
    expect(text).toContain("Only the people listed below can see it.");
    expect(radio(html, "workspace")).toContain("checked");
    expect(radio(html, "private")).not.toContain("checked");
  });

  it("checks Private for a Private board", () => {
    const { html } = render({ board: board({ visibility: "private" }) });
    expect(radio(html, "private")).toContain("checked");
    expect(radio(html, "workspace")).not.toContain("checked");
  });

  it("leaves the domain out when it is unknown", () => {
    const { text } = render({ domain: null });
    expect(text).toContain("Everyone in the workspace can open it as an observer.");
    expect(text).not.toContain("null");
  });

  it("lists the members with their email, (you) and a role select", () => {
    const { html, text } = render();
    expect(text).toContain("Board members (2)");
    expect(text).toContain("Ann Lee (you)");
    expect(text).toContain("ann@example.com".replace("ann", "u1"));
    expect(html).toContain('aria-label="Board role for Bob Tran"');
    expect(html).toMatch(/<option value="member" selected="">Member<\/option>/);
  });

  it("ends each role select with Remove from board", () => {
    const { html } = render();
    expect(html).toMatch(/<option value="observer">Observer<\/option><option value="remove">Remove from board<\/option><\/select>/);
  });

  it("disables the selects while a save is pending", () => {
    const { html } = render({ busy: true });
    expect(html).toMatch(/<select[^>]*disabled/);
  });

  it("has the add-person search and the role legend", () => {
    const { html, text } = render();
    expect(html).toContain('placeholder="Add a workspace member by name or email"');
    expect(html).toContain('aria-label="Find a workspace member to add"');
    expect(text).toContain("Owners change settings and members. Members edit lists and cards. Observers only read.");
  });

  it("shows matches as buttons, leaving out people already on the board", () => {
    const workspace = [
      ws(2, "Bob Tran", "u2@example.com"),
      ws(3, "Cara Nguyen", "cara@example.com"),
    ];
    const { html, text } = render({ workspace, query: "a" });
    expect(html).toContain('class="matches"');
    expect(text).toContain("Cara Nguyen cara@example.com");
    expect(html).toMatch(/<button[^>]*class="item"[^>]*>[\s\S]*Cara Nguyen/);
    expect(html).not.toMatch(/class="item"[^>]*>[\s\S]*Bob Tran[\s\S]*<\/button><\/div>/);
  });

  it("says nobody matches when the search finds no one", () => {
    const { text } = render({ query: "zzz" });
    expect(text).toContain(
      "Nobody in the workspace matches. People join the workspace the first time they sign in to Taskboard; then you can add them here.",
    );
  });

  it("shows no matches box for a blank query", () => {
    const { html, text } = render();
    expect(html).not.toContain("matches");
    expect(text).not.toContain("Nobody in the workspace matches");
  });

  it("has the archive box for an owner, with the prototype's words", () => {
    const { html, text } = render();
    expect(html).toContain('class="dangerbox"');
    expect(text).toContain("Archive this board");
    expect(text).toContain("Hides the board from everyone. You can restore it later.");
    expect(html).toMatch(/<button[^>]*>Archive board…<\/button>/);
    expect(text).not.toContain("Everyone loses access");
  });

  it("asks to confirm before archiving", () => {
    const { html, text } = render({ confirmArchive: true });
    expect(text).toContain(
      "Archive Office move? Everyone loses access until an owner or admin restores it from Archived boards on the Boards page.",
    );
    expect(html).toMatch(/<button[^>]*>Archive board<\/button>/);
    expect(html).toMatch(/<button[^>]*>Cancel<\/button>/);
    expect(text).not.toContain("Hides the board from everyone");
  });

  it("disables the confirm button while the server answers", () => {
    const { html } = render({ confirmArchive: true, busy: true });
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Archive board<\/button>/);
  });
});

describe("BoardSettingsView read-only", () => {
  const readOnly = (role: "member" | "observer") => render({ board: board({ my_role: role }) });

  it.each(["member", "observer"] as const)("is Board info with a banner for a %s", (role) => {
    const { html, text } = readOnly(role);
    expect(text).toContain("Board info");
    expect(text).not.toContain("Board settings");
    expect(html).toContain('class="banner"');
    expect(text).toContain("Only board owners can change these settings.");
  });

  it.each(["member", "observer"] as const)("has no archive box for a %s", (role) => {
    const { html, text } = readOnly(role);
    expect(html).not.toContain("dangerbox");
    expect(text).not.toContain("Archive this board");
    expect(text).not.toContain("Archive board");
  });

  it("disables the name and the visibility radios", () => {
    const { html } = readOnly("member");
    expect(html).toMatch(/<input[^>]*id="bs-name"[^>]*disabled/);
    for (const m of html.match(/<input[^>]*type="radio"[^>]*>/g) ?? []) {
      expect(m).toContain("disabled");
    }
  });

  it("shows role chips instead of selects, and no add-person search", () => {
    const { html, text } = readOnly("observer");
    expect(html).not.toContain("<select");
    expect(html).toContain('<span class="chip">Owner</span>');
    expect(html).toContain('<span class="chip">Member</span>');
    expect(html).not.toContain("add-person");
    expect(text).not.toContain("Remove from board");
    expect(text).not.toContain("Owners change settings and members");
  });
});

describe("BoardSettingsView member list states", () => {
  it("shows a skeleton while the members load", () => {
    const { html } = render({ peopleState: "loading", people: [] });
    expect(html).toContain('aria-busy="true"');
  });

  it("shows an error line with Try again if the members could not load", () => {
    const { html, text } = render({ peopleState: "error", people: [] });
    expect(text).toContain("Couldn't load the member list.");
    expect(html).toMatch(/<button[^>]*>Try again<\/button>/);
  });
});
