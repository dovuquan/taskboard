import { describe, expect, it } from "vitest";

import { type Block, type Inline, linkify, parseMarkdown, safeHref, shortUrl } from "./markdown";

const t = (v: string): Inline => ({ t: "text", v });

/** The inline content of a one-paragraph document. */
function inline(src: string): Inline[] {
  const blocks = parseMarkdown(src);
  expect(blocks).toHaveLength(1);
  const block = blocks[0];
  if (block.t !== "p") throw new Error("expected a paragraph");
  return block.c;
}

/** What the reader sees as text, markers and link labels included. */
function flat(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.t) {
        case "text":
        case "code":
          return n.v;
        case "bold":
        case "italic":
          return flat(n.c);
        case "link":
          return n.label ?? n.href;
      }
    })
    .join("");
}

function links(nodes: Inline[]): string[] {
  return nodes.flatMap((n) =>
    n.t === "link" ? [n.href] : n.t === "bold" || n.t === "italic" ? links(n.c) : [],
  );
}

describe("blocks", () => {
  it("makes a paragraph of each non-empty line and skips blank lines", () => {
    const blocks = parseMarkdown("one\n\n  \ntwo\r\nthree");
    expect(blocks.map((b) => (b.t === "p" ? flat(b.c) : "list"))).toEqual(["one", "two", "three"]);
  });

  it("groups consecutive '- ' lines into one list", () => {
    const blocks = parseMarkdown("intro\n- a\n- b\n\n- c\nafter");
    expect(blocks.map((b) => b.t)).toEqual(["p", "ul", "ul", "p"]);
    const first = blocks[1] as Extract<Block, { t: "ul" }>;
    expect(first.items.map(flat)).toEqual(["a", "b"]);
    expect((blocks[2] as Extract<Block, { t: "ul" }>).items.map(flat)).toEqual(["c"]);
  });

  it("needs the space after the dash", () => {
    expect(parseMarkdown("-a")[0].t).toBe("p");
    expect(parseMarkdown("-")[0].t).toBe("p");
  });

  it("returns nothing for empty text", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown(" \n\n ")).toEqual([]);
  });
});

describe("inline formatting", () => {
  it("reads bold, italic and code", () => {
    expect(inline("a **b** c *d* e `f` g")).toEqual([
      t("a "),
      { t: "bold", c: [t("b")] },
      t(" c "),
      { t: "italic", c: [t("d")] },
      t(" e "),
      { t: "code", v: "f" },
      t(" g"),
    ]);
  });

  it("lets italic and code sit inside bold", () => {
    expect(inline("**a *b* `c`**")).toEqual([
      { t: "bold", c: [t("a "), { t: "italic", c: [t("b")] }, t(" "), { t: "code", v: "c" }] },
    ]);
  });

  it("keeps formatting marks inside code as they are", () => {
    expect(inline("`**x**`")).toEqual([{ t: "code", v: "**x**" }]);
  });

  it("leaves a lone marker as text", () => {
    expect(flat(inline("2 * 3 and `open"))).toBe("2 * 3 and `open");
    expect(flat(inline("****"))).toBe("****");
    expect(flat(inline("a ** b"))).toBe("a ** b");
  });

  it("shows tag-like text as text", () => {
    expect(inline("<script>alert(1)</script>")).toEqual([t("<script>alert(1)</script>")]);
    expect(inline('<img src=x onerror="alert(1)">')).toEqual([t('<img src=x onerror="alert(1)">')]);
  });
});

