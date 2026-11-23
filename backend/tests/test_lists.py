"""Lists API: order, the 50-list limit, moves, archive and restore, roles, events and races."""

import math
import threading
from datetime import timedelta

import pytest
from sqlalchemy import select, update
from support import (
    add_board,
    add_card,
    add_cards,
    add_list,
    add_user,
    events,
    interfere,
    query,
    set_board_columns,
    user_by_email,
)

from taskboard.models import BoardList, BoardMember, _now


def list_row(db_url, list_id):
    return query(db_url, lambda s: s.get(BoardList, list_id))


def all_rows(db_url, board_id):
    stmt = (
        select(BoardList.id, BoardList.name, BoardList.position, BoardList.archived_at)
        .where(BoardList.board_id == board_id)
        .order_by(BoardList.id)
    )
    return query(db_url, lambda s: [tuple(r) for r in s.execute(stmt)])


def names(response):
    assert response.status_code == 200, response.text
    return [row["name"] for row in response.json()]


def list_events(db_url):
    return [e for e in events(db_url) if e.subject_type == "list"]


def board_with(as_user, db_url, role="member", visibility="workspace"):
    """A signed-in actor with `role` on a new board; returns (client, actor_id, board_id)."""
    client = as_user("ada@example.com", "sub-ada")
    ada = user_by_email(db_url, "ada@example.com").id
    boss = add_user(db_url, "boss@example.com")
    members = {boss: "owner", ada: role}
    return client, ada, add_board(db_url, boss, "B", visibility, members)


def url(board_id, *rest):
    return "/".join(["/api/boards", str(board_id), "lists", *map(str, rest)])


# ---- not signed in --------------------------------------------------------------

ROUTES = [
    ("GET", "/api/boards/1/lists", None),
    ("POST", "/api/boards/1/lists", {"name": "X"}),
    ("PATCH", "/api/boards/1/lists/1", {"name": "X"}),
    ("POST", "/api/boards/1/lists/1/move", {"after_id": None}),
    ("POST", "/api/boards/1/lists/1/archive", None),
    ("POST", "/api/boards/1/lists/1/restore", None),
]


@pytest.mark.parametrize(("method", "path", "body"), ROUTES)
def test_list_endpoints_need_a_session(client, method, path, body):
    response = client.request(method, path, json=body)

    assert response.status_code == 401
    assert response.json() == {"detail": "not_signed_in"}


# ---- get and create -------------------------------------------------------------


def test_get_returns_active_lists_in_order_with_only_id_and_name(as_user, db_url):
    client, ada, board_id = board_with(as_user, db_url, "observer")
    second = add_list(db_url, board_id, "Second", 2.0)
    first = add_list(db_url, board_id, "First", 1.0)
    add_list(db_url, board_id, "Gone", 1.5, archived_by=ada, archived_at=_now())

    response = client.get(url(board_id))

    assert response.status_code == 200
    assert response.json() == [{"id": first, "name": "First"}, {"id": second, "name": "Second"}]


def test_create_appends_at_the_end_with_one_event(as_user, db_url):
    client, ada, board_id = board_with(as_user, db_url)
    add_list(db_url, board_id, "Old", 7.0, archived_by=ada, archived_at=_now())
    add_list(db_url, board_id, "A", 2.0)
    before = len(events(db_url))

    response = client.post(url(board_id), json={"name": "  New  "})

    assert response.status_code == 201
    body = response.json()
    assert set(body) == {"id", "name"} and body["name"] == "New"
    assert names(client.get(url(board_id))) == ["A", "New"]
    assert list_row(db_url, body["id"]).position == 8.0
    [event] = events(db_url)[before:]
    assert (event.actor_id, event.board_id, event.subject_type, event.subject_id) == (
        ada,
        board_id,
        "list",
        str(body["id"]),
    )
    assert (event.kind, event.data) == ("list.created", {"name": "New"})


def test_the_first_list_gets_position_one(as_user, db_url):
    client, _ada, board_id = board_with(as_user, db_url)

    list_id = client.post(url(board_id), json={"name": "A"}).json()["id"]

    assert list_row(db_url, list_id).position == 1.0


@pytest.mark.parametrize("name", ["x" * 80, " y "])
def test_valid_names_are_accepted_and_trimmed(as_user, db_url, name):
    client, _ada, board_id = board_with(as_user, db_url)

    response = client.post(url(board_id), json={"name": name})

    assert response.status_code == 201
    assert response.json()["name"] == name.strip()


