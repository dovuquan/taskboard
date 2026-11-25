/**
 * A small Markdown reader for card descriptions: paragraphs, "- " lists, **bold**, *italic*,
 * `code`, [text](url) and bare http(s) addresses. It returns plain data; the React side turns it
 * into elements, so no text is ever read as HTML. Every step moves forward, and each search for a
 * closing mark is remembered, so hostile text costs time in proportion to its length.
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "bold"; c: Inline[] }
  | { t: "italic"; c: Inline[] }
  | { t: "code"; v: string }
  /** `label` is null when the address itself is the text to show. */
  | { t: "link"; href: string; label: string | null };

export type Block = { t: "p"; c: Inline[] } | { t: "ul"; items: Inline[][] };

/** Addresses longer than this stay plain text; it also bounds the work for each candidate. */
const MAX_URL = 2048;

/**
 * The address to link, or null. Only a literal lowercase `http://` or `https://` with a host,
 * no user name or password and no space, quote or angle bracket; the browser's own URL reader
 * has the last word on the scheme.
 */
export function safeHref(url: string): string | null {
  if (url.length > MAX_URL || !/^https?:\/\//.test(url) || /[\s"<>]/.test(url)) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.username || u.password || !u.hostname) return null;
    return u.href;
  } catch {
    return null;
  }
}

/** "host/start-of-path…": the host without a leading www, then at most 22 characters of the rest. */
export function shortUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  const rest = u.pathname + u.search + u.hash;
  const tail = rest === "/" ? "" : rest;
  return u.host.replace(/^www\./, "") + (tail.length > 22 ? `${tail.slice(0, 22)}…` : tail);
}

/**
 * The text to show for a `[label](href)` link, or null to show the address itself. The label is
 * read the way the eye reads it: compatibility forms (fullwidth dots and slashes) become the plain
 * characters, format characters (zero width, bidi controls) are removed and the ends trimmed. A label
 * that is empty then, or that looks like an address, is no label. Any other label is followed by the
 * real host of `href` in brackets, unless it already is that host or the short address shown for it.
 */
export function linkLabel(raw: string, href: string): string | null {
  const label = raw.normalize("NFKC").replace(/\p{Cf}/gu, "").trim();
  if (label === "" || LOOKS_LIKE_URL.test(label)) return null;
  let host: string;
  try {
    host = new URL(href).host;
  } catch {
    return null;
  }
  const same = label.toLowerCase();
  if (same === host.toLowerCase() || same === shortUrl(href).toLowerCase()) return label;
  return `${label} (${host})`;
}

/** Finds the next `marker` at or after `from`, remembering the answer for monotone callers. */
function finder(src: string): (marker: string, from: number) => number {
  const last = new Map<string, number>();
  return (marker, from) => {
    const hit = last.get(marker);
    // The earlier search started at or before `from` and found the first match after it (or none),
    // so nothing lies between `from` and that match.
    if (hit !== undefined && (hit === -1 || hit >= from)) return hit;
    const found = src.indexOf(marker, from);
    last.set(marker, found);
    return found;
  };
}

const BOUNDARY = /[\s([{>"'*:;,!?]/;
const LOOKS_LIKE_URL = /:\/\/|^www\./i;

function isStop(code: number): boolean {
  // whitespace, <, >, "
  return code <= 32 || code === 60 || code === 62 || code === 34 || code === 0xa0;
}

function parseInline(src: string, bold: boolean, italic: boolean): Inline[] {
  const out: Inline[] = [];
  const n = src.length;
  const next = finder(src);
  const links = new Map<number, { href: string; end: number } | null>();
  let text = "";
  let i = 0;

  const flush = () => {
    if (text) {
      out.push({ t: "text", v: text });
      text = "";
    }
  };

  /** The `(url)` after the `]` at `close`, checked once however many `[` point at it. */
  const linkAfter = (close: number) => {
    if (links.has(close)) return links.get(close) ?? null;
    let found: { href: string; end: number } | null = null;
    const start = close + 2;
    if (src.startsWith("http://", start) || src.startsWith("https://", start)) {
      const end = next(")", start);
      const href = end > 0 && end - start <= MAX_URL ? safeHref(src.slice(start, end)) : null;
      if (href) found = { href, end };
    }
    links.set(close, found);
    return found;
  };

  while (i < n) {
    const ch = src[i];
    if (ch === "`") {
      const j = next("`", i + 1);
      if (j > i + 1) {
        flush();
        out.push({ t: "code", v: src.slice(i + 1, j) });
        i = j + 1;
        continue;
      }
    } else if (ch === "*") {
      if (src[i + 1] === "*") {
        const j = bold ? next("**", i + 2) : -1;
        if (j > i + 2) {
          flush();
          out.push({ t: "bold", c: parseInline(src.slice(i + 2, j), false, italic) });
          i = j + 2;
          continue;
        }
      } else if (italic) {
        const j = next("*", i + 1);
        if (j > i + 1) {
          flush();
          out.push({ t: "italic", c: parseInline(src.slice(i + 1, j), false, false) });
          i = j + 1;
          continue;
        }
      }
    } else if (ch === "[") {
      const close = next("]", i + 1);
      const link = close > 0 && src[close + 1] === "(" ? linkAfter(close) : null;
      if (link) {
        const label = src.slice(i + 1, close);
        flush();
        out.push({ t: "link", href: link.href, label: linkLabel(label, link.href) });
        i = link.end + 1;
        continue;
      }
    } else if (
      ch === "h" &&
      (i === 0 || BOUNDARY.test(src[i - 1])) &&
      (src.startsWith("http://", i) || src.startsWith("https://", i))
    ) {
      let end = i;
      while (end < n && end - i <= MAX_URL && !isStop(src.charCodeAt(end))) end++;
      if (end - i <= MAX_URL) {
        while (end > i && ".,;:!?)".includes(src[end - 1])) end--;
        const href = safeHref(src.slice(i, end));
        if (href) {
          flush();
          out.push({ t: "link", href, label: null });
          i = end;
          continue;
        }
      }
    }
    text += ch;
    i++;
  }
  flush();
  return out;
}

/** Reads a description. Each non-empty line is a paragraph; consecutive "- " lines are one list. */
export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  let list: Inline[][] | null = null;
  const close = () => {
    if (list && list.length) blocks.push({ t: "ul", items: list });
    list = null;
  };
  for (const line of src.split(/\r?\n/)) {
    if (line.startsWith("- ")) {
      list ??= [];
      const item = line.slice(2);
      if (item.trim()) list.push(parseInline(item, true, true));
      continue;
    }
    close();
    if (line.trim()) blocks.push({ t: "p", c: parseInline(line, true, true) });
  }
  close();
  return blocks;
}
