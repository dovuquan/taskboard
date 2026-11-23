"""Cards API: create, read, move, copy, the 1,000-card limit, roles, events and races."""

import math
import threading
from datetime import datetime

import pytest
from sqlalchemy import select, update
from support import (
    add_board,
    add_card,
    add_cards,
    add_list,
    add_user,
    board_row,
    events,
    interfere,
    query,
    set_board_columns,
    user_by_email,
)

from taskboard.models import BoardList, BoardMember, Card, Event, _now


def card_rows(db_url, board_id):
    stmt = (
        select(Card.id, Card.list_id, Card.number, Card.title, Card.position, Card.archived_at)
        .where(Card.board_id == board_id)
        .order_by(Card.id)
    )
    return query(db_url, lambda s: [tuple(r) for r in s.execute(stmt)])


def card_row(db_url, card_id):
    return query(db_url, lambda s: s.get(Card, card_id))


def counter(db_url, board_id):
    return board_row(db_url, board_id).next_card_number


def card_events(db_url):
    return [e for e in events(db_url) if e.subject_type == "card"]


def board_with(as_user, db_url, role="member", visibility="workspace"):
    """A signed-in actor with `role` on a new board with one list: (client, actor, board, list)."""
    client = as_user("ada@example.com", "sub-ada")
    ada = user_by_email(db_url, "ada@example.com").id
    boss = add_user(db_url, "boss@example.com")
    board_id = add_board(db_url, boss, "B", visibility, {boss: "owner", ada: role})
    return client, ada, board_id, add_list(db_url, board_id, "L", 1.0)


def url(board_id, *rest):
    return "/".join(["/api/boards", str(board_id), "cards", *map(str, rest)])


def move_body(list_id, after_id, from_list_id, from_after_id):
    return {
        "list_id": list_id,
        "after_id": after_id,
        "from_list_id": from_list_id,
        "from_after_id": from_after_id,
    }


def titles_by_list(client, board_id, list_ids):
    response = client.get(url(board_id))
    assert response.status_code == 200, response.text
    return {lid: [c["title"] for c in response.json() if c["list_id"] == lid] for lid in list_ids}


# ---- not signed in --------------------------------------------------------------

ROUTES = [
    ("GET", "/api/boards/1/cards", None),
    ("POST", "/api/boards/1/cards", {"list_id": 1, "title": "X"}),
    (
        "POST",
        "/api/boards/1/cards/1/move",
        {"list_id": 1, "after_id": None, "from_list_id": 1, "from_after_id": None},
    ),
    ("POST", "/api/boards/1/cards/1/copy", {}),
]


@pytest.mark.parametrize(("method", "path", "body"), ROUTES)
def test_card_endpoints_need_a_session(client, method, path, body):
    response = client.request(method, path, json=body)

    assert response.status_code == 401
    assert response.json() == {"detail": "not_signed_in"}


# ---- get ------------------------------------------------------------------------


def test_get_returns_visible_cards_in_order_with_only_four_fields(as_user, db_url):
    client, ada, board_id, first = board_with(as_user, db_url, "observer")
    second = add_list(db_url, board_id, "Second", 2.0)
    hidden = add_list(db_url, board_id, "Hidden", 1.5, archived_by=ada, archived_at=_now())
    c3 = add_card(db_url, board_id, second, "c3", 1.0)
    c2 = add_card(db_url, board_id, first, "c2", 2.0)
    c1 = add_card(db_url, board_id, first, "c1", 1.0)
    add_card(db_url, board_id, first, "gone", 1.5, archived_at=_now())
    add_card(db_url, board_id, hidden, "in hidden list", 1.0)

    response = client.get(url(board_id))

    assert response.status_code == 200
    assert response.json() == [
        {"id": c1, "key": "TB-3", "list_id": first, "title": "c1"},
        {"id": c2, "key": "TB-2", "list_id": first, "title": "c2"},
        {"id": c3, "key": "TB-1", "list_id": second, "title": "c3"},
    ]


# ---- create ---------------------------------------------------------------------


def test_create_appends_with_the_next_key_and_one_event(as_user, db_url):
    client, ada, board_id, list_id = board_with(as_user, db_url)
    before = len(events(db_url))

    first = client.post(url(board_id), json={"list_id": list_id, "title": "One"})
    second = client.post(url(board_id), json={"list_id": list_id, "title": "Two"})

    assert first.status_code == 201 and second.status_code == 201
    assert first.json() == {
        "id": first.json()["id"],
        "key": "TB-1",
        "list_id": list_id,
        "title": "One",
    }
    assert set(second.json()) == {"id", "key", "list_id", "title"}
    assert second.json()["key"] == "TB-2"
    assert titles_by_list(client, board_id, [list_id]) == {list_id: ["One", "Two"]}
    assert counter(db_url, board_id) == 3
    created = events(db_url)[before:]
    assert len(created) == 2
    event = created[0]
    assert (event.kind, event.actor_id, event.board_id, event.subject_type) == (
        "card.created",
        ada,
        board_id,
        "card",
    )
    assert event.subject_id == str(first.json()["id"])
    assert event.data == {"key": "TB-1", "title": "One", "list_id": list_id}


