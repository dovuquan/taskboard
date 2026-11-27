"""`taskboard seed` fills the invented board with lists, cards and their details, once."""

import dataclasses
from collections import Counter

import pytest
from pydantic import TypeAdapter
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from taskboard import cli, seed
from taskboard.boards import BoardName
from taskboard.card_fields import CardTitle, visible_tiles
from taskboard.comments import _clean_comment
from taskboard.db import make_engine
from taskboard.markdown import clean_markdown
from taskboard.models import (
    Board,
    BoardList,
    BoardMember,
    Card,
    CardLabel,
    CardMember,
    ChecklistItem,
    Comment,
    Event,
    Label,
    User,
)

CONTENT_TABLES = (
    "boards",
    "lists",
    "cards",
    "card_labels",
    "card_members",
    "checklist_items",
    "comments",
    "events",
)


@pytest.fixture(autouse=True)
def _url(db_url, monkeypatch):
    monkeypatch.setenv("TASKBOARD_DATABASE_URL", db_url)


@pytest.fixture
def migrated(db_url):
    assert cli.main(["migrate"]) == 0
    return db_url


def query(db_url, fn):
    engine = make_engine(db_url)
    try:
        with Session(engine) as s:
            return fn(s)
    finally:
        engine.dispose()


def snapshot(db_url):
    def read(s):
        return {
            table: [tuple(r) for r in s.execute(text(f"SELECT * FROM {table} ORDER BY 1, 2"))]
            for table in CONTENT_TABLES
        }

    return query(db_url, read)


def rows(db_url, model):
    return query(db_url, lambda s: list(s.scalars(select(model).order_by(model.id))))


def board_of(db_url) -> Board:
    return query(db_url, lambda s: s.scalars(select(Board)).one())


def count(db_url, model) -> int:
    return query(db_url, lambda s: s.scalar(select(func.count()).select_from(model)))


def kinds(db_url) -> Counter:
    return Counter(e.kind for e in rows(db_url, Event))


def sample_cards():
    return [c for lst in seed.SAMPLE.lists for c in lst.cards]


def test_seed_fills_the_board(migrated):
    assert cli.main(["seed"]) == 0
    board = board_of(migrated)

    def read(s):
        tiles = visible_tiles(s, board.id, board.key_prefix)
        names = {lst.id: lst.name for lst in s.scalars(select(BoardList))}
        return tiles, names

    tiles, names = query(migrated, read)
    expected = [(lst.name, c.title) for lst in seed.SAMPLE.lists for c in lst.cards]
    assert [(names[t["list_id"]], t["title"]) for t in tiles] == expected
    assert [t["key"] for t in tiles] == [f"TB-{n}" for n in range(1, len(expected) + 1)]
    assert board.next_card_number == len(expected) + 1
    assert len(seed.SAMPLE.lists) == 3
    assert len(expected) == 9


def test_labels_are_only_the_fixed_seven(migrated):
    assert cli.main(["seed"]) == 0

    def read(s):
        pairs = s.execute(
            select(Card.title, Label.id, Label.name)
            .join(CardLabel, CardLabel.card_id == Card.id)
            .join(Label, Label.id == CardLabel.label_id)
        )
        return [tuple(p) for p in pairs]

    pairs = query(migrated, read)
    assert {label_id for _, label_id, _ in pairs} <= set(range(1, 8))
    got = sorted((title, name) for title, _, name in pairs)
    want = sorted((c.title, name) for c in sample_cards() for name in c.labels)
    assert got == want
    assert {name for _, name in want} == {
        "Launch",
        "Bug",
        "Docs",
        "Ops",
        "Marketing",
        "Research",
        "Design",
    }
    assert any(not c.labels for c in sample_cards())


def test_every_change_has_one_event_in_the_same_transaction(migrated):
    assert cli.main(["seed"]) == 0
    board = board_of(migrated)
    cards = sample_cards()
    got = kinds(migrated)

    assert got["list.created"] == count(migrated, BoardList) == 3
    assert got["card.created"] == count(migrated, Card) == 9
    assert got["card.label_added"] == count(migrated, CardLabel)
    assert got["card.member_added"] == count(migrated, CardMember)
    assert got["checklist.item_added"] == count(migrated, ChecklistItem)
    assert got["checklist.item_checked"] == sum(
        1 for c in cards for item in c.checklist if item.done
    )
    assert got["comment.added"] == count(migrated, Comment) == sum(len(c.comments) for c in cards)
    assert got["card.due_changed"] == sum(1 for c in cards if c.due_in_days is not None)
    assert got["card.described"] == sum(1 for c in cards if c.description)

    content = [
        e
        for e in rows(migrated, Event)
        if e.kind.split(".")[0] in {"list", "card", "checklist", "comment"}
    ]
    assert content
    assert all(e.board_id == board.id and e.actor_id is None for e in content)
    comment_events = [e for e in content if e.kind == "comment.added"]
    comment_ids = [c.id for c in rows(migrated, Comment)]
    assert [set(e.data) for e in comment_events] == [{"key", "comment_id"}] * len(comment_events)
    assert sorted(e.data["comment_id"] for e in comment_events) == comment_ids
    card_events = [e for e in content if e.kind == "card.created"]
    assert [e.data["key"] for e in card_events] == [f"TB-{n}" for n in range(1, 10)]


