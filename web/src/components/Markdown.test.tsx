import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Markdown } from "./Markdown";

const html = (source: string) => renderToString(<Markdown source={source} />);

describe("Markdown", () => {
  it("renders paragraphs, a list and the three marks", () => {
    const out = html("Hello **bold** and *it* and `code`\n- one\n- two");
    expect(out).toContain("<p>Hello <strong>bold</strong> and <em>it</em> and <code>code</code></p>");
    expect(out).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(out.startsWith('<div class="md">')).toBe(true);
  });

  it("shows script text as text", () => {
    const out = html("<script>alert(1)</script>");
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(out).not.toContain("<script");
  });

  it("shows tag attributes as text, never as attributes", () => {
    const out = html('<img src=x onerror="alert(1)"> **<b onclick=x>y</b>**');
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<b ");
    expect(out).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("never makes a link of javascript: or another scheme", () => {
    for (const src of [
      "[x](javascript:alert(1))",
      "[x](JAVASCRIPT:alert(1))",
      "[x](data:text/html;base64,AAAA)",
      "javascript:alert(1)",
      "[x](vbscript:y)",
    ]) {
      const out = html(src);
      expect(out, src).not.toContain("<a");
      expect(out, src).not.toContain("href");
    }
    expect(html("[x](javascript:alert(1))")).toContain("[x](javascript:alert(1))");
  });

  it("gives a link new-tab attributes, a short text and the full address in the title", () => {
    const out = html("[docs](https://www.example.com/docs/guide/install-steps/with-a-very-long-tail?x=1)");
    expect(out).toContain('href="https://www.example.com/docs/guide/install-steps/with-a-very-long-tail?x=1"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain(
      'title="https://www.example.com/docs/guide/install-steps/with-a-very-long-tail?x=1"',
    );
    expect(out).toContain(">docs</a>");
  });

  it("shows a bare address as host and the start of the path", () => {
    const out = html("see https://www.example.com/docs/guide/install-steps/with-a-very-long-tail now");
    expect(out).toContain(">example.com/docs/guide/install-st…</a>");
    expect(out).toContain('href="https://www.example.com/docs/guide/install-steps/with-a-very-long-tail"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it("shows the real address when a label pretends to be another one", () => {
    const out = html("[https://bank.example](https://evil.example/login)");
    expect(out).toContain(">evil.example/login</a>");
    expect(out).not.toContain(">https://bank.example<");
  });

  it("escapes quotes in an address that reaches an attribute", () => {
    const out = html('https://example.com/a"onmouseover="x');
    expect(out).not.toContain('"onmouseover');
    expect(out).not.toMatch(/<[^>]*onmouseover/);
  });

  it("renders 10,000 hostile characters without trouble", () => {
    const out = html("[**`https://".repeat(900).slice(0, 10_000));
    expect(out.length).toBeGreaterThan(0);
  });

  it("renders nothing for empty text", () => {
    expect(html("")).toBe('<div class="md"></div>');
  });
});

describe("no raw HTML anywhere in the web app", () => {
  const sources = import.meta.glob("../**/*.{ts,tsx}", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;

  it("scans the source files", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20);
  });

  it("never uses dangerouslySetInnerHTML, innerHTML or outerHTML", () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => !path.includes(".test."))
      .filter(([, text]) => /dangerouslySetInnerHTML|\.innerHTML|\.outerHTML|insertAdjacentHTML/.test(text))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
