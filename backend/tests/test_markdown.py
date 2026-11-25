"""The Markdown cleaner: stored source is free of tags and unsafe link destinations."""

import random
import re
import time

import pytest

from taskboard.markdown import MAX_CHARS, clean_markdown

TAG_LIKE = re.compile(r"<[A-Za-z/!?]")
LINK_OPEN = re.compile(r"\]\(")
HTTP = re.compile(r"https?://", re.IGNORECASE)


def assert_invariants(out):
    assert not TAG_LIKE.search(out), out
    for match in LINK_OPEN.finditer(out):
        assert HTTP.match(out, match.end()), out


def clean(raw):
    out = clean_markdown(raw)
    if out is not None:
        assert_invariants(out)
        assert clean_markdown(out) == out, "not idempotent"
    return out


# ---- text that must come back unchanged ------------------------------------------

KEEP = [
    "plain words",
    "a < b and c > d",
    "1 <2 and 3> 2",
    "**bold** and _italic_ and ~~strike~~",
    "`code` and ```\nblock\n```",
    "- one\n- two\n  - nested\n1. first\n2. second",
    "# Heading\n\n> quote\n\n---",
    "[site](https://example.com/a?b=1&c=2)",
    "[site](http://example.com)",
    '[site](HTTPS://EXAMPLE.COM "title")',
    "![logo](https://example.com/logo.png)",
    "[ref][r]\n\n[r]: https://example.com/ref",
    "[wiki](https://en.example.org/wiki/Foo_(bar))",
    "tabs\tand\nnewlines",
    "zero​width and bidi ‮ kept",
    "emoji \U0001f600 and accents café",
    "https://bare.example.com/link",
    "[unlinked] and (parens) and [a] (b)",
]


@pytest.mark.parametrize("text", KEEP)
def test_ordinary_markdown_survives_unchanged(text):
    assert clean(text) == text


# ---- normalising ------------------------------------------------------------------


def test_line_endings_become_lf():
    assert clean("a\r\nb\rc\nd") == "a\nb\nc\nd"


def test_control_characters_are_dropped_but_newline_and_tab_stay():
    assert clean("a\x00b\x07c\x1bd\x7fe\x85f\tg\nh") == "abcdef\tg\nh"


def test_other_format_characters_are_kept():
    assert clean("a‍b﻿c⁠d") == "a‍b﻿c⁠d"


@pytest.mark.parametrize(
    "text", ["", " ", "\n\t \r\n", "\x00\x01", "<script>x</script>", "<b></b>", "<!-- c -->"]
)
def test_blank_after_cleaning_is_none(text):
    assert clean_markdown(text) is None


@pytest.mark.parametrize("text", ["a\ud800b", "\udfff", "ok \ud83d"])
def test_a_lone_surrogate_is_refused(text):
    with pytest.raises(ValueError):
        clean_markdown(text)


def test_a_valid_surrogate_pair_as_one_character_is_fine():
    assert clean("\U0001f600") == "\U0001f600"


# ---- limits -----------------------------------------------------------------------


def test_the_limit_is_ten_thousand_characters():
    assert MAX_CHARS == 10_000
    assert clean("a" * 10_000) == "a" * 10_000
    with pytest.raises(ValueError):
        clean_markdown("a" * 10_001)


def test_the_raw_limit_counts_before_cleaning():
    with pytest.raises(ValueError):
        clean_markdown("\x00" * 10_001)


def test_the_limit_is_checked_again_on_the_cleaned_text():
    raw = "<a" * 5_000  # exactly 10,000 raw characters; each open bracket gains a space
    assert len(raw) == 10_000
    with pytest.raises(ValueError):
        clean_markdown(raw)


# ---- tags -------------------------------------------------------------------------


def test_autolinks_become_the_bare_address():
    assert clean("see <https://x.test/a?b=1> now") == "see https://x.test/a?b=1 now"
    assert clean("<HTTP://X.TEST>") == "HTTP://X.TEST"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("hi <img src=x onerror=alert(1)> there", "hi  there"),
        ('<a href="javascript:alert(1)">x</a>', "x"),
        ("<b>bold</b>", "bold"),
        ("a<br/>b", "ab"),
        ("<!DOCTYPE html>x", "x"),
        ("<?php echo 1 ?>x", "x"),
        ("<SCRIPT>alert(1)</SCRIPT>after", "after"),
        ("<script src=x></script>after", "after"),
        ("<script>a</script>x<script>b</script>y", "xy"),
        ("<style>p{}</style>after", "after"),
        ("<script\n>alert(1)</script\n>after", "after"),
        ("<script>never closed", None),
        ("keep <script>never closed", "keep "),
        ("<<b>b>text", "text"),
    ],
)
def test_tags_and_script_and_style_elements_are_removed(raw, expected):
    assert clean(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "<scr<script>x</script>ipt>alert(1)</scr<script>x</script>ipt>",
        "<scr<script>ipt>alert(1)</script>",
        "<<script>script>alert(1)</script>",
        "<img src=x onerror=alert(1)//",
        "<a<a<a<a>b>b>b>",
        "<svg/onload=alert(1)>",
        "<iframe src=javascript:alert(1)>",
        "<ScRiPt >alert(1)</sCrIpT >",
        "<!--<script>alert(1)</script>-->",
        "<scr\x00ipt>alert(1)</script>",
    ],
)
def test_nested_and_broken_tags_never_survive(raw):
    out = clean(raw)
    # `clean` already checked there is no tag-like text; an unfinished tag stays as inert text
    assert out is None or "<script" not in out.lower()


