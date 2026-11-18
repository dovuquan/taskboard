import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppView } from "./App";

const user = { id: 1, email: "ann@example.com", name: "Ann Lee", avatar_url: null, role: "admin" } as const;

describe("AppView", () => {
  it("renders the sign-in screen", () => {
    const html = renderToString(
      <AppView screen="signin" domain="example.com" reason={null} user={null} memberCount={null} />,
    );
    expect(html).toContain("<h1>Sign in</h1>");
  });

  it("renders the boards screen with the app bar", () => {
    const html = renderToString(
      <AppView screen="boards" domain="example.com" reason={null} user={user} memberCount={2} />,
    );
    expect(html).toContain("<h1>Boards</h1>");
    expect(html).toContain("Ann Lee");
  });
});