@pytest.mark.parametrize(
    "body",
    [
        {"name": "x" * 81},
        {"name": ""},
        {"name": "   "},
        {"name": "​"},
        {"name": " ​‌‍⁠﻿ "},
        {"name": "a\x00b"},
        {"name": "a\nb"},
        {"name": "⠀"},
        {"name": "ab"},
        {},
    ],
)
def test_bad_names_are_rejected_with_no_row_and_no_event(as_user, db_url, body):
    client, _ada, board_id = board_with(as_user, db_url)
    before = len(events(db_url))

    response = client.post(url(board_id), json=body)

    assert response.status_code == 422
    assert all_rows(db_url, board_id) == []
    assert len(events(db_url)) == before


def test_extra_fields_are_rejected(as_user, db_url):
    client, _ada, board_id = board_with(as_user, db_url)
    list_id = add_list(db_url, board_id, "A", 1.0)

    assert client.post(url(board_id), json={"name": "X", "position": 3}).status_code == 422
    assert client.patch(url(board_id, list_id), json={"name": "X", "extra": 1}).status_code == 422
    assert (
        client.post(url(board_id, list_id, "move"), json={"after_id": None, "x": 1}).status_code
        == 422
    )


def test_the_51st_list_is_refused_and_an_archive_frees_a_slot(as_user, db_url):
    client, ada, board_id = board_with(as_user, db_url)
    ids = [add_list(db_url, board_id, f"L{i}", float(i)) for i in range(1, 51)]
    before = len(events(db_url))

    response = client.post(url(board_id), json={"name": "One too many"})

    assert response.status_code == 422
    assert response.json() == {"detail": "list_limit"}
    assert len(all_rows(db_url, board_id)) == 50
    assert len(events(db_url)) == before

    assert client.post(url(board_id, ids[0], "archive")).status_code == 200
    assert client.post(url(board_id), json={"name": "Fits now"}).status_code == 201


