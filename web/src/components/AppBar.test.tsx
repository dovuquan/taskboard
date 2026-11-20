import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Me } from "../api";
import { AppBar, AppBarView } from "./AppBar";

const ann: Me = {
  id: 1,
  email: "ann@example.com",
  name: "Ann Lee",
  avatar_url: null,
  role: "admin",
};

function render(user: Me, screen?: "boards" | "members" | "board", boardName?: string | null) {
  const html = renderToString(<AppBar user={user} screen={screen} boardName={boardName} />);
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
  return { html, text };
}

describe("AppBar", () => {
  it("links the brand and Boards to /boards", () => {
    const { html } = render(ann);
    expect(html).toMatch(/<a[^>]*href="\/boards"[^>]*>[\s\S]*Taskboard[\s\S]*<\/a>/);
    expect(html).toMatch(/<a[^>]*href="\/boards"[^>]*>\s*Boards\s*<\/a>/);
  });

  it("has a Breadcrumb nav between the brand and the spacer", () => {
    const { html } = render(ann);
    expect(html).toContain(
      '</a><nav class="crumbs" aria-label="Breadcrumb"><span>/</span><span>Boards</span></nav><span class="spacer">',
    );
  });

  it("titles the avatar with the name, or the email without one", () => {
    expect(render(ann).html).toContain('<span class="avatar lg" title="Ann Lee">AL</span>');
    expect(render({ ...ann, name: null, email: "zed@example.com" }).html).toContain(
      'title="zed@example.com"',
    );
  });

  it("shows the name, initials and workspace admin label", () => {
    const { text } = render(ann);
    expect(text.trim()).toBe("Taskboard / Boards Boards Members AL Ann Lee Workspace admin");
  });

  it("shows the workspace member label for members", () => {
    const { text } = render({ ...ann, role: "member" });
    expect(text.trim()).toBe("Taskboard / Boards Boards AL Ann Lee Workspace member");
  });

  it("falls back to the email's first letter when there is no name", () => {
    const { text } = render({ ...ann, name: null, email: "zed@example.com" });
    expect(text.trim()).toBe("Taskboard / Boards Boards Members Z zed@example.com Workspace admin");
  });

  it("links Members to /members for admins, with Boards active by default", () => {
    const { html } = render(ann);
    expect(html).toContain('<a class="navlink on" href="/boards">Boards</a>');
    expect(html).toContain('<a class="navlink" href="/members">Members</a>');
  });

  it("has no Members link for members", () => {
    const { html, text } = render({ ...ann, role: "member" });
    expect(text).not.toContain("Members");
    expect(html).not.toContain("/members");
  });

  it("marks Members active and follows the screen in the breadcrumb", () => {
    const { html } = render(ann, "members");
    expect(html).toContain('<a class="navlink" href="/boards">Boards</a>');
    expect(html).toContain('<a class="navlink on" href="/members">Members</a>');
    expect(html).toContain(
      '<nav class="crumbs" aria-label="Breadcrumb"><span>/</span><span>Members</span></nav>',
    );
  });

  it("shows Boards / {name} on a board, with Boards linking back", () => {
    const { html } = render(ann, "board", "Office move");
    expect(html).toContain(
      '<nav class="crumbs" aria-label="Breadcrumb"><span>/</span><a href="/boards">Boards</a><span>/</span><span>Office move</span></nav>',
    );
    expect(html).toContain('<a class="navlink on" href="/boards">Boards</a>');
  });

  it("shows just Boards on a board whose name has not loaded", () => {
    const { html } = render(ann, "board", null);
    expect(html).toContain(
      '<nav class="crumbs" aria-label="Breadcrumb"><span>/</span><a href="/boards">Boards</a></nav>',
    );
  });

  it("escapes a board name in the breadcrumb", () => {
    const { html } = render(ann, "board", "<b>x</b>");
    expect(html).toContain("<span>&lt;b&gt;x&lt;/b&gt;</span>");
  });

  it("has no shortcuts button yet", () => {
    expect(render(ann).html.toLowerCase()).not.toContain("shortcuts");
  });

  it("makes the avatar and name a closed account menu button", () => {
    const { html } = render(ann);
    expect(html).toMatch(
      /<button[^>]*class="me"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"[^>]*aria-label="Account menu for Ann Lee"/,
    );
    expect(html).not.toContain('role="menu"');
    expect(html).not.toContain("Sign out");
  });

  it("shows Sign out in the open menu", () => {
    const html = renderToString(
      <AppBarView
        user={ann}
        screen="boards"
        open
        onToggle={() => {}}
        onSignOut={() => {}}
      />,
    );
    expect(html).toMatch(/aria-expanded="true"[^>]*aria-controls="account-menu"/);
    expect(html).toMatch(
      /<div[^>]*id="account-menu"[^>]*role="menu"[^>]*>[\s\S]*<button[^>]*role="menuitem"[^>]*>[\s\S]*Sign out[\s\S]*<\/button>/,
    );
  });
});
