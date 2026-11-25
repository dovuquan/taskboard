"""Clean Markdown source before it is stored (standard library only).

The result is still Markdown source, never HTML. It never holds a tag-like `<x`, and every link,
image or reference definition that keeps a destination points at `http://` or `https://`.
Every pattern is linear-time (no nested quantifiers); the scans that could restart at each
character are bounded or single-pass, so 10,000 hostile characters stay fast.
"""

import re

MAX_CHARS = 10_000
_PASSES = 30  # tags and links can only expose each other a few times; this is a safety stop
_DEST_SCAN = 4_096  # how far a link destination is read when it has to be cut out

_SURROGATE = re.compile("[\ud800-\udfff]")
_CONTROL = re.compile("[\x00-\x08\x0b-\x1f\x7f-\x9f]")  # every Cc but tab and newline
_AUTOLINK = re.compile(r"<(https?://[^\s<>]+)>", re.IGNORECASE)
_TOKEN = re.compile(r"[<>]|[^<>]+")
_TAG_START = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz/!?")
_NAME = re.compile(r"[A-Za-z][A-Za-z0-9]*")
_CLOSERS = {
    name: re.compile(rf"</{name}(?=[\s/>])[^<>]*>", re.IGNORECASE) for name in ("script", "style")
}
_LEFTOVER_OPEN = re.compile(r"<(?=[A-Za-z/!?])")
_HTTP = re.compile(r"https?://", re.IGNORECASE)
_BAD_LINK_OPEN = re.compile(r"\]\((?!https?://)", re.IGNORECASE)
_PLAIN = re.compile(r"[^\[\]]+")

# `](` + optional blanks + destination (one level of balanced parentheses) + optional title + `)`
_DEST = re.compile(
    r"""
    \s*
    (?:[^\s()]|\([^\s()]*\))*
    (?:\s+(?:"[^"]*"|'[^']*'|\([^()]*\)))?
    \s*\)
    """,
    re.VERBOSE,
)
# A reference definition, also inside quotes and list items: `[label]: destination ...`.
_DEFINITION = re.compile(
    r"""
    ^(?P<prefix>[ \t>*+\-]*(?:\d{1,9}[.)][ \t>*+\-]*)*)
    \[[^\[\]]{1,999}\]:
    [ \t]*(?:\n[ \t>]*)?
    (?P<dest>\S+)
    [^\n]*
    (?P<end>\n|\Z)
    """,
    re.VERBOSE | re.MULTILINE,
)


class MarkdownError(ValueError):
    """The text cannot be stored."""


def _strip_tags(text: str) -> str:
    """Remove every `<[A-Za-z/!?][^<>]*>`, and `script`/`style` elements with their content.

    One left-to-right pass with a stack of open brackets reaches the same result as repeating
    the removal until nothing changes: a removed tag can join its neighbours into a new tag,
    which the next `>` then finds on the stack.
    """
    out: list[str] = []
    opens: list[int] = []  # indexes in `out` of `<` tokens with no `<` or `>` after them
    pos = 0
    while pos < len(text):
        token = _TOKEN.match(text, pos)
        assert token is not None  # every character is `<`, `>` or in a run of neither
        piece = token.group()
        pos = token.end()
        if piece == "<":
            opens.append(len(out))
            out.append(piece)
        elif piece != ">":
            out.append(piece)
        elif opens and (at := opens[-1]) + 1 < len(out) and out[at + 1][0] in _TAG_START:
            inner = "".join(out[at + 1 :])
            del out[at:]
            opens.pop()
            name = _NAME.match(inner)
            closer = _CLOSERS.get(name.group().lower()) if name else None
            if closer is not None:
                found = closer.search(text, pos)
                pos = found.end() if found else len(text)
        else:
            out.append(piece)
            opens.clear()  # no earlier `<` can reach a later `>` across this one
    return "".join(out)


def _strip_links(text: str) -> str:
    """Keep only http(s) destinations in links, images and reference definitions."""

    def definition(match: re.Match[str]) -> str:
        if _HTTP.match(match["dest"]):
            return match[0]
        return match["prefix"] + match["end"]

    text = _DEFINITION.sub(definition, text)
    out: list[str] = []
    opens: list[int] = []  # indexes in `out` of `[` tokens not closed yet
    pos, size = 0, len(text)
    while pos < size:
        char = text[pos]
        if char == "[":
            opens.append(len(out))
            out.append(char)
            pos += 1
        elif char != "]":
            plain = _PLAIN.match(text, pos)
            assert plain is not None
            out.append(plain.group())
            pos = plain.end()
        elif text.startswith("(", pos + 1):
            start = pos + 2
            if _HTTP.match(text, start):
                out.append("](")
                pos = start
                if opens:
                    opens.pop()
                continue
            cut = _DEST.match(text, start, min(size, start + _DEST_SCAN))
            if cut is not None and opens:
                at = opens.pop()
                inner = out[at + 1 :]
                del out[at:]
                if out and out[-1].endswith("!"):  # an image: its `!` goes with it
                    out[-1] = out[-1][:-1]
                out.extend(inner)
                pos = cut.end()
            else:
                out.append("] (")  # unreadable or unmatched: it can no longer open a link
                pos = start
                if opens:
                    opens.pop()
        else:
            out.append(char)
            pos += 1
            if opens:
                opens.pop()
    return "".join(out)


def clean_markdown(raw: str) -> str | None:
    """The cleaned Markdown source, or None when nothing is left. Raises `MarkdownError`."""
    if len(raw) > MAX_CHARS:
        raise MarkdownError(f"text is longer than {MAX_CHARS} characters")
    if _SURROGATE.search(raw):
        raise MarkdownError("text contains a lone surrogate")
    text = _CONTROL.sub("", raw.replace("\r\n", "\n").replace("\r", "\n"))
    if not text.strip():
        return None
    text = _AUTOLINK.sub(r"\1", text)
    for _ in range(_PASSES):
        cleaned = _strip_links(_strip_tags(text))
        if cleaned == text:
            break
        text = cleaned
    text = _BAD_LINK_OPEN.sub("] (", _LEFTOVER_OPEN.sub("< ", text))
    if not text.strip():
        return None
    if len(text) > MAX_CHARS:
        raise MarkdownError(f"text is longer than {MAX_CHARS} characters once cleaned")
    return text
