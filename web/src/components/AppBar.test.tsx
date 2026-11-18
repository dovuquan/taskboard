import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Me } from "../api";
import { AppBar } from "./AppBar";

const ann: Me = {
  id: 1,
  email: "ann@example.com",
  name: "Ann Lee",
  avatar_url: null,
  role: "admin",
};

function render(user: Me) {
  const html = renderToString(<AppBar user={user} />);
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
    expect(text.trim()).toBe("Taskboard / Boards Boards AL Ann Lee Workspace admin");
  });

  it("shows the workspace member label for members", () => {
    const { text } = render({ ...ann, role: "member" });
    expect(text.trim()).toBe("Taskboard / Boards Boards AL Ann Lee Workspace member");
  });

  it("falls back to the email's first letter when there is no name", () => {
    const { text } = render({ ...ann, name: null, email: "zed@example.com" });
    expect(text.trim()).toBe("Taskboard / Boards Boards Z zed@example.com Workspace admin");
  });

  it("has no Members link and no shortcuts button yet", () => {
    const { html, text } = render(ann);
    expect(text).not.toContain("Members");
    expect(html).not.toContain("/members");
    expect(html.toLowerCase()).not.toContain("shortcuts");
  });
});