def test_the_position_follows_the_last_card_archived_ones_included(as_user, db_url):
    client, _ada, board_id, list_id = board_with(as_user, db_url)
    add_card(db_url, board_id, list_id, "old", 7.0, archived_at=_now())
    add_card(db_url, board_id, list_id, "A", 2.0)

    card_id = client.post(url(board_id), json={"list_id": list_id, "title": "N"}).json()["id"]

    assert card_row(db_url, card_id).position == 8.0


def test_the_first_card_of_a_list_gets_position_one(as_user, db_url):
    client, _ada, board_id, list_id = board_with(as_user, db_url)

    card_id = client.post(url(board_id), json={"list_id": list_id, "title": "N"}).json()["id"]

    assert card_row(db_url, card_id).position == 1.0


@pytest.mark.parametrize("title", ["x" * 200, "  y  "])
def test_valid_titles_are_accepted_and_trimmed(as_user, db_url, title):
    client, _ada, board_id, list_id = board_with(as_user, db_url)

    response = client.post(url(board_id), json={"list_id": list_id, "title": title})

    assert response.status_code == 201
    assert response.json()["title"] == title.strip()


@pytest.mark.parametrize(
    "extra",
    [
        {"title": "x" * 201},
        {"title": ""},
        {"title": "   "},
        {"title": "a\x00b"},
        {"title": "a\nb"},
        {"title": "​"},
        {"title": "ㅤ"},
        {"title": "ᅟ"},
        {"title": "ᅠ"},
        {"title": "ﾠ"},
        {"title": "⠀"},
        {"title": "a b"},
        {"title": "a b"},
        {"title": "ab"},
        {"title": "a͸b"},
        {"title": "ok", "position": 3},
        {"title": 5},
    ],
)
def test_bad_titles_are_rejected_with_nothing_written(as_user, db_url, extra):
    client, _ada, board_id, list_id = board_with(as_user, db_url)
    before = len(events(db_url))

    response = client.post(url(board_id), json={"list_id": list_id, **extra})

    assert response.status_code == 422
    assert card_rows(db_url, board_id) == []
    assert len(events(db_url)) == before
    assert counter(db_url, board_id) == 1


@pytest.mark.parametrize("list_id", [True, "5", 5.0, 0, -1, 2**63, None])
def test_a_bad_list_id_is_rejected(as_user, db_url, list_id):
    client, _ada, board_id, _list = board_with(as_user, db_url)

    response = client.post(url(board_id), json={"list_id": list_id, "title": "X"})

    assert response.status_code == 422
    assert counter(db_url, board_id) == 1


def test_a_missing_archived_or_foreign_list_is_not_found(as_user, db_url):
    client, ada, board_id, _list = board_with(as_user, db_url)
    archived = add_list(db_url, board_id, "Gone", 5.0, archived_by=ada, archived_at=_now())
    other = add_board(db_url, ada, "Other", "workspace", {ada: "owner"})
    foreign = add_list(db_url, other, "Elsewhere", 1.0)
    before = len(events(db_url))

    for target in (archived, foreign, 99999):
        response = client.post(url(board_id), json={"list_id": target, "title": "X"})
        assert response.status_code == 404, target
        assert response.json() == {"detail": "list_not_found"}

    assert card_rows(db_url, board_id) == [] and card_rows(db_url, other) == []
    assert len(events(db_url)) == before
    assert counter(db_url, board_id) == 1


# ---- the 1,000-card limit -------------------------------------------------------


def test_the_1001st_card_is_refused_with_nothing_written(as_user, db_url):
    client, _ada, board_id, list_id = board_with(as_user, db_url)
    add_cards(db_url, board_id, list_id, 1000)
    before = len(events(db_url))

    response = client.post(url(board_id), json={"list_id": list_id, "title": "Too many"})

    assert response.status_code == 422
    assert response.json() == {"detail": "card_limit"}
    assert len(card_rows(db_url, board_id)) == 1000
    assert len(events(db_url)) == before
    assert counter(db_url, board_id) == 1001


def test_archived_cards_and_cards_in_archived_lists_do_not_count(as_user, db_url):
    client, ada, board_id, list_id = board_with(as_user, db_url)
    hidden = add_list(db_url, board_id, "Gone", 2.0, archived_by=ada, archived_at=_now())
    add_cards(db_url, board_id, list_id, 998)
    add_card(db_url, board_id, list_id, "archived", 5000.0, archived_at=_now())
    add_card(db_url, board_id, hidden, "hidden", 1.0)

    before = len(events(db_url))

    response = client.post(url(board_id), json={"list_id": list_id, "title": "Fits"})

    assert response.status_code == 201
    body = response.json()
    assert body == {"id": body["id"], "key": body["key"], "list_id": list_id, "title": "Fits"}
    [event] = events(db_url)[before:]
    assert (event.kind, event.subject_id) == ("card.created", str(body["id"]))
    assert event.data == {"key": body["key"], "title": "Fits", "list_id": list_id}


