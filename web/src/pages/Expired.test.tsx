import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Expired } from "./Expired";

describe("Expired", () => {
  const html = renderToString(<Expired />);
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

  it("explains that the session ended", () => {
    expect(text).toContain("Your session has ended");
    expect(text).toContain(
      "Taskboard signs you out after 14 days. Sign in again to carry on. Nothing you saved is lost.",
    );
  });

  it("links Sign in again with Google to the login route", () => {
    expect(html).toMatch(
      /<a[^>]*href="\/auth\/login"[^>]*>[\s\S]*Sign in again with Google[\s\S]*<\/a>/,
    );
  });
});
