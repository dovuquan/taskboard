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

  it("shows the name, initials and workspace admin label", () => {
    const { text } = render(ann);
    expect(text).toContain("Ann Lee");
    expect(text).toContain("AL");
    expect(text).toContain("Workspace admin");
  });

  it("shows the workspace member label for members", () => {
    const { text } = render({ ...ann, role: "member" });
    expect(text).toContain("Workspace member");
    expect(text).not.toContain("Workspace admin");
  });

  it("falls back to the email's first letter when there is no name", () => {
    const { text } = render({ ...ann, name: null, email: "zed@example.com" });
    expect(text).toMatch(/(^|\s)Z(\s|$)/);
  });

  it("has no Members link and no shortcuts button yet", () => {
    const { html, text } = render(ann);
    expect(text).not.toContain("Members");
    expect(html).not.toContain("/members");
    expect(html.toLowerCase()).not.toContain("shortcuts");
  });
});