def test_two_creates_for_the_1000th_card_let_one_through(as_user, db_url):
    a = as_user("ada@example.com", "sub-ada")
    b = as_user("bob@example.com", "sub-bob")
    ada = user_by_email(db_url, "ada@example.com").id
    bob = user_by_email(db_url, "bob@example.com").id
    board_id = add_board(db_url, ada, "B", "workspace", {ada: "member", bob: "member"})
    list_id = add_list(db_url, board_id, "L", 1.0)
    add_cards(db_url, board_id, list_id, 999)
    before = len(events(db_url))
    start = counter(db_url, board_id)
    barrier = threading.Barrier(2)
    statuses: list[int] = []

    def create(client):
        barrier.wait()
        response = client.post(url(board_id), json={"list_id": list_id, "title": "Last"})
        statuses.append(response.status_code)

    threads = [threading.Thread(target=create, args=(c,)) for c in (a, b)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert sorted(statuses) == [201, 422]
    assert len(card_rows(db_url, board_id)) == 1000
    assert len(events(db_url)) == before + 1
    assert counter(db_url, board_id) == start + 1


def test_four_clients_creating_at_once_get_four_distinct_keys(as_user, db_url):
    names = ["ada", "bob", "cy", "di"]
    clients = [as_user(f"{n}@example.com", f"sub-{n}") for n in names]
    ids = [user_by_email(db_url, f"{n}@example.com").id for n in names]
    board_id = add_board(db_url, ids[0], "B", "workspace", {i: "member" for i in ids})
    list_id = add_list(db_url, board_id, "L", 1.0)
    barrier = threading.Barrier(4)
    results: list = []

    def create(client):
        barrier.wait()
        results.append(client.post(url(board_id), json={"list_id": list_id, "title": "X"}))

    threads = [threading.Thread(target=create, args=(c,)) for c in clients]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert [r.status_code for r in results] == [201] * 4
    assert {r.json()["key"] for r in results} == {"TB-1", "TB-2", "TB-3", "TB-4"}
    assert counter(db_url, board_id) == 5


# ---- move -----------------------------------------------------------------------


def two_lists(db_url, board_id):
    """List A with a1 a2 a3 and list B with b1 b2; returns (lists, cards, layout)."""
    la = add_list(db_url, board_id, "A", 10.0)
    lb = add_list(db_url, board_id, "B", 20.0)
    cards = {}
    for i, name in enumerate(["a1", "a2", "a3"], start=1):
        cards[name] = add_card(db_url, board_id, la, name, float(i))
    for i, name in enumerate(["b1", "b2"], start=1):
        cards[name] = add_card(db_url, board_id, lb, name, float(i))
    layout = {"A": ["a1", "a2", "a3"], "B": ["b1", "b2"]}
    return {"A": la, "B": lb}, cards, layout


def current_place(layout, cards, name):
    for list_name, names in layout.items():
        if name in names:
            at = names.index(name)
            return list_name, (cards[names[at - 1]] if at else None)
    raise AssertionError(name)


MOVES = [
    ("a3", "A", None, {"A": ["a3", "a1", "a2"], "B": ["b1", "b2"]}),
    ("a1", "A", "a2", {"A": ["a2", "a1", "a3"], "B": ["b1", "b2"]}),
    ("a1", "A", "a3", {"A": ["a2", "a3", "a1"], "B": ["b1", "b2"]}),
    ("a1", "B", None, {"A": ["a2", "a3"], "B": ["a1", "b1", "b2"]}),
    ("a2", "B", "b1", {"A": ["a1", "a3"], "B": ["b1", "a2", "b2"]}),
    ("a2", "B", "b2", {"A": ["a1", "a3"], "B": ["b1", "b2", "a2"]}),
]


@pytest.mark.parametrize(("mover", "target", "after", "expected"), MOVES)
def test_move_reorders_within_and_between_lists(as_user, db_url, mover, target, after, expected):
    client, ada, board_id, _unused = board_with(as_user, db_url)
    lists, cards, layout = two_lists(db_url, board_id)
    before = len(events(db_url))
    from_list, from_after = current_place(layout, cards, mover)
    after_id = None if after is None else cards[after]

    response = client.post(
        url(board_id, cards[mover], "move"),
        json=move_body(lists[target], after_id, lists[from_list], from_after),
    )

    assert response.status_code == 200, response.text
    assert set(response.json()) == {"id", "key", "list_id", "title"}
    assert response.json()["list_id"] == lists[target]
    assert titles_by_list(client, board_id, list(lists.values())) == {
        lists[k]: v for k, v in expected.items()
    }
    [event] = events(db_url)[before:]
    assert (event.kind, event.actor_id, event.board_id, event.subject_id) == (
        "card.moved",
        ada,
        board_id,
        str(cards[mover]),
    )
    assert event.data == {
        "key": response.json()["key"],
        "from_list_id": lists[from_list],
        "to_list_id": lists[target],
        "after_id": after_id,
    }


@pytest.mark.parametrize(
    ("mover", "target", "after"),
    [("a1", "A", None), ("a2", "A", "a1"), ("a3", "A", "a2"), ("b1", "B", None)],
)
def test_a_move_to_the_current_place_writes_no_event(as_user, db_url, mover, target, after):
    client, _ada, board_id, _unused = board_with(as_user, db_url)
    lists, cards, layout = two_lists(db_url, board_id)
    rows = card_rows(db_url, board_id)
    before = len(events(db_url))
    from_list, from_after = current_place(layout, cards, mover)

    response = client.post(
        url(board_id, cards[mover], "move"),
        json=move_body(
            lists[target], None if after is None else cards[after], lists[from_list], from_after
        ),
    )

    assert response.status_code == 200
    assert card_rows(db_url, board_id) == rows
    assert len(events(db_url)) == before


def test_moving_a_card_after_itself_is_invalid(as_user, db_url):
    client, _ada, board_id, _unused = board_with(as_user, db_url)
    lists, cards, _layout = two_lists(db_url, board_id)
    before = len(events(db_url))

    response = client.post(
        url(board_id, cards["a1"], "move"),
        json=move_body(lists["A"], cards["a1"], lists["A"], None),
    )

    assert response.status_code == 422
    assert response.json() == {"detail": "invalid_anchor"}
    assert len(events(db_url)) == before


def test_a_foreign_archived_or_unknown_anchor_is_a_conflict(as_user, db_url):
    client, _ada, board_id, _unused = board_with(as_user, db_url)
    lists, cards, _layout = two_lists(db_url, board_id)
    gone = add_card(db_url, board_id, lists["A"], "gone", 9.0, archived_at=_now())
    rows = card_rows(db_url, board_id)
    before = len(events(db_url))

    for anchor in (cards["b1"], gone, 99999):
        response = client.post(
            url(board_id, cards["a1"], "move"),
            json=move_body(lists["A"], anchor, lists["A"], None),
        )
        assert response.status_code == 409, anchor
        assert response.json() == {"detail": "conflict"}

    assert card_rows(db_url, board_id) == rows
    assert len(events(db_url)) == before


def test_a_card_of_another_board_is_not_found_and_left_alone(as_user, db_url):
    client, ada, board_id, list_id = board_with(as_user, db_url, "owner")
    other = add_board(db_url, ada, "Other", "workspace", {ada: "owner"})
    other_list = add_list(db_url, other, "Theirs", 1.0)
    foreign = add_card(db_url, other, other_list, "Theirs", 1.0)
    rows = card_rows(db_url, other)
    before = len(events(db_url))

    response = client.post(
        url(board_id, foreign, "move"), json=move_body(list_id, None, other_list, None)
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "card_not_found"}
    assert card_rows(db_url, other) == rows
    assert len(events(db_url)) == before


def test_moving_an_archived_card_or_a_card_in_an_archived_list_is_not_found(as_user, db_url):
    client, ada, board_id, list_id = board_with(as_user, db_url)
    hidden = add_list(db_url, board_id, "Gone", 2.0, archived_by=ada, archived_at=_now())
    archived = add_card(db_url, board_id, list_id, "a", 1.0, archived_at=_now())
    stuck = add_card(db_url, board_id, hidden, "b", 1.0)
    before = len(events(db_url))

    for card_id, source in ((archived, list_id), (stuck, hidden)):
        response = client.post(
            url(board_id, card_id, "move"), json=move_body(list_id, None, source, None)
        )
        assert response.status_code == 404
        assert response.json() == {"detail": "card_not_found"}

    assert len(events(db_url)) == before


def test_moving_to_an_archived_foreign_or_unknown_list_is_not_found(as_user, db_url):
    client, ada, board_id, list_id = board_with(as_user, db_url)
    card_id = add_card(db_url, board_id, list_id, "a", 1.0)
    archived = add_list(db_url, board_id, "Gone", 5.0, archived_by=ada, archived_at=_now())
    other = add_board(db_url, ada, "Other", "workspace", {ada: "owner"})
    foreign = add_list(db_url, other, "Elsewhere", 1.0)
    rows = card_rows(db_url, board_id)
    before = len(events(db_url))

    for target in (archived, foreign, 99999):
        response = client.post(
            url(board_id, card_id, "move"), json=move_body(target, None, list_id, None)
        )
        assert response.status_code == 404, target
        assert response.json() == {"detail": "list_not_found"}

    assert card_rows(db_url, board_id) == rows
    assert len(events(db_url)) == before


@pytest.mark.parametrize(
    "body",
    [
        {"list_id": 1, "after_id": None, "from_list_id": 1},
        {"list_id": 1, "after_id": None, "from_after_id": None},
        {"list_id": 1, "from_list_id": 1, "from_after_id": None},
        {"after_id": None, "from_list_id": 1, "from_after_id": None},
        {"list_id": 1, "after_id": None, "from_list_id": 1, "from_after_id": None, "x": 1},
        {"list_id": 1, "after_id": 0, "from_list_id": 1, "from_after_id": None},
        {"list_id": 1, "after_id": True, "from_list_id": 1, "from_after_id": None},
        {"list_id": 1, "after_id": None, "from_list_id": 1, "from_after_id": "5"},
    ],
)
def test_a_malformed_move_is_rejected(as_user, db_url, body):
    client, _ada, board_id, list_id = board_with(as_user, db_url)
    card_id = add_card(db_url, board_id, list_id, "a", 1.0)
    before = len(events(db_url))

    response = client.post(url(board_id, card_id, "move"), json=body)

    assert response.status_code == 422
    assert len(events(db_url)) == before


def _relocate(db_url, card_id, list_id, position, *, by=None, board_id=None, after_id=None):
    """A direct move by someone else, with the event a real move would have written."""

    def write(s):
        s.execute(update(Card).where(Card.id == card_id).values(list_id=list_id, position=position))
        if by is not None:
            s.add(
                Event(
                    actor_id=by,
                    kind="card.moved",
                    subject_type="card",
                    subject_id=str(card_id),
                    data={"to_list_id": list_id, "after_id": after_id},
                    board_id=board_id,
                )
            )
        s.commit()

    return lambda: query(db_url, write)


def test_a_stale_move_is_a_conflict_that_names_who_moved_the_card(as_user, db_url, monkeypatch):
    client, _ada, board_id, _unused = board_with(as_user, db_url)
    lists, cards, _layout = two_lists(db_url, board_id)
    boss = user_by_email(db_url, "boss@example.com").id
    interfere(
        monkeypatch,
        _relocate(db_url, cards["a1"], lists["B"], 0.5, by=boss, board_id=board_id),
        "cards",
    )
    before = len(events(db_url))

    response = client.post(
        url(board_id, cards["a1"], "move"),
        json=move_body(lists["A"], cards["a2"], lists["A"], None),
    )

    assert response.status_code == 409
    assert response.json() == {
        "detail": "card_moved",
        "card": {"id": cards["a1"], "key": "TB-1", "list_id": lists["B"], "title": "a1"},
        "after_id": None,
        "moved_by": "Boss",
    }
    row = card_row(db_url, cards["a1"])
    assert (row.list_id, row.position) == (lists["B"], 0.5)
    assert len(events(db_url)) == before + 1  # only the interferer's own event


def test_a_stale_move_reports_the_card_above_and_no_name_without_an_event(
    as_user, db_url, monkeypatch
):
    client, _ada, board_id, _unused = board_with(as_user, db_url)
    lists, cards, _layout = two_lists(db_url, board_id)
    interfere(monkeypatch, _relocate(db_url, cards["a1"], lists["B"], 1.5), "cards")
    before = len(events(db_url))

    response = client.post(
        url(board_id, cards["a1"], "move"),
        json=move_body(lists["A"], cards["a2"], lists["A"], None),
    )

    assert response.status_code == 409
    assert response.json() == {
        "detail": "card_moved",
        "card": {"id": cards["a1"], "key": "TB-1", "list_id": lists["B"], "title": "a1"},
        "after_id": cards["b1"],
        "moved_by": None,
    }
    row = card_row(db_url, cards["a1"])
    assert (row.list_id, row.position) == (lists["B"], 1.5)
    assert len(events(db_url)) == before


@pytest.mark.parametrize("neighbour", ["copy", "move"])
def test_a_neighbour_changing_makes_the_next_drag_stale_with_no_name(as_user, db_url, neighbour):
    client, _ada, board_id, _unused = board_with(as_user, db_url)
    lists, cards, _layout = two_lists(db_url, board_id)
    la = lists["A"]
    # a3 is really moved (so it has a card.moved event) and ends up right after a2
    assert (
        client.post(
            url(board_id, cards["a3"], "move"), json=move_body(la, None, la, cards["a2"])
        ).status_code
        == 200
    )
    assert (
        client.post(
            url(board_id, cards["a3"], "move"), json=move_body(la, cards["a2"], la, None)
        ).status_code
        == 200
    )
    if neighbour == "copy":
        response = client.post(url(board_id, cards["a2"], "copy"), json={})
        assert response.status_code == 201
        new_predecessor = response.json()["id"]
    else:
        response = client.post(
            url(board_id, cards["a1"], "move"),
            json=move_body(la, cards["a2"], la, None),
        )
        assert response.status_code == 200
        new_predecessor = cards["a1"]
    rows = card_rows(db_url, board_id)
    before = len(events(db_url))

    response = client.post(
        url(board_id, cards["a3"], "move"),
        json=move_body(la, None, la, cards["a2"]),
    )

    assert response.status_code == 409
    assert response.json() == {
        "detail": "card_moved",
        "card": {"id": cards["a3"], "key": "TB-3", "list_id": la, "title": "a3"},
        "after_id": new_predecessor,
        "moved_by": None,
    }
    assert card_rows(db_url, board_id) == rows
    assert len(events(db_url)) == before


def test_a_move_someone_else_already_made_is_ok_and_writes_no_event(as_user, db_url, monkeypatch):
    client, _ada, board_id, _unused = board_with(as_user, db_url)
    lists, cards, _layout = two_lists(db_url, board_id)
    interfere(monkeypatch, _relocate(db_url, cards["a1"], lists["B"], 0.5), "cards")
    before = len(events(db_url))

    response = client.post(
        url(board_id, cards["a1"], "move"),
        json=move_body(lists["B"], None, lists["A"], None),
    )

    assert response.status_code == 200
    assert response.json() == {
        "id": cards["a1"],
        "key": "TB-1",
        "list_id": lists["B"],
        "title": "a1",
    }
    row = card_row(db_url, cards["a1"])
    assert (row.list_id, row.position) == (lists["B"], 0.5)
    assert len(events(db_url)) == before


def test_a_used_up_gap_renumbers_the_list_and_still_places_the_card(as_user, db_url):
    client, _ada, board_id, list_id = board_with(as_user, db_url)
    a1 = add_card(db_url, board_id, list_id, "a1", 1.0)
    a2 = add_card(db_url, board_id, list_id, "a2", math.nextafter(1.0, 2))
    a3 = add_card(db_url, board_id, list_id, "a3", 5.0)
    add_card(db_url, board_id, list_id, "gone", 0.5, archived_at=_now())
    other_list = add_list(db_url, board_id, "Other", 2.0)
    elsewhere = add_card(db_url, board_id, other_list, "e", 9.5)

    response = client.post(url(board_id, a3, "move"), json=move_body(list_id, a1, list_id, a2))

    assert response.status_code == 200, response.text
    assert titles_by_list(client, board_id, [list_id]) == {list_id: ["a1", "a3", "a2"]}
    positions = {row[0]: row[4] for row in card_rows(db_url, board_id)}
    # renumbered 1..n in (position, id) order, archived included, then a3 between a1 and a2
    assert positions[a1] == 2.0 and positions[a2] == 3.0 and positions[a3] == 2.5
    assert positions[elsewhere] == 9.5


# ---- copy -----------------------------------------------------------------------


def test_copy_places_the_new_card_after_the_source(as_user, db_url):
    client, ada, board_id, list_id = board_with(as_user, db_url)
    due = datetime(2026, 5, 1, 12, 0)
    a1 = add_card(db_url, board_id, list_id, "a1", 1.0, description="Words", due_at=due)
    add_card(db_url, board_id, list_id, "a2", 2.0)
    before = len(events(db_url))

    response = client.post(url(board_id, a1, "copy"), json={})

    assert response.status_code == 201, response.text
    body = response.json()
    assert body == {"id": body["id"], "key": "TB-3", "list_id": list_id, "title": "a1 (copy)"}
    assert titles_by_list(client, board_id, [list_id]) == {list_id: ["a1", "a1 (copy)", "a2"]}
    row = card_row(db_url, body["id"])
    assert (row.description, row.due_at, row.number, row.created_by) == ("Words", due, 3, ada)
    assert counter(db_url, board_id) == 4
    [event] = events(db_url)[before:]
    assert (event.kind, event.actor_id, event.board_id, event.subject_id) == (
        "card.copied",
        ada,
        board_id,
        str(body["id"]),
    )
    assert event.data == {"key": "TB-3", "from_key": "TB-1"}


def test_copy_cuts_a_long_title_so_the_copy_is_exactly_200(as_user, db_url):
    client, _ada, board_id, list_id = board_with(as_user, db_url)
    source = add_card(db_url, board_id, list_id, "x" * 200, 1.0)
    before = len(events(db_url))

    response = client.post(url(board_id, source, "copy"), json={})

    assert response.status_code == 201
    body = response.json()
    assert body == {
        "id": body["id"],
        "key": "TB-2",
        "list_id": list_id,
        "title": "x" * 193 + " (copy)",
    }
    assert len(body["title"]) == 200
    [event] = events(db_url)[before:]
    assert (event.kind, event.subject_id) == ("card.copied", str(body["id"]))
    assert event.data == {"key": "TB-2", "from_key": "TB-1"}


def test_copy_drops_the_space_left_at_the_cut(as_user, db_url):
    client, _ada, board_id, list_id = board_with(as_user, db_url)
    source = add_card(db_url, board_id, list_id, "x" * 192 + " " + "y" * 7, 1.0)

    response = client.post(url(board_id, source, "copy"), json={})

    assert response.status_code == 201
    assert response.json()["title"] == "x" * 192 + " (copy)"


def test_copy_with_a_used_up_gap_renumbers_and_places_it(as_user, db_url):
    client, _ada, board_id, list_id = board_with(as_user, db_url)
    a1 = add_card(db_url, board_id, list_id, "a1", 1.0)
    add_card(db_url, board_id, list_id, "a2", math.nextafter(1.0, 2))

    response = client.post(url(board_id, a1, "copy"), json={})

    assert response.status_code == 201
    assert titles_by_list(client, board_id, [list_id]) == {list_id: ["a1", "a1 (copy)", "a2"]}


def test_copy_at_1000_cards_is_refused_with_nothing_written(as_user, db_url):
    client, _ada, board_id, list_id = board_with(as_user, db_url)
    add_cards(db_url, board_id, list_id, 1000)
    source = card_rows(db_url, board_id)[0][0]
    before = len(events(db_url))

    response = client.post(url(board_id, source, "copy"), json={})

    assert response.status_code == 422
    assert response.json() == {"detail": "card_limit"}
    assert len(card_rows(db_url, board_id)) == 1000
    assert len(events(db_url)) == before
    assert counter(db_url, board_id) == 1001


def test_copying_a_card_in_an_archived_list_or_an_archived_card_is_not_found(as_user, db_url):
    client, ada, board_id, list_id = board_with(as_user, db_url)
    hidden = add_list(db_url, board_id, "Gone", 2.0, archived_by=ada, archived_at=_now())
    stuck = add_card(db_url, board_id, hidden, "a", 1.0)
    archived = add_card(db_url, board_id, list_id, "b", 1.0, archived_at=_now())
    start = counter(db_url, board_id)
    before = len(events(db_url))

    for card_id in (stuck, archived, 99999):
        response = client.post(url(board_id, card_id, "copy"), json={})
        assert response.status_code == 404, card_id
        assert response.json() == {"detail": "card_not_found"}

    assert counter(db_url, board_id) == start
    assert len(events(db_url)) == before


def test_copying_a_card_of_another_board_is_not_found(as_user, db_url):
    client, ada, board_id, _list = board_with(as_user, db_url, "owner")
    other = add_board(db_url, ada, "Other", "workspace", {ada: "owner"})
    foreign = add_card(db_url, other, add_list(db_url, other, "L", 1.0), "x", 1.0)

    response = client.post(url(board_id, foreign, "copy"), json={})

    assert response.status_code == 404
    assert response.json() == {"detail": "card_not_found"}
    assert len(card_rows(db_url, other)) == 1


# ---- archived boards ------------------------------------------------------------


def test_every_route_is_board_not_found_on_an_archived_board(as_user, db_url):
    client, _ada, board_id, list_id = board_with(as_user, db_url, "owner")
    card_id = add_card(db_url, board_id, list_id, "a", 1.0)
    set_board_columns(db_url, board_id, archived_at=_now())
    rows = card_rows(db_url, board_id)
    before = len(events(db_url))

    for method, path, body in ROUTES:
        path = path.replace("/boards/1/", f"/boards/{board_id}/").replace(
            "/cards/1", f"/cards/{card_id}"
        )
        if body and "list_id" in body:
            body = {**body, **{k: list_id for k in body if k.endswith("list_id")}}
        response = client.request(method, path, json=body)
        assert response.status_code == 404, (method, path)
        assert response.json() == {"detail": "board_not_found"}

    assert card_rows(db_url, board_id) == rows
    assert len(events(db_url)) == before


# ---- atomicity ------------------------------------------------------------------


def test_a_failing_event_insert_leaves_no_card_no_event_and_the_same_counter(
    as_user, db_url, monkeypatch
):
    from taskboard import cards

    client, _ada, board_id, list_id = board_with(as_user, db_url)
    real = cards.record_change
    before = len(events(db_url))

    def boom(session, change, **kw):
        return real(session, lambda s: (change(s), 1 / 0)[0], **kw)

    monkeypatch.setattr(cards, "record_change", boom)
    with pytest.raises(ZeroDivisionError):
        client.post(url(board_id), json={"list_id": list_id, "title": "X"})

    assert card_rows(db_url, board_id) == []
    assert len(events(db_url)) == before
    assert counter(db_url, board_id) == 1


# ---- role matrix ----------------------------------------------------------------

ACTIONS = {
    "get": (200, lambda c, b, lid, ids: c.get(url(b))),
    "create": (
        201,
        lambda c, b, lid, ids: c.post(url(b), json={"list_id": lid, "title": "New"}),
    ),
    "move": (
        200,
        lambda c, b, lid, ids: c.post(
            url(b, ids[0], "move"), json=move_body(lid, ids[1], lid, None)
        ),
    ),
    "copy": (201, lambda c, b, lid, ids: c.post(url(b, ids[0], "copy"), json={})),
}

# actor -> (workspace role, board row role, status on a Workspace board, on a Private board)
ACTORS = {
    "owner": ("member", "owner", "allow", "allow"),
    "member": ("member", "member", "allow", "allow"),
    "observer": ("member", "observer", 403, 403),
    "outsider": ("member", None, 403, 404),
    "admin": ("admin", None, "allow", 404),
    "admin_observer": ("admin", "observer", "allow", "allow"),
}


@pytest.mark.parametrize("visibility", ["workspace", "private"])
@pytest.mark.parametrize("actor", list(ACTORS))
@pytest.mark.parametrize("action", list(ACTIONS))
def test_role_matrix(as_user, db_url, action, actor, visibility):
    ws_role, row_role, on_workspace, on_private = ACTORS[actor]
    expected = on_workspace if visibility == "workspace" else on_private
    if action == "get" and expected == 403:
        expected = "allow"  # anyone who can see the board can read its cards
    client = as_user("actor@example.com", "sub-actor", ws_role)
    actor_id = user_by_email(db_url, "actor@example.com").id
    boss = add_user(db_url, "boss@example.com")
    members = {boss: "owner"}
    if row_role:
        members[actor_id] = row_role
    board_id = add_board(db_url, boss, "B", visibility, members)
    list_id = add_list(db_url, board_id, "L", 1.0)
    ids = [
        add_card(db_url, board_id, list_id, "A", 1.0),
        add_card(db_url, board_id, list_id, "B", 2.0),
    ]
    rows = card_rows(db_url, board_id)
    start = counter(db_url, board_id)
    before = len(events(db_url))
    success, call = ACTIONS[action]

    response = call(client, board_id, list_id, ids)

    if expected == "allow":
        assert response.status_code == success, response.text
        if action == "get":
            assert len(events(db_url)) == before
        else:
            [event] = events(db_url)[before:]
            assert event.actor_id == actor_id and event.board_id == board_id
            body = response.json()
            key = body["key"]
            if action == "create":
                assert body == {
                    "id": body["id"],
                    "key": f"TB-{start}",
                    "list_id": list_id,
                    "title": "New",
                }
                assert (event.kind, event.subject_id) == ("card.created", str(body["id"]))
                assert event.data == {"key": key, "title": "New", "list_id": list_id}
            elif action == "move":
                assert body == {"id": ids[0], "key": "TB-1", "list_id": list_id, "title": "A"}
                assert (event.kind, event.subject_id) == ("card.moved", str(ids[0]))
                assert event.data == {
                    "key": "TB-1",
                    "from_list_id": list_id,
                    "to_list_id": list_id,
                    "after_id": ids[1],
                }
            else:
                assert body == {
                    "id": body["id"],
                    "key": f"TB-{start}",
                    "list_id": list_id,
                    "title": "A (copy)",
                }
                assert (event.kind, event.subject_id) == ("card.copied", str(body["id"]))
                assert event.data == {"key": key, "from_key": "TB-1"}
    else:
        assert response.status_code == expected, response.text
        assert response.json() == {"detail": "forbidden" if expected == 403 else "board_not_found"}
        assert len(events(db_url)) == before
        assert card_rows(db_url, board_id) == rows
        assert counter(db_url, board_id) == start


# ---- the actor's role is checked again inside the transaction -------------------


def _demote(db_url, board_id, user_id, role):
    def write(s):
        s.execute(
            update(BoardMember)
            .where(BoardMember.board_id == board_id, BoardMember.user_id == user_id)
            .values(role=role)
        )
        s.commit()

    return lambda: query(db_url, write)


MID_REQUEST = {
    "create": lambda c, b, lid, ids: c.post(url(b), json={"list_id": lid, "title": "New"}),
    "move": lambda c, b, lid, ids: c.post(
        url(b, ids[0], "move"), json=move_body(lid, ids[1], lid, None)
    ),
    "copy": lambda c, b, lid, ids: c.post(url(b, ids[0], "copy"), json={}),
}


@pytest.mark.parametrize("change", ["demoted", "board_archived"])
@pytest.mark.parametrize("action", list(MID_REQUEST))
def test_a_role_lost_mid_request_writes_nothing(as_user, db_url, monkeypatch, action, change):
    client, ada, board_id, list_id = board_with(as_user, db_url)
    ids = [
        add_card(db_url, board_id, list_id, "A", 1.0),
        add_card(db_url, board_id, list_id, "B", 2.0),
    ]
    rows = card_rows(db_url, board_id)
    start = counter(db_url, board_id)
    before = len(events(db_url))
    if change == "demoted":
        interfere(monkeypatch, _demote(db_url, board_id, ada, "observer"), "cards")
        status, detail = 403, "forbidden"
    else:
        interfere(
            monkeypatch, lambda: set_board_columns(db_url, board_id, archived_at=_now()), "cards"
        )
        status, detail = 404, "board_not_found"

    response = MID_REQUEST[action](client, board_id, list_id, ids)

    assert response.status_code == status, response.text
    assert response.json() == {"detail": detail}
    assert len(events(db_url)) == before
    assert card_rows(db_url, board_id) == rows
    assert counter(db_url, board_id) == start


def test_a_list_archived_mid_create_is_not_found_and_writes_nothing(as_user, db_url, monkeypatch):
    client, ada, board_id, list_id = board_with(as_user, db_url)
    before = len(events(db_url))

    def archive():
        def write(s):
            s.execute(
                update(BoardList)
                .where(BoardList.id == list_id)
                .values(archived_at=_now(), archived_by=ada)
            )
            s.commit()

        query(db_url, write)

    interfere(monkeypatch, archive, "cards")

    response = client.post(url(board_id), json={"list_id": list_id, "title": "X"})

    assert response.status_code == 404
    assert response.json() == {"detail": "list_not_found"}
    assert card_rows(db_url, board_id) == []
    assert len(events(db_url)) == before
    assert counter(db_url, board_id) == 1