def test_a_failing_content_write_leaves_rows_and_events_matching(migrated, monkeypatch):
    real = seed.record_change
    calls = []

    def flaky(session, change, **kw):
        calls.append(kw["kind"])
        if len(calls) == 12:
            return real(session, lambda s: (change(s), 1 / 0)[0], **kw)
        return real(session, change, **kw)

    monkeypatch.setattr(seed, "record_change", flaky)
    with pytest.raises(ZeroDivisionError):
        cli.main(["seed"])

    got = kinds(migrated)
    assert len(calls) == 12
    assert got["list.created"] == count(migrated, BoardList)
    assert got["card.created"] == count(migrated, Card)
    assert got["card.label_added"] == count(migrated, CardLabel)
    assert got["card.member_added"] == count(migrated, CardMember)
    assert got["checklist.item_added"] == count(migrated, ChecklistItem)
    assert got["comment.added"] == count(migrated, Comment)
    content_events = [k for k in got.elements() if k.split(".")[0] in {"list", "card", "checklist"}]
    assert len(content_events) == 11  # every change before the failed one, none for it
    assert got[calls[11]] == calls[:11].count(calls[11])


def test_seed_twice_changes_nothing(migrated, capsys):
    assert cli.main(["seed"]) == 0
    assert count(migrated, BoardList) == 3
    first = snapshot(migrated)
    capsys.readouterr()

    assert cli.main(["seed"]) == 0

    assert snapshot(migrated) == first
    assert capsys.readouterr().out == "seeded 0 new member(s)\n"


def test_a_changed_board_is_left_alone(migrated, monkeypatch):
    with monkeypatch.context() as m:
        m.setattr(seed, "SAMPLE", dataclasses.replace(seed.SAMPLE, lists=()))
        assert cli.main(["seed"]) == 0
    board = board_of(migrated)
    owner_id = board.created_by

    def add_list(s):
        s.add(BoardList(board_id=board.id, name="Mine", position=1.0, created_by=owner_id))
        s.commit()

    query(migrated, add_list)
    before = snapshot(migrated)

    assert cli.main(["seed"]) == 0

    assert snapshot(migrated) == before


def test_a_board_left_empty_by_an_earlier_seed_gets_content(migrated, monkeypatch):
    with monkeypatch.context() as m:
        m.setattr(seed, "SAMPLE", dataclasses.replace(seed.SAMPLE, lists=()))
        assert cli.main(["seed"]) == 0
    assert count(migrated, BoardList) == 0

    assert cli.main(["seed"]) == 0

    assert count(migrated, BoardList) == 3
    assert count(migrated, Card) == 9


def test_a_board_made_by_someone_else_gets_no_lists(migrated):
    def make(s):
        s.add(User(id=1, email="other@example.com", google_sub="sub-o"))
        s.flush()
        board = Board(name="Office move", visibility="workspace", created_by=1)
        s.add(board)
        s.flush()
        s.add(BoardMember(board_id=board.id, user_id=1, role="owner"))
        s.commit()

    query(migrated, make)

    assert cli.main(["seed"]) == 0

    assert count(migrated, BoardList) == 0
    assert count(migrated, Card) == 0
    assert kinds(migrated)["list.created"] == 0


def test_check_passes_after_seeding(migrated, capsys):
    assert cli.main(["seed"]) == 0
    capsys.readouterr()

    assert cli.main(["check"]) == 0
    assert capsys.readouterr().out == "integrity: ok\nschema: 0006 (head)\n"


def test_the_sample_is_invented_and_valid():
    locals_ = {local for _, local in cli.SEED_PEOPLE}
    texts = []
    for lst in seed.SAMPLE.lists:
        texts.append(lst.name)
        for card in lst.cards:
            texts += [card.title, card.description or ""]
            texts += [item.text for item in card.checklist]
            texts += [c.text for c in card.comments]
            assert set(card.people) <= locals_
            assert {c.author for c in card.comments} <= locals_
            assert len(card.labels) <= 2
            assert len(card.people) <= 2
    assert all("@" not in t and "example.com" not in t for t in texts)

    for lst in seed.SAMPLE.lists:
        assert TypeAdapter(BoardName).validate_python(lst.name) == lst.name
        for card in lst.cards:
            assert TypeAdapter(CardTitle).validate_python(card.title) == card.title
            for item in card.checklist:
                assert TypeAdapter(CardTitle).validate_python(item.text) == item.text
            if card.description:
                assert clean_markdown(card.description) == card.description
            for comment in card.comments:
                assert _clean_comment(comment.text) == comment.text


def test_first_run_prints_what_it_added(migrated, capsys):
    capsys.readouterr()

    assert cli.main(["seed"]) == 0

    assert capsys.readouterr().out == (
        "seeded 5 new member(s)\n"
        "seeded the board 'Office move'\n"
        "seeded 3 lists and 9 cards on 'Office move'\n"
    )