def test_a_leftover_open_bracket_gets_a_space():
    assert clean("<a href=x") == "< a href=x"
    assert clean("<!x") == "< !x"
    assert clean("</x") == "< /x"
    assert clean("<?x") == "< ?x"


# ---- links ------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("[click](javascript:alert(1))", "click"),
        ("[click](JaVaScRiPt:alert(1))", "click"),
        ("![alt](javascript:alert(1))", "alt"),
        ("a ![alt](data:text/html;base64,AAAA) b", "a alt b"),
        ("[a](vbscript:x) and [b](https://ok.test)", "a and [b](https://ok.test)"),
        ("[a](&#106;avascript:alert(1))", "a"),
        ("[a](&#x6A;avascript&colon;alert(1))", "a"),
        ("[a](java&Tab;script:alert(1))", "a"),
        ("[a](  javascript:alert(1))", "a"),
        ("[a](/relative/path)", "a"),
        ('[a](#anchor "title")', "a"),
        ("[a]()", "a"),
        ("[a [b] c](javascript:x)", "a [b] c"),
        ("[[a](javascript:x)](javascript:y)", "a"),
        ('[a](javascript:alert(1) "t")', "a"),
        ("[a](java<b>script:alert(1))", "a"),
        ("[a](<javascript:alert(1)>)", "a"),
        ("[a]( https://spaced.test)", "a"),
        ("[a](&#104;ttps://encoded.test)", "a"),
    ],
)
def test_only_http_destinations_survive_in_links_and_images(raw, expected):
    assert clean(raw) == expected


def test_a_newline_split_destination_never_becomes_a_link():
    out = clean("[a](java\nscript:alert(1))")
    assert "](" not in out


def test_a_link_that_cannot_be_read_gets_a_space_after_the_bracket():
    assert clean("x](javascript:alert(1)") == "x] (javascript:alert(1)"
    assert clean("[a](javascript:alert(1)") == "[a] (javascript:alert(1)"
    assert clean("](](") == "] (] ("


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("[x]: javascript:alert(1)\n\n[click][x]", "\n\n[click][x]"),
        ("[x]: JAVASCRIPT:alert(1)", ""),
        ("> [x]: javascript:alert(1)\n\ntext", "> \n\ntext"),
        ("- [x]: data:text/html,a\n- b", "- \n- b"),
        ("1. [x]: javascript:a\nrest", "1. \nrest"),
        ("[x]:\n  javascript:alert(1)\n[y]: https://ok.test", "\n[y]: https://ok.test"),
        ("[x]: <javascript:alert(1)>", "[x]: "),
        ("[x]: < javascript:alert(1)>", ""),
        ('[x]: https://ok.test "title"', '[x]: https://ok.test "title"'),
        ("[x]: HTTP://ok.test", "[x]: HTTP://ok.test"),
    ],
)
def test_reference_definitions_keep_only_http_destinations(raw, expected):
    assert clean(raw) == (expected or None)


# ---- invariants over hostile text -------------------------------------------------

HOSTILE = [
    "<" * 10_000,
    "[" * 10_000,
    "](" * 5_000,
    "<scr<script>ipt>" * 625,
    "<<script>script>" * 625,
    "[a](" * 2_500,
    "![](" * 2_000,
    "[a](javascript:x)" * 588,
    "[" * 5_000 + "](x)" * 1_250,
    "<a " * 3_333,
    "<a>" * 3_333,
    "<script>" * 1_250,
    "</script>" * 1_111,
    "<script>x</script>" * 555,
    "(" * 10_000,
    ")" * 10_000,
    "[x]: y\n" * 1_428,
    "> " * 5_000,
    "&" * 10_000,
    "&#106;" * 1_666,
    "<scr" * 2_500,
    "ipt>" * 2_500,
    "[a](" + "(" * 9_000,
    "[a](" + "a" * 9_990,
    "[a](" + "a " * 4_990,
    "<" + " " * 9_998 + "<",
    "[" + " " * 9_998 + "]",
]


@pytest.mark.parametrize("raw", HOSTILE, ids=[f"{i}-{r[:12]!r}" for i, r in enumerate(HOSTILE)])
def test_hostile_input_is_cleaned_in_well_under_a_second(raw):
    assert len(raw) <= 10_000
    started = time.perf_counter()
    try:
        out = clean_markdown(raw)
    except ValueError:
        out = None  # a refusal for length is fine; it must be fast too
    elapsed = time.perf_counter() - started

    assert elapsed < 0.5, elapsed
    if out is not None:
        assert_invariants(out)
        again = time.perf_counter()
        assert clean_markdown(out) == out
        assert time.perf_counter() - again < 0.5


TOKENS = [
    "<",
    ">",
    "[",
    "]",
    "(",
    ")",
    "](",
    "![",
    "script",
    "style",
    "</",
    "/",
    "!",
    "?",
    "a",
    "b",
    " ",
    "\n",
    "javascript:",
    "http://",
    "https://",
    "&#106;",
    "&colon;",
    ":",
    "]:",
    '"',
    "\\",
    "`",
    "> ",
    "- ",
]


def test_random_mixes_keep_the_invariants_and_are_idempotent():
    rng = random.Random(20260101)
    for _ in range(4_000):
        raw = "".join(rng.choice(TOKENS) for _ in range(rng.randint(1, 40)))
        out = clean_markdown(raw)
        if out is None:
            continue
        assert_invariants(out)
        assert clean_markdown(out) == out, (raw, out)