def test_two_creates_for_the_last_slot_let_one_through(as_user, db_url):
    a = as_user("ada@example.com", "sub-ada")
    b = as_user("bob@example.com", "sub-bob")
    ada = user_by_email(db_url, "ada@example.com").id
    bob = user_by_email(db_url, "bob@example.com").id
    board_id = add_board(db_url, ada, "B", "workspace", {ada: "member", bob: "member"})
    for i in range(1, 50):
        add_list(db_url, board_id, f"L{i}", float(i))
    before = len(events(db_url))
    barrier = threading.Barrier(2)
    statuses: list[int] = []

    def create(client):
        barrier.wait()
        statuses.append(client.post(url(board_id), json={"name": "Last"}).status_code)

    threads = [threading.Thread(target=create, args=(c,)) for c in (a, b)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert sorted(statuses) == [201, 422]
    assert len(all_rows(db_url, board_id)) == 50
    assert len(events(db_url)) == before + 1


# ---- rename ---------------------------------------------------------------------


def test_rename_changes_the_name_and_writes_one_event(as_user, db_url):
    client, ada, board_id = board_with(as_user, db_url)
    list_id = add_list(db_url, board_id, "Old", 1.0)
    before = len(events(db_url))

    response = client.patch(url(board_id, list_id), json={"name": " New "})

    assert response.status_code == 200
    assert response.json() == {"id": list_id, "name": "New"}
    [event] = events(db_url)[before:]
    assert (event.kind, event.actor_id, event.board_id, event.subject_id) == (
        "list.renamed",
        ada,
        board_id,
        str(list_id),
    )
    assert event.data == {"from": "Old", "to": "New"}


def test_renaming_to_the_same_name_is_ok_and_writes_no_event(as_user, db_url):
    client, _ada, board_id = board_with(as_user, db_url)
    list_id = add_list(db_url, board_id, "Same", 1.0)
    before = len(events(db_url))

    response = client.patch(url(board_id, list_id), json={"name": "Same"})

    assert response.status_code == 200
    assert response.json() == {"id": list_id, "name": "Same"}
    assert len(events(db_url)) == before


def test_a_rename_that_lost_a_race_writes_no_event(as_user, db_url, monkeypatch):
    client, _ada, board_id = board_with(as_user, db_url)
    list_id = add_list(db_url, board_id, "Old", 1.0)
    before = len(events(db_url))
    interfere(
        monkeypatch,
        lambda: query(db_url, _set(list_id, name="Other")),
        "lists",
    )

    response = client.patch(url(board_id, list_id), json={"name": "New"})

    assert response.status_code == 200
    assert response.json() == {"id": list_id, "name": "Other"}
    assert len(events(db_url)) == before


def _set(list_id, **values):
    def write(s):
        s.execute(update(BoardList).where(BoardList.id == list_id).values(**values))
        s.commit()

    return write


# ---- move -----------------------------------------------------------------------


def three_lists(db_url, board_id):
    return [add_list(db_url, board_id, n, float(i)) for i, n in enumerate("ABC", start=1)]


@pytest.mark.parametrize(
    ("mover", "after", "expected"),
    [
        (2, None, ["C", "A", "B"]),  # to the front
        (0, 1, ["B", "A", "C"]),  # to the middle
        (0, 2, ["B", "C", "A"]),  # to the end
        (2, 0, ["A", "C", "B"]),
        (1, None, ["B", "A", "C"]),
    ],
)
def test_move_reorders_the_lists(as_user, db_url, mover, after, expected):
    client, ada, board_id = board_with(as_user, db_url)
    ids = three_lists(db_url, board_id)
    before = len(events(db_url))
    after_id = None if after is None else ids[after]

    response = client.post(url(board_id, ids[mover], "move"), json={"after_id": after_id})

    assert response.status_code == 200
    assert names(client.get(url(board_id))) == expected
    [event] = events(db_url)[before:]
    assert (event.kind, event.actor_id, event.board_id, event.subject_id) == (
        "list.moved",
        ada,
        board_id,
        str(ids[mover]),
    )
    assert event.data == {"after_id": after_id}


@pytest.mark.parametrize(("mover", "after"), [(0, None), (1, 0), (2, 1)])
def test_a_move_that_changes_nothing_writes_no_event(as_user, db_url, mover, after):
    client, _ada, board_id = board_with(as_user, db_url)
    ids = three_lists(db_url, board_id)
    before = len(events(db_url))
    after_id = None if after is None else ids[after]

    response = client.post(url(board_id, ids[mover], "move"), json={"after_id": after_id})

    assert response.status_code == 200
    assert names(client.get(url(board_id))) == ["A", "B", "C"]
    assert len(events(db_url)) == before


def test_moving_a_list_after_itself_is_invalid(as_user, db_url):
    client, _ada, board_id = board_with(as_user, db_url)
    ids = three_lists(db_url, board_id)

    response = client.post(url(board_id, ids[0], "move"), json={"after_id": ids[0]})

    assert response.status_code == 422


def test_a_missing_or_archived_or_foreign_anchor_is_a_conflict(as_user, db_url):
    client, ada, board_id = board_with(as_user, db_url)
    ids = three_lists(db_url, board_id)
    archived = add_list(db_url, board_id, "Gone", 9.0, archived_by=ada, archived_at=_now())
    other_board = add_board(db_url, ada, "Other", "workspace", {ada: "owner"})
    foreign = add_list(db_url, other_board, "Elsewhere", 1.0)
    before = len(events(db_url))

    for anchor in (archived, foreign, 99999):
        response = client.post(url(board_id, ids[0], "move"), json={"after_id": anchor})
        assert response.status_code == 409, anchor
        assert response.json() == {"detail": "conflict"}

    assert names(client.get(url(board_id))) == ["A", "B", "C"]
    assert len(events(db_url)) == before


def test_an_anchor_archived_mid_request_is_a_conflict(as_user, db_url, monkeypatch):
    client, ada, board_id = board_with(as_user, db_url)
    ids = three_lists(db_url, board_id)
    before = len(events(db_url))
    interfere(
        monkeypatch,
        lambda: query(db_url, _set(ids[1], archived_at=_now(), archived_by=ada)),
        "lists",
    )

    response = client.post(url(board_id, ids[0], "move"), json={"after_id": ids[1]})

    assert response.status_code == 409
    assert response.json() == {"detail": "conflict"}
    assert len(events(db_url)) == before


@pytest.mark.parametrize("gap", [0.0, 1.0])
def test_a_used_up_gap_renumbers_the_board_and_still_places_the_list(as_user, db_url, gap):
    client, ada, board_id = board_with(as_user, db_url)
    tight = math.nextafter(1.0, 2) if gap == 0.0 else 2.0
    a = add_list(db_url, board_id, "A", 1.0)
    b = add_list(db_url, board_id, "B", tight)
    c = add_list(db_url, board_id, "C", 5.0)
    add_list(db_url, board_id, "Gone", 0.5, archived_by=ada, archived_at=_now())

    response = client.post(url(board_id, c, "move"), json={"after_id": a})

    assert response.status_code == 200
    assert names(client.get(url(board_id))) == ["A", "C", "B"]
    if gap == 0.0:
        positions = {row[0]: row[2] for row in all_rows(db_url, board_id)}
        # renumbered 1..n in (position, id) order, archived included, then C between A and B
        assert positions[a] == 2.0 and positions[b] == 3.0 and positions[c] == 2.5
        assert sorted(positions.values()) == [1.0, 2.0, 2.5, 3.0]


# ---- archive and restore --------------------------------------------------------


def test_archive_hides_the_list_sets_the_fields_and_writes_an_event(as_user, db_url):
    client, ada, board_id = board_with(as_user, db_url)
    a, b, _c = three_lists(db_url, board_id)
    before = len(events(db_url))

    response = client.post(url(board_id, b, "archive"))

    assert response.status_code == 200
    assert names(client.get(url(board_id))) == ["A", "C"]
    row = list_row(db_url, b)
    assert row.archived_at is not None and row.archived_by == ada
    [event] = events(db_url)[before:]
    assert (event.kind, event.actor_id, event.board_id, event.subject_id) == (
        "list.archived",
        ada,
        board_id,
        str(b),
    )
    assert event.data == {"name": "B"}
    untouched = list_row(db_url, a)
    assert (untouched.name, untouched.archived_at, untouched.archived_by) == ("A", None, None)


@pytest.mark.parametrize(
    ("method", "suffix", "body"),
    [
        ("PATCH", "", {"name": "X"}),
        ("POST", "/move", {"after_id": None}),
        ("POST", "/archive", None),
    ],
)
def test_an_archived_list_is_not_found_for_writes(as_user, db_url, method, suffix, body):
    client, ada, board_id = board_with(as_user, db_url)
    list_id = add_list(db_url, board_id, "Gone", 1.0, archived_by=ada, archived_at=_now())
    before = len(events(db_url))

    response = client.request(method, url(board_id, list_id) + suffix, json=body)

    assert response.status_code == 404
    assert response.json() == {"detail": "list_not_found"}
    assert len(events(db_url)) == before


def test_archiving_twice_is_not_found(as_user, db_url):
    client, _ada, board_id = board_with(as_user, db_url)
    list_id = add_list(db_url, board_id, "A", 1.0)
    assert client.post(url(board_id, list_id, "archive")).status_code == 200

    response = client.post(url(board_id, list_id, "archive"))

    assert response.status_code == 404
    assert response.json() == {"detail": "list_not_found"}


def test_restore_returns_the_list_to_its_old_place_with_an_event(as_user, db_url):
    client, ada, board_id = board_with(as_user, db_url)
    _a, b, _c = three_lists(db_url, board_id)
    assert client.post(url(board_id, b, "archive")).status_code == 200
    before = len(events(db_url))

    response = client.post(url(board_id, b, "restore"))

    assert response.status_code == 200
    assert response.json() == {"id": b, "name": "B"}
    assert names(client.get(url(board_id))) == ["A", "B", "C"]
    row = list_row(db_url, b)
    assert row.archived_at is None and row.archived_by is None
    [event] = events(db_url)[before:]
    assert (event.kind, event.actor_id, event.board_id, event.subject_id) == (
        "list.restored",
        ada,
        board_id,
        str(b),
    )
    assert event.data == {"name": "B"}


def test_restoring_a_list_that_is_not_archived_is_not_found(as_user, db_url):
    client, _ada, board_id = board_with(as_user, db_url, "owner")
    list_id = add_list(db_url, board_id, "A", 1.0)
    before = len(events(db_url))

    response = client.post(url(board_id, list_id, "restore"))

    assert response.status_code == 404
    assert response.json() == {"detail": "list_not_found"}
    assert len(events(db_url)) == before


def test_restore_at_50_active_lists_is_refused(as_user, db_url):
    client, ada, board_id = board_with(as_user, db_url, "owner")
    for i in range(1, 51):
        add_list(db_url, board_id, f"L{i}", float(i))
    gone = add_list(db_url, board_id, "Gone", 0.5, archived_by=ada, archived_at=_now())
    before = len(events(db_url))

    response = client.post(url(board_id, gone, "restore"))

    assert response.status_code == 422
    assert response.json() == {"detail": "list_limit"}
    assert list_row(db_url, gone).archived_at is not None
    assert len(events(db_url)) == before


def restore_case(as_user, db_url, *, actor_role, ws_role="member", archiver="self", age=5):
    """An archived list; returns (client, board_id, list_id)."""
    client = as_user("ada@example.com", "sub-ada", ws_role)
    ada = user_by_email(db_url, "ada@example.com").id
    boss = add_user(db_url, "boss@example.com")
    pat = add_user(db_url, "pat@example.com")
    members = {boss: "owner", pat: "member"}
    if actor_role:
        members[ada] = actor_role
    board_id = add_board(db_url, boss, "B", "workspace", members)
    who = {"self": ada, "pat": pat}[archiver]
    at = _now() - timedelta(seconds=age)
    list_id = add_list(db_url, board_id, "Gone", 1.0, archived_by=who, archived_at=at)
    return client, board_id, list_id


@pytest.mark.parametrize(
    ("kwargs", "status"),
    [
        ({"actor_role": "owner", "archiver": "pat", "age": 3600}, 200),
        ({"actor_role": None, "ws_role": "admin", "archiver": "pat", "age": 3600}, 200),
        ({"actor_role": "member", "archiver": "self", "age": 5}, 200),
        ({"actor_role": "member", "archiver": "self", "age": 61}, 403),
        ({"actor_role": "member", "archiver": "pat", "age": 5}, 403),
        ({"actor_role": "observer", "archiver": "self", "age": 5}, 403),
        ({"actor_role": None, "archiver": "self", "age": 5}, 403),
    ],
)
def test_restore_permissions(as_user, db_url, kwargs, status):
    client, board_id, list_id = restore_case(as_user, db_url, **kwargs)
    before = len(events(db_url))

    response = client.post(url(board_id, list_id, "restore"))

    assert response.status_code == status, response.text
    if status == 200:
        assert list_row(db_url, list_id).archived_at is None
        assert len(events(db_url)) == before + 1
    else:
        assert response.json() == {"detail": "forbidden"}
        assert list_row(db_url, list_id).archived_at is not None
        assert len(events(db_url)) == before


def test_a_private_outsider_cannot_restore(as_user, db_url):
    client = as_user("ada@example.com", "sub-ada")
    boss = add_user(db_url, "boss@example.com")
    board_id = add_board(db_url, boss, "B", "private", {boss: "owner"})
    list_id = add_list(db_url, board_id, "Gone", 1.0, archived_by=boss, archived_at=_now())

    response = client.post(url(board_id, list_id, "restore"))

    assert response.status_code == 404
    assert response.json() == {"detail": "board_not_found"}


def test_restore_that_would_pass_1000_visible_cards_is_refused(as_user, db_url):
    client, ada, board_id = board_with(as_user, db_url, "owner")
    live = add_list(db_url, board_id, "Live", 1.0)
    gone = add_list(db_url, board_id, "Gone", 2.0, archived_by=ada, archived_at=_now())
    add_cards(db_url, board_id, live, 999)
    add_card(db_url, board_id, gone, "A", 1.0)
    add_card(db_url, board_id, gone, "B", 2.0)
    before = len(events(db_url))

    response = client.post(url(board_id, gone, "restore"))

    assert response.status_code == 422
    assert response.json() == {"detail": "card_limit"}
    assert list_row(db_url, gone).archived_at is not None
    assert len(events(db_url)) == before


def test_restore_up_to_exactly_1000_visible_cards_is_fine(as_user, db_url):
    client, ada, board_id = board_with(as_user, db_url, "owner")
    live = add_list(db_url, board_id, "Live", 1.0)
    gone = add_list(db_url, board_id, "Gone", 2.0, archived_by=ada, archived_at=_now())
    add_cards(db_url, board_id, live, 999)
    add_card(db_url, board_id, gone, "A", 1.0)

    assert client.post(url(board_id, gone, "restore")).status_code == 200


# ---- other boards and archived boards -------------------------------------------


@pytest.mark.parametrize(
    ("method", "suffix", "body"),
    [
        ("PATCH", "", {"name": "X"}),
        ("POST", "/move", {"after_id": None}),
        ("POST", "/archive", None),
        ("POST", "/restore", None),
    ],
)
def test_a_list_of_another_board_is_not_found_and_left_unchanged(
    as_user, db_url, method, suffix, body
):
    client, ada, board_a = board_with(as_user, db_url, "owner")
    board_b = add_board(db_url, ada, "Other", "workspace", {ada: "owner"})
    foreign = add_list(db_url, board_b, "Theirs", 1.0, archived_by=ada, archived_at=_now())
    rows = all_rows(db_url, board_b)
    before = len(events(db_url))

    response = client.request(method, url(board_a, foreign) + suffix, json=body)

    assert response.status_code == 404
    assert response.json() == {"detail": "list_not_found"}
    assert all_rows(db_url, board_b) == rows
    assert len(events(db_url)) == before


def test_an_unknown_list_is_not_found(as_user, db_url):
    client, _ada, board_id = board_with(as_user, db_url)

    response = client.patch(url(board_id, 99999), json={"name": "X"})

    assert response.status_code == 404
    assert response.json() == {"detail": "list_not_found"}


def test_every_route_is_board_not_found_on_an_archived_board(as_user, db_url):
    client, ada, board_id = board_with(as_user, db_url, "owner")
    list_id = add_list(db_url, board_id, "A", 1.0)
    set_board_columns(db_url, board_id, archived_at=_now())
    before = len(events(db_url))

    for method, _path, body in ROUTES:
        path = _path.replace("/boards/1/", f"/boards/{board_id}/").replace(
            "/lists/1", f"/lists/{list_id}"
        )
        response = client.request(method, path, json=body)
        assert response.status_code == 404, (method, path)
        assert response.json() == {"detail": "board_not_found"}

    assert len(events(db_url)) == before


# ---- atomicity ------------------------------------------------------------------


def test_a_failing_event_insert_leaves_no_list_and_no_event(as_user, db_url, monkeypatch):
    from taskboard import lists

    client, _ada, board_id = board_with(as_user, db_url)
    real = lists.record_change
    before = len(events(db_url))

    def boom(session, change, **kw):
        return real(session, lambda s: (change(s), 1 / 0)[0], **kw)

    monkeypatch.setattr(lists, "record_change", boom)
    with pytest.raises(ZeroDivisionError):
        client.post(url(board_id), json={"name": "X"})

    assert all_rows(db_url, board_id) == []
    assert len(events(db_url)) == before


# ---- role matrix ----------------------------------------------------------------

ACTIONS = {
    "get": (200, lambda c, b, ids: c.get(url(b))),
    "create": (201, lambda c, b, ids: c.post(url(b), json={"name": "New"})),
    "rename": (200, lambda c, b, ids: c.patch(url(b, ids[0]), json={"name": "Renamed"})),
    "move": (200, lambda c, b, ids: c.post(url(b, ids[0], "move"), json={"after_id": ids[1]})),
    "archive": (200, lambda c, b, ids: c.post(url(b, ids[0], "archive"))),
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
        expected = "allow"  # anyone who can see the board can read its lists
    client = as_user("actor@example.com", "sub-actor", ws_role)
    actor_id = user_by_email(db_url, "actor@example.com").id
    boss = add_user(db_url, "boss@example.com")
    members = {boss: "owner"}
    if row_role:
        members[actor_id] = row_role
    board_id = add_board(db_url, boss, "B", visibility, members)
    ids = [add_list(db_url, board_id, "A", 1.0), add_list(db_url, board_id, "B", 2.0)]
    rows = all_rows(db_url, board_id)
    before = len(events(db_url))
    success, call = ACTIONS[action]

    response = call(client, board_id, ids)

    if expected == "allow":
        assert response.status_code == success, response.text
        if action == "get":
            assert len(events(db_url)) == before
        else:
            [event] = events(db_url)[before:]
            assert event.actor_id == actor_id and event.board_id == board_id
    else:
        assert response.status_code == expected, response.text
        assert response.json() == {"detail": "forbidden" if expected == 403 else "board_not_found"}
        assert len(events(db_url)) == before
        assert all_rows(db_url, board_id) == rows


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
    "create": lambda c, b, ids: c.post(url(b), json={"name": "New"}),
    "rename": lambda c, b, ids: c.patch(url(b, ids[0]), json={"name": "Renamed"}),
    "move": lambda c, b, ids: c.post(url(b, ids[0], "move"), json={"after_id": ids[1]}),
    "archive": lambda c, b, ids: c.post(url(b, ids[0], "archive")),
}


@pytest.mark.parametrize("change", ["demoted", "board_archived"])
@pytest.mark.parametrize("action", list(MID_REQUEST))
def test_a_role_lost_mid_request_writes_nothing(as_user, db_url, monkeypatch, action, change):
    client, ada, board_id = board_with(as_user, db_url)
    ids = [add_list(db_url, board_id, "A", 1.0), add_list(db_url, board_id, "B", 2.0)]
    rows = all_rows(db_url, board_id)
    before = len(events(db_url))
    if change == "demoted":
        interfere(monkeypatch, _demote(db_url, board_id, ada, "observer"), "lists")
        status, detail = 403, "forbidden"
    else:
        interfere(
            monkeypatch,
            lambda: set_board_columns(db_url, board_id, archived_at=_now()),
            "lists",
        )
        status, detail = 404, "board_not_found"

    response = MID_REQUEST[action](client, board_id, ids)

    assert response.status_code == status, response.text
    assert response.json() == {"detail": detail}
    assert len(events(db_url)) == before
    assert all_rows(db_url, board_id) == rows


@pytest.mark.parametrize("change", ["demoted", "board_archived"])
def test_a_restore_after_losing_the_role_mid_request_writes_nothing(
    as_user, db_url, monkeypatch, change
):
    client, board_id, list_id = restore_case(
        as_user, db_url, actor_role="owner", archiver="pat", age=3600
    )
    ada = user_by_email(db_url, "ada@example.com").id
    rows = all_rows(db_url, board_id)
    before = len(events(db_url))
    if change == "demoted":
        # owner -> member: the 60-second window no longer lets her restore Pat's old archive
        interfere(monkeypatch, _demote(db_url, board_id, ada, "member"), "lists")
        status, detail = 403, "forbidden"
    else:
        interfere(
            monkeypatch,
            lambda: set_board_columns(db_url, board_id, archived_at=_now()),
            "lists",
        )
        status, detail = 404, "board_not_found"

    response = client.post(url(board_id, list_id, "restore"))

    assert response.status_code == status, response.text
    assert response.json() == {"detail": detail}
    assert len(events(db_url)) == before
    assert all_rows(db_url, board_id) == rows


def test_an_archive_records_the_name_a_concurrent_rename_left(as_user, db_url, monkeypatch):
    client, _ada, board_id = board_with(as_user, db_url)
    list_id = add_list(db_url, board_id, "Old", 1.0)
    before = len(events(db_url))
    interfere(monkeypatch, lambda: query(db_url, _set(list_id, name="Newer")), "lists")

    response = client.post(url(board_id, list_id, "archive"))

    assert response.status_code == 200
    assert response.json() == {"id": list_id, "name": "Newer"}
    [event] = events(db_url)[before:]
    assert (event.kind, event.data) == ("list.archived", {"name": "Newer"})


# ---- after_id is a strict positive integer or null ------------------------------


@pytest.mark.parametrize("after_id", [True, False, "5", 5.0, 0, -1, 2**63])
def test_a_bad_after_id_is_rejected(as_user, db_url, after_id):
    client, _ada, board_id = board_with(as_user, db_url)
    ids = three_lists(db_url, board_id)
    before = len(events(db_url))

    response = client.post(url(board_id, ids[0], "move"), json={"after_id": after_id})

    assert response.status_code == 422
    assert len(events(db_url)) == before


def test_a_null_or_valid_after_id_still_works(as_user, db_url):
    client, _ada, board_id = board_with(as_user, db_url)
    _a, b, c = three_lists(db_url, board_id)

    assert client.post(url(board_id, c, "move"), json={"after_id": None}).status_code == 200
    assert client.post(url(board_id, c, "move"), json={"after_id": b}).status_code == 200
    assert names(client.get(url(board_id))) == ["A", "B", "C"]