describe("links", () => {
  it("reads [text](url) with http and https", () => {
    expect(inline("see [the docs](https://example.com/a/b)!")).toEqual([
      t("see "),
      { t: "link", href: "https://example.com/a/b", label: "the docs (example.com)" },
      t("!"),
    ]);
    expect(links(inline("[x](http://example.com/)"))).toEqual(["http://example.com/"]);
  });

  it("never links another scheme and keeps the text as written", () => {
    for (const src of [
      "[x](javascript:alert(1))",
      "[x](JavaScript:alert(1))",
      "[x]( javascript:alert(1))",
      "[x](data:text/html,hi)",
      "[x](vbscript:run)",
      "[x](//evil.example/path)",
      "[x](/relative)",
      "[x](mailto:a@example.com)",
      "[x](ftp://example.com/f)",
      "[x](HTTPS://example.com)",
      "[x](http:example.com)",
      "[x](https://)",
    ]) {
      const nodes = inline(src);
      expect(links(nodes), src).toEqual([]);
      expect(flat(nodes), src).toBe(src);
    }
  });

  it("never puts a space, quote or angle bracket into an address", () => {
    for (const src of [
      "[x](https://example.com/a b)",
      '[x](https://example.com/"onclick")',
      "[x](https://example.com/<b>)",
    ]) {
      for (const href of links(inline(src))) {
        expect(href, src).not.toMatch(/["<> ]/);
        expect(safeHref(href), src).toBe(href);
      }
    }
  });

  it("does not link an address with a user name or password", () => {
    expect(links(inline("[x](https://user:pw@example.com/)"))).toEqual([]);
    expect(links(inline("https://user@example.com/"))).toEqual([]);
  });

  it("links bare http and https addresses", () => {
    expect(inline("go to https://example.com/x now")).toEqual([
      t("go to "),
      { t: "link", href: "https://example.com/x", label: null },
      t(" now"),
    ]);
    expect(links(inline("http://example.com"))).toEqual(["http://example.com/"]);
  });

  it("leaves closing punctuation out of a bare address", () => {
    expect(inline("(see https://example.com/a).")).toEqual([
      t("(see "),
      { t: "link", href: "https://example.com/a", label: null },
      t(")."),
    ]);
    expect(links(inline("https://example.com/a, https://example.com/b!"))).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });

  it("does not link a bare scheme or another scheme", () => {
    expect(links(inline("http:// and https://"))).toEqual([]);
    expect(links(inline("javascript:alert(1) and ftp://example.com"))).toEqual([]);
  });

  it("shows the address, not a label that looks like another address", () => {
    const [node] = inline("[https://bank.example](https://evil.example/login)");
    expect(node).toEqual({ t: "link", href: "https://evil.example/login", label: null });
    const [www] = inline("[www.bank.example](https://evil.example/)");
    expect(www).toMatchObject({ t: "link", label: null });
  });

  describe("a label never hides the real host", () => {
    /** The label of the one link in `src`; the test fails if there is not exactly one link. */
    function labelOf(src: string): string | null {
      const nodes = inline(src);
      const found = nodes.filter((n) => n.t === "link");
      expect(found, src).toHaveLength(1);
      const [link] = found;
      if (link.t !== "link") throw new Error("expected a link");
      return link.label;
    }

    it("adds the host from the address after any custom label", () => {
      expect(labelOf("[accounts.google.com](https://evil.example)")).toBe(
        "accounts.google.com (evil.example)",
      );
      expect(labelOf("[Sign in here](https://evil.example/login?x=1)")).toBe("Sign in here (evil.example)");
    });

    it("sees through a leading or trailing space", () => {
      expect(labelOf("[ accounts.google.com](https://evil.example)")).toBe("accounts.google.com (evil.example)");
      expect(labelOf("[accounts.google.com  ](https://evil.example)")).toBe("accounts.google.com (evil.example)");
    });

    it("strips zero-width characters from the label", () => {
      expect(labelOf("[accounts​.google⁠.com](https://evil.example)")).toBe(
        "accounts.google.com (evil.example)",
      );
      expect(labelOf("[﻿accounts.google.com](https://evil.example)")).toBe("accounts.google.com (evil.example)");
    });

    it("reads fullwidth characters as the plain ones they imitate", () => {
      // Fullwidth dots: shown plainly, with the real host after it.
      expect(labelOf("[accounts．google．com](https://evil.example)")).toBe(
        "accounts.google.com (evil.example)",
      );
      expect(labelOf("[accounts.google.com／login](https://evil.example)")).toBe(
        "accounts.google.com/login (evil.example)",
      );
      // Fullwidth "https://" is an address-looking label, so the real address is shown instead.
      expect(labelOf("[https：／／accounts.google.com](https://evil.example)")).toBeNull();
    });

    it("removes bidi controls so the label cannot be shown reversed", () => {
      const label = labelOf("[‮moc.elgoog.stnuocca‬](https://evil.example)");
      expect(label).toBe("moc.elgoog.stnuocca (evil.example)");
      expect(label).not.toMatch(/\p{Cf}/u);
      for (const mark of ["‪", "‫", "‭", "⁦", "⁧", "⁨", "⁩", "‎", "‏"]) {
        expect(labelOf(`[a${mark}b](https://evil.example)`), mark).toBe("ab (evil.example)");
      }
    });

    it("treats a label that is empty once the invisible parts are gone as no label", () => {
      for (const src of [
        "[​](https://evil.example)",
        "[​⁠﻿](https://evil.example)",
        "[‮](https://evil.example)",
        "[ 　 ](https://evil.example)",
        "[](https://evil.example)",
      ]) {
        expect(labelOf(src), src).toBeNull();
      }
    });

    it("keeps www in the host it adds", () => {
      expect(labelOf("[the docs](https://www.example.com/a)")).toBe("the docs (www.example.com)");
    });

    it("keeps a port in the host it adds", () => {
      expect(labelOf("[the docs](https://example.com:8443/a)")).toBe("the docs (example.com:8443)");
    });

    it("skips the host when the label already is the host, in any case", () => {
      expect(labelOf("[example.com](https://example.com/a)")).toBe("example.com");
      expect(labelOf("[Example.COM](https://example.com/a)")).toBe("Example.COM");
      expect(labelOf("[ example.com​ ](https://example.com/a)")).toBe("example.com");
    });

    it("skips the host when the label is the short address shown for it", () => {
      expect(labelOf("[example.com/a](https://www.example.com/a)")).toBe("example.com/a");
    });

    it("still adds the host when the label only resembles the host", () => {
      expect(labelOf("[example.com](https://example.com.evil.example/a)")).toBe(
        "example.com (example.com.evil.example)",
      );
      expect(labelOf("[www.example.com/a](https://example.com/b)")).toBeNull();
    });
  });

  it("finds links inside bold text and list items", () => {
    expect(links(inline("**read https://example.com/a**"))).toEqual(["https://example.com/a"]);
    const list = parseMarkdown("- [a](https://example.com/1)")[0] as Extract<Block, { t: "ul" }>;
    expect(links(list.items[0])).toEqual(["https://example.com/1"]);
  });
});

describe("safeHref", () => {
  it("accepts http and https only", () => {
    expect(safeHref("https://example.com/a")).toBe("https://example.com/a");
    expect(safeHref("http://example.com")).toBe("http://example.com/");
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,x",
    "file:///etc/passwd",
    "ftp://example.com",
    "//example.com",
    "example.com",
    "https://user@example.com/",
    "https://example.com/a b",
    "",
  ])("refuses %s", (url) => {
    expect(safeHref(url)).toBeNull();
  });
});

describe("shortUrl", () => {
  it("shows the host and the start of the path", () => {
    expect(shortUrl("https://example.com/")).toBe("example.com");
    expect(shortUrl("https://example.com/docs")).toBe("example.com/docs");
  });

  it("drops a leading www", () => {
    expect(shortUrl("https://www.example.com/a")).toBe("example.com/a");
  });

  it("cuts a long path after 22 characters", () => {
    const url = "https://example.com/docs/guide/install-steps/with-a-very-long-tail?x=1#top";
    expect(shortUrl(url)).toBe("example.com/docs/guide/install-st…");
  });

  it("keeps a path of exactly 22 characters whole", () => {
    expect(shortUrl("https://example.com/" + "a".repeat(21))).toBe("example.com/" + "a".repeat(21));
    expect(shortUrl("https://example.com/" + "a".repeat(22))).toBe(
      "example.com/" + "a".repeat(21) + "…",
    );
  });

  it("shows the real host when the address has a trick in front of it", () => {
    expect(shortUrl("https://example.com.evil.example/x")).toBe("example.com.evil.example/x");
  });
});

describe("hostile input stays fast", () => {
  const SIZE = 100_000;

  const cases: [string, string][] = [
    ["open brackets", "[".repeat(SIZE)],
    ["brackets with one end", "[".repeat(SIZE / 2) + "]"],
    ["open links", "[a](".repeat(SIZE / 4)],
    ["links with no end", "[a](https://example.com/".repeat(SIZE / 24)],
    ["stars", "*".repeat(SIZE)],
    ["double stars", "** ".repeat(SIZE / 3)],
    ["alternating marks", "**a *b ".repeat(SIZE / 7)],
    ["backticks", "`".repeat(SIZE)],
    ["spaced backticks", "` ".repeat(SIZE / 2)],
    ["schemes", "http://".repeat(SIZE / 7)],
    ["long address", "https://example.com/" + "a".repeat(SIZE - 20)],
    ["many long-ish addresses", ("(https://example.com/" + "a".repeat(2000) + " ").repeat(SIZE / 2030)],
    ["bad addresses", "(http://@".repeat(SIZE / 9)],
    ["list dashes", "- ".repeat(SIZE / 2)],
    ["many lines", "- a\n".repeat(SIZE / 4)],
    ["tags", "<script>".repeat(SIZE / 8)],
    ["mixed", "[**`https://".repeat(SIZE / 12)],
    ["a label of invisible characters", "[" + "​".repeat(SIZE - 30) + "](https://example.com/)"],
    ["a label of bidi controls", "[a‮".repeat(SIZE / 40) + "](https://example.com/)"],
    ["many links with invisible labels", "[​](https://example.com/)".repeat(SIZE / 28)],
  ];

  it.each(cases)("parses %s", (_name, src) => {
    expect(src.length).toBeLessThanOrEqual(SIZE);
    const start = performance.now();
    parseMarkdown(src);
    expect(performance.now() - start).toBeLessThan(1500);
  });

  it("parses the 10,000 characters a description may hold", () => {
    const src = "[**`https://".repeat(900).slice(0, 10_000);
    const start = performance.now();
    parseMarkdown(src);
    expect(performance.now() - start).toBeLessThan(200);
  });
});

describe("linkify", () => {
  it("leaves plain text as one text node, markers and line breaks included", () => {
    expect(linkify("**not bold** `not code`\nsecond line")).toEqual([t("**not bold** `not code`\nsecond line")]);
    expect(linkify("")).toEqual([]);
  });

  it("turns a bare http(s) address into a link and keeps the words around it", () => {
    expect(linkify("see https://example.com/docs/guide now")).toEqual([
      t("see "),
      { t: "link", href: "https://example.com/docs/guide", label: null },
      t(" now"),
    ]);
  });

  it("does not take closing punctuation into the address", () => {
    expect(linkify("(https://example.com/a), ok")).toEqual([
      t("("),
      { t: "link", href: "https://example.com/a", label: null },
      t("), ok"),
    ]);
  });

  it("finds several links", () => {
    const nodes = linkify("http://a.example/x https://b.example/y");
    expect(nodes.filter((n) => n.t === "link")).toHaveLength(2);
  });

  it.each([
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "data:text/html,hi",
    "ftp://example.com/file",
    "HTTPS://example.com/",
    "https://user:pw@example.com/",
    "http:// bad",
  ])("never makes a link of %s", (src) => {
    expect(linkify(src).every((n) => n.t === "text")).toBe(true);
    expect(linkify(`go to ${src} now`).every((n) => n.t === "text")).toBe(true);
  });

  it("does not read a [label](address) as a labelled link", () => {
    const nodes = linkify("[click me](javascript:alert(1))");
    expect(nodes.every((n) => n.t === "text")).toBe(true);
  });

  it("parses 5,000 characters of hostile text quickly", () => {
    const start = performance.now();
    linkify("http://".repeat(700).slice(0, 5000));
    linkify(" https://example.com/".repeat(250));
    expect(performance.now() - start).toBeLessThan(500);
  });
});
