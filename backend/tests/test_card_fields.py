"""Card detail fields: labels, assignees, due date and description, with roles and events."""

from datetime import datetime

import pytest
from sqlalchemy import delete, event, update
from support import (
    add_board,
    add_card,
    add_card_label,
    add_card_member,
    add_cards,
    add_list,
    add_user,
    card_label_ids,
    card_member_ids,
    events,
    interfere,
    query,
    set_board_columns,
    user_by_email,
)

from taskboard.models import BoardList, BoardMember, Card, CardMember, WorkspaceMember, _now

LABEL_NAMES = ["Launch", "Bug", "Docs", "Ops", "Marketing", "Research", "Design"]
TILE_KEYS = {
    "id",
    "key",
    "list_id",
    "title",
    "label_ids",
    "member_ids",
    "due_on",
    "has_description",
}


def curl(board_id, card_id, *rest):
    return "/".join(["/api/boards", str(board_id), "cards", str(card_id), *map(str, rest)])


def detail(card_id, key, list_id, title, **extra):
    """The card detail for a card with nothing set, with `extra` overriding fields."""
    return {
        "id": card_id,
        "key": key,
        "list_id": list_id,
        "title": title,
        "label_ids": [],
        "member_ids": [],
        "due_on": None,
        "has_description": False,
        "description": None,
        **extra,
    }


def card_row(db_url, card_id):
    return query(db_url, lambda s: s.get(Card, card_id))


def state(db_url, card_id):
    """Everything a write could change on a card, for before/after comparison."""
    row = card_row(db_url, card_id)
    return (
        row.title,
        row.description,
        row.due_at,
        row.archived_at,
        row.list_id,
        card_member_ids(db_url, card_id),
        card_label_ids(db_url, card_id),
    )


def card_events(db_url):
    return [e for e in events(db_url) if e.subject_type == "card"]


def world(as_user, db_url, role="member", visibility="workspace"):
    """The actor (ada, with `role`), a board with one list and card TB-1, plus two teammates.

    Returns a namespace-like dict: client, ada, boss (owner), cy (member), board, list, card.
    """
    client = as_user("ada@example.com", "sub-ada")
    ada = user_by_email(db_url, "ada@example.com").id
    boss = add_user(db_url, "boss@example.com")
    cy = add_user(db_url, "cy@example.com")
    members = {boss: "owner", cy: "member"}
    if role:
        members[ada] = role
    board_id = add_board(db_url, boss, "B", visibility, members)
    list_id = add_list(db_url, board_id, "L", 1.0)
    card_id = add_card(db_url, board_id, list_id, "A", 1.0)
    return {
        "client": client,
        "ada": ada,
        "boss": boss,
        "cy": cy,
        "board": board_id,
        "list": list_id,
        "card": card_id,
    }


# ---- not signed in ---------------------------------------------------------------

ROUTES = [
    ("GET", "/api/labels", None),
    ("GET", "/api/boards/1/cards/1", None),
    ("PATCH", "/api/boards/1/cards/1", {"title": "X"}),
    ("PUT", "/api/boards/1/cards/1/members/2", None),
    ("DELETE", "/api/boards/1/cards/1/members/2", None),
    ("PUT", "/api/boards/1/cards/1/labels/2", None),
    ("DELETE", "/api/boards/1/cards/1/labels/2", None),
]


@pytest.mark.parametrize(("method", "path", "body"), ROUTES)
def test_the_new_routes_need_a_session(client, method, path, body):
    response = client.request(method, path, json=body)

    assert response.status_code == 401
    assert response.json() == {"detail": "not_signed_in"}


# ---- labels ----------------------------------------------------------------------


def test_labels_list_the_seven_in_order(as_user):
    client = as_user("ada@example.com", "sub-ada")

    response = client.get("/api/labels")

    assert response.status_code == 200
    assert response.json() == [
        {"id": i, "name": n, "color": n.lower()} for i, n in enumerate(LABEL_NAMES, start=1)
    ]


def test_labels_are_for_workspace_members_only(as_user, db_url):
    client = as_user("ghost@example.com", "sub-ghost")
    ghost = user_by_email(db_url, "ghost@example.com").id
    query(db_url, lambda s: (s.delete(s.get(WorkspaceMember, ghost)), s.commit()))

    response = client.get("/api/labels")

    assert response.status_code == 403
    assert response.json() == {"detail": "forbidden"}


# ---- reads -----------------------------------------------------------------------


def test_the_tile_list_and_the_detail_carry_the_new_fields(as_user, db_url):
    w = world(as_user, db_url, "observer")
    due = datetime(2026, 7, 4, 15, 30)
    full = add_card(
        db_url, w["board"], w["list"], "Full", 2.0, description="Some **text**", due_at=due
    )
    for label in (3, 1):
        add_card_label(db_url, full, label)
    for user in (w["cy"], w["boss"]):
        add_card_member(db_url, full, user)
    stranger = add_user(db_url, "stranger@example.com")
    add_card_member(db_url, full, stranger)  # not on the board: never sent

    tiles = w["client"].get(f"/api/boards/{w['board']}/cards")
    one = w["client"].get(curl(w["board"], full))

    members = sorted([w["boss"], w["cy"]])
    assert tiles.status_code == 200 and one.status_code == 200
    assert tiles.json()[1] == {
        "id": full,
        "key": "TB-2",
        "list_id": w["list"],
        "title": "Full",
        "label_ids": [1, 3],
        "member_ids": members,
        "due_on": "2026-07-04",
        "has_description": True,
    }
    assert set(tiles.json()[0]) == TILE_KEYS
    assert one.json() == {**tiles.json()[1], "description": "Some **text**"}
    assert w["client"].get(curl(w["board"], w["card"])).json() == detail(
        w["card"], "TB-1", w["list"], "A"
    )


def test_a_card_with_an_empty_description_has_none(as_user, db_url):
    w = world(as_user, db_url)
    empty = add_card(db_url, w["board"], w["list"], "E", 2.0, description="")

    tiles = w["client"].get(f"/api/boards/{w['board']}/cards").json()

    assert [t["has_description"] for t in tiles] == [False, False]
    assert empty


def _count_queries(app, call):
    seen = []

    def count(_conn, _cursor, statement, *_args):
        seen.append(statement)

    event.listen(app.state.engine, "before_cursor_execute", count)
    try:
        response = call()
    finally:
        event.remove(app.state.engine, "before_cursor_execute", count)
    assert response.status_code == 200
    return len(seen)


def test_the_number_of_queries_does_not_grow_with_the_cards(as_user, db_url, app):
    w = world(as_user, db_url)
    url = f"/api/boards/{w['board']}/cards"

    def fill(n):
        for i in range(n):
            card = add_card(db_url, w["board"], w["list"], f"c{i}", 10.0 + i)
            add_card_label(db_url, card, 1 + i % 7)
            add_card_member(db_url, card, [w["boss"], w["cy"]][i % 2])

    fill(2)
    few = _count_queries(app, lambda: w["client"].get(url))
    fill(40)
    many = _count_queries(app, lambda: w["client"].get(url))

    assert len(w["client"].get(url).json()) == 43
    assert many == few


@pytest.mark.parametrize("why", ["archived_card", "archived_list", "foreign_board", "unknown"])
def test_a_card_that_is_not_visible_is_not_found(as_user, db_url, why):
    w = world(as_user, db_url, "owner")
    other = add_board(db_url, w["ada"], "O", "workspace", {w["ada"]: "owner"})
    other_list = add_list(db_url, other, "L", 1.0)
    card = {
        "archived_card": add_card(db_url, w["board"], w["list"], "x", 2.0, archived_at=_now()),
        "archived_list": add_card(
            db_url,
            w["board"],
            add_list(db_url, w["board"], "G", 2.0, archived_by=w["ada"], archived_at=_now()),
            "y",
            1.0,
        ),
        "foreign_board": add_card(db_url, other, other_list, "z", 1.0),
        "unknown": 99999,
    }[why]

    response = w["client"].get(curl(w["board"], card))

    assert response.status_code == 404
    assert response.json() == {"detail": "card_not_found"}


# ---- not found on every route ----------------------------------------------------

WRITES = {
    "title": lambda c, b, card, w: c.patch(curl(b, card), json={"title": "New"}),
    "description": lambda c, b, card, w: c.patch(curl(b, card), json={"description": "Text"}),
    "due": lambda c, b, card, w: c.patch(curl(b, card), json={"due_on": "2026-03-09"}),
    "member_add": lambda c, b, card, w: c.put(curl(b, card, "members", w["cy"])),
    "member_remove": lambda c, b, card, w: c.delete(curl(b, card, "members", w["boss"])),
    "label_add": lambda c, b, card, w: c.put(curl(b, card, "labels", 2)),
    "label_remove": lambda c, b, card, w: c.delete(curl(b, card, "labels", 1)),
}
READS = {"get": lambda c, b, card, w: c.get(curl(b, card))}
EVERY = {**READS, **WRITES}


@pytest.mark.parametrize("action", list(EVERY))
@pytest.mark.parametrize("why", ["archived_card", "archived_list", "foreign_board", "unknown"])
def test_every_route_says_card_not_found_for_a_hidden_card(as_user, db_url, action, why):
    w = world(as_user, db_url, "owner")
    other = add_board(db_url, w["ada"], "O", "workspace", {w["ada"]: "owner"})
    foreign = add_card(db_url, other, add_list(db_url, other, "L", 1.0), "z", 1.0)
    gone = add_list(db_url, w["board"], "G", 2.0, archived_by=w["ada"], archived_at=_now())
    card = {
        "archived_card": add_card(db_url, w["board"], w["list"], "x", 2.0, archived_at=_now()),
        "archived_list": add_card(db_url, w["board"], gone, "y", 1.0),
        "foreign_board": foreign,
        "unknown": 99999,
    }[why]
    for target in {card, foreign} - {99999}:
        add_card_label(db_url, target, 1)
        add_card_member(db_url, target, w["boss"])
    snapshot = {c: state(db_url, c) for c in (card, foreign) if c != 99999}
    before = len(events(db_url))

    response = EVERY[action](w["client"], w["board"], card, w)

    assert response.status_code == 404, response.text
    assert response.json() == {"detail": "card_not_found"}
    assert len(events(db_url)) == before
    assert {c: state(db_url, c) for c in snapshot} == snapshot


@pytest.mark.parametrize("action", list(EVERY))
def test_every_route_says_board_not_found_on_an_archived_board(as_user, db_url, action):
    w = world(as_user, db_url, "owner")
    set_board_columns(db_url, w["board"], archived_at=_now())
    snapshot = state(db_url, w["card"])
    before = len(events(db_url))

    response = EVERY[action](w["client"], w["board"], w["card"], w)

    assert response.status_code == 404
    assert response.json() == {"detail": "board_not_found"}
    assert len(events(db_url)) == before
    assert state(db_url, w["card"]) == snapshot


# ---- the role matrix: 6 actors x 2 visibilities x 8 actions ---------------------

# actor -> (workspace role, board row role, status on a Workspace board, on a Private board)
ACTORS = {
    "owner": ("member", "owner", "allow", "allow"),
    "member": ("member", "member", "allow", "allow"),
    "observer": ("member", "observer", 403, 403),
    "outsider": ("member", None, 403, 404),
    "admin": ("admin", None, "allow", 404),
    "admin_observer": ("admin", "observer", "allow", "allow"),
}

# action -> (call, event kind, event data builder, expected detail overrides)
MATRIX = {
    "get": (lambda c, b, card, w: c.get(curl(b, card)), None),
    "title": (
        WRITES["title"],
        ("card.renamed", lambda w: {"key": "TB-1", "from": "A", "to": "New"}),
    ),
    "description": (
        WRITES["description"],
        ("card.described", lambda w: {"key": "TB-1", "cleared": False}),
    ),
    "due": (
        WRITES["due"],
        ("card.due_changed", lambda w: {"key": "TB-1", "from": None, "to": "2026-03-09"}),
    ),
    "member_add": (
        WRITES["member_add"],
        ("card.member_added", lambda w: {"key": "TB-1", "user_id": w["cy"]}),
    ),
    "member_remove": (
        WRITES["member_remove"],
        ("card.member_removed", lambda w: {"key": "TB-1", "user_id": w["boss"]}),
    ),
    "label_add": (
        WRITES["label_add"],
        ("card.label_added", lambda w: {"key": "TB-1", "label_id": 2, "name": "Bug"}),
    ),
    "label_remove": (
        WRITES["label_remove"],
        ("card.label_removed", lambda w: {"key": "TB-1", "label_id": 1, "name": "Launch"}),
    ),
}


def expected_detail(action, w):
    """The card as the matrix leaves it: label 1 and the boss start on it."""
    base = {"label_ids": [1], "member_ids": [w["boss"]]}
    changes = {
        "get": {},
        "title": {"title": "New"},
        "description": {"description": "Text", "has_description": True},
        "due": {"due_on": "2026-03-09"},
        "member_add": {"member_ids": sorted([w["boss"], w["cy"]])},
        "member_remove": {"member_ids": []},
        "label_add": {"label_ids": [1, 2]},
        "label_remove": {"label_ids": []},
    }[action]
    merged = {**base, **changes}
    return detail(w["card"], "TB-1", w["list"], merged.pop("title", "A"), **merged)


@pytest.mark.parametrize("visibility", ["workspace", "private"])
@pytest.mark.parametrize("actor", list(ACTORS))
@pytest.mark.parametrize("action", list(MATRIX))
def test_role_matrix(as_user, db_url, action, actor, visibility):
    ws_role, row_role, on_workspace, on_private = ACTORS[actor]
    expected = on_workspace if visibility == "workspace" else on_private
    if action == "get" and expected == 403:
        expected = "allow"
    client = as_user("actor@example.com", "sub-actor", ws_role)
    actor_id = user_by_email(db_url, "actor@example.com").id
    boss = add_user(db_url, "boss@example.com")
    cy = add_user(db_url, "cy@example.com")
    members = {boss: "owner", cy: "member"}
    if row_role:
        members[actor_id] = row_role
    board_id = add_board(db_url, boss, "B", visibility, members)
    list_id = add_list(db_url, board_id, "L", 1.0)
    card_id = add_card(db_url, board_id, list_id, "A", 1.0)
    add_card_label(db_url, card_id, 1)
    add_card_member(db_url, card_id, boss)
    w = {"boss": boss, "cy": cy, "card": card_id, "list": list_id}
    snapshot = state(db_url, card_id)
    before = len(events(db_url))
    call, expected_event = MATRIX[action]

    response = call(client, board_id, card_id, w)

    if expected == "allow":
        assert response.status_code == 200, response.text
        assert response.json() == expected_detail(action, w)
        if expected_event is None:
            assert len(events(db_url)) == before
            return
        kind, data = expected_event
        [recorded] = events(db_url)[before:]
        assert (recorded.kind, recorded.actor_id, recorded.board_id) == (kind, actor_id, board_id)
        assert (recorded.subject_type, recorded.subject_id) == ("card", str(card_id))
        assert recorded.data == data(w)
    else:
        assert response.status_code == expected, response.text
        assert response.json() == {"detail": "forbidden" if expected == 403 else "board_not_found"}
        assert len(events(db_url)) == before
        assert state(db_url, card_id) == snapshot


# ---- PATCH: shape and validation --------------------------------------------------


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"title": "x", "due_on": None},
        {"title": "x", "description": "y"},
        {"description": "y", "due_on": "2026-01-01"},
        {"title": None},
        {"unknown": 1},
        {"title": "x", "version": 3},
        {"title": "x" * 201},
        {"title": ""},
        {"title": "   "},
        {"title": "a\x00b"},
        {"title": "a\nb"},
        {"title": "​"},
        {"title": "ㅤ"},
        {"title": 5},
        {"description": 5},
        {"description": ["a"]},
        {"description": "a" * 10_001},
        {"description": "\x00" * 10_001},
        {"description": "<a" * 5_000},
        {"due_on": 20260101},
        {"due_on": True},
        {"due_on": 1.5},
        {"due_on": "2026-01-01T00:00:00"},
        {"due_on": "2026-01-01T00:00:00Z"},
        {"due_on": "2026-02-30"},
        {"due_on": "2026-13-01"},
        {"due_on": "2026-00-10"},
        {"due_on": "0000-01-01"},
        {"due_on": "2026-1-1"},
        {"due_on": "26-01-01"},
        {"due_on": " 2026-01-01"},
        {"due_on": "2026-01-01 "},
        {"due_on": "2026-01-01\n"},
        {"due_on": "٢٠٢٦-٠١-٠١"},
        {"due_on": ""},
        {"due_on": []},
    ],
    ids=lambda b: repr(b)[:60],
)
def test_a_bad_patch_is_refused_with_nothing_written(as_user, db_url, body):
    w = world(as_user, db_url)
    snapshot = state(db_url, w["card"])
    before = len(events(db_url))

    response = w["client"].patch(curl(w["board"], w["card"]), json=body)

    assert response.status_code == 422, response.text
    assert state(db_url, w["card"]) == snapshot
    assert len(events(db_url)) == before


def _error(type_, loc, msg):
    return {"type": type_, "loc": ["body", *loc], "msg": msg}


@pytest.mark.parametrize(
    ("body", "errors"),
    [
        (
            {},
            [
                _error(
                    "value_error", [], "Value error, send exactly one of title, description, due_on"
                )
            ],
        ),
        (
            {"title": None},
            [_error("value_error", [], "Value error, title cannot be cleared")],
        ),
        (
            {"title": ""},
            [_error("string_too_short", ["title"], "String should have at least 1 character")],
        ),
        (
            {"title": "x" * 201},
            [_error("string_too_long", ["title"], "String should have at most 200 characters")],
        ),
        (
            {"unknown": 1},
            [_error("extra_forbidden", ["unknown"], "Extra inputs are not permitted")],
        ),
        (
            {"description": 5},
            [_error("string_type", ["description"], "Input should be a valid string")],
        ),
        (
            {"description": "a" * 10_001},
            [
                _error(
                    "value_error",
                    ["description"],
                    "Value error, text is longer than 10000 characters",
                )
            ],
        ),
        (
            {"due_on": "2026-1-1"},
            [_error("value_error", ["due_on"], "Value error, due_on must be a YYYY-MM-DD string")],
        ),
    ],
    ids=lambda v: repr(v)[:40],
)
def test_a_422_names_the_type_the_place_and_the_message(as_user, db_url, body, errors):
    w = world(as_user, db_url)

    response = w["client"].patch(curl(w["board"], w["card"]), json=body)

    assert response.status_code == 422
    assert response.json() == {"detail": errors}


def test_a_refused_description_is_not_echoed_in_the_422(as_user, db_url):
    w = world(as_user, db_url)
    secret = "TOPSECRETWORDS" * 800  # 11,200 characters: too long

    response = w["client"].patch(curl(w["board"], w["card"]), json={"description": secret})

    assert response.status_code == 422
    assert "TOPSECRET" not in response.text
    assert set(response.json()["detail"][0]) == {"type", "loc", "msg"}


def test_a_description_with_a_lone_surrogate_is_refused(as_user, db_url):
    w = world(as_user, db_url)
    before = len(events(db_url))

    response = w["client"].patch(
        curl(w["board"], w["card"]),
        content=b'{"description": "bad \\ud800 surrogate"}',
        headers={"content-type": "application/json"},
    )

    assert response.status_code == 422
    assert "input" not in response.text  # the refused text is never echoed back
    assert card_row(db_url, w["card"]).description is None
    assert len(events(db_url)) == before


def test_a_patch_that_is_not_json_is_refused(as_user, db_url):
    w = world(as_user, db_url)

    response = w["client"].patch(curl(w["board"], w["card"]), content=b"nope")

    assert response.status_code == 422


# ---- PATCH title ------------------------------------------------------------------


def test_rename_trims_and_writes_one_event(as_user, db_url):
    w = world(as_user, db_url)
    before = len(events(db_url))

    response = w["client"].patch(curl(w["board"], w["card"]), json={"title": "  Better  "})

    assert response.status_code == 200
    assert response.json() == detail(w["card"], "TB-1", w["list"], "Better")
    [recorded] = events(db_url)[before:]
    assert recorded.kind == "card.renamed"
    assert recorded.data == {"key": "TB-1", "from": "A", "to": "Better"}


@pytest.mark.parametrize("title", ["x" * 200, "y"])
def test_titles_of_one_to_200_characters_are_accepted(as_user, db_url, title):
    w = world(as_user, db_url)

    response = w["client"].patch(curl(w["board"], w["card"]), json={"title": title})

    assert response.status_code == 200
    assert response.json()["title"] == title


def test_renaming_to_the_same_title_writes_no_event(as_user, db_url):
    w = world(as_user, db_url)
    before = len(events(db_url))

    response = w["client"].patch(curl(w["board"], w["card"]), json={"title": " A "})

    assert response.status_code == 200
    assert response.json()["title"] == "A"
    assert len(events(db_url)) == before


def test_the_last_save_wins_with_no_version(as_user, db_url):
    w = world(as_user, db_url)
    other = as_user("bob@example.com", "sub-bob")
    bob = user_by_email(db_url, "bob@example.com").id
    query(
        db_url,
        lambda s: (
            s.add(BoardMember(board_id=w["board"], user_id=bob, role="member")),
            s.commit(),
        ),
    )

    first = w["client"].patch(curl(w["board"], w["card"]), json={"title": "From ada"})
    second = other.patch(curl(w["board"], w["card"]), json={"title": "From bob"})

    assert first.status_code == second.status_code == 200
    assert card_row(db_url, w["card"]).title == "From bob"
    assert [e.data["to"] for e in card_events(db_url)] == ["From ada", "From bob"]


# ---- PATCH description ------------------------------------------------------------


def test_a_description_is_stored_as_cleaned_source_and_the_event_has_no_text(as_user, db_url):
    w = world(as_user, db_url)
    before = len(events(db_url))
    raw = "Hi <script>alert(1)</script>**there**\r\n[x](javascript:alert(1)) [ok](https://a.test)"

    response = w["client"].patch(curl(w["board"], w["card"]), json={"description": raw})

    cleaned = "Hi **there**\nx [ok](https://a.test)"
    assert response.status_code == 200
    assert response.json() == detail(
        w["card"], "TB-1", w["list"], "A", description=cleaned, has_description=True
    )
    assert card_row(db_url, w["card"]).description == cleaned
    [recorded] = events(db_url)[before:]
    assert recorded.kind == "card.described"
    assert recorded.data == {"key": "TB-1", "cleared": False}


@pytest.mark.parametrize("clear", [None, "", "  \n\t ", "<script>x</script>"])
def test_a_null_or_blank_description_clears_it(as_user, db_url, clear):
    w = world(as_user, db_url)
    query(
        db_url,
        lambda s: (
            s.execute(update(Card).where(Card.id == w["card"]).values(description="old")),
            s.commit(),
        ),
    )
    before = len(events(db_url))

    response = w["client"].patch(curl(w["board"], w["card"]), json={"description": clear})

    assert response.status_code == 200
    assert response.json()["description"] is None and response.json()["has_description"] is False
    assert card_row(db_url, w["card"]).description is None
    [recorded] = events(db_url)[before:]
    assert recorded.data == {"key": "TB-1", "cleared": True}


def test_clearing_nothing_and_saving_the_same_text_write_no_event(as_user, db_url):
    w = world(as_user, db_url)
    before = len(events(db_url))

    cleared = w["client"].patch(curl(w["board"], w["card"]), json={"description": None})
    saved = w["client"].patch(curl(w["board"], w["card"]), json={"description": "Same"})
    again = w["client"].patch(curl(w["board"], w["card"]), json={"description": "Same"})

    assert cleared.status_code == saved.status_code == again.status_code == 200
    assert cleared.json()["description"] is None
    assert again.json()["description"] == "Same"
    assert len(events(db_url)) == before + 1  # only the real save


def test_a_description_of_exactly_10000_characters_is_accepted(as_user, db_url):
    w = world(as_user, db_url)

    response = w["client"].patch(curl(w["board"], w["card"]), json={"description": "a" * 10_000})

    assert response.status_code == 200
    assert response.json()["description"] == "a" * 10_000


# ---- PATCH due date ---------------------------------------------------------------


def test_a_due_date_is_stored_as_midnight_and_changes_and_clears(as_user, db_url):
    w = world(as_user, db_url)
    before = len(events(db_url))
    url = curl(w["board"], w["card"])

    first = w["client"].patch(url, json={"due_on": "2026-03-09"})
    assert card_row(db_url, w["card"]).due_at == datetime(2026, 3, 9)
    second = w["client"].patch(url, json={"due_on": "2028-02-29"})
    third = w["client"].patch(url, json={"due_on": None})

    assert [r.json()["due_on"] for r in (first, second, third)] == [
        "2026-03-09",
        "2028-02-29",
        None,
    ]
    assert card_row(db_url, w["card"]).due_at is None
    assert [e.data for e in events(db_url)[before:]] == [
        {"key": "TB-1", "from": None, "to": "2026-03-09"},
        {"key": "TB-1", "from": "2026-03-09", "to": "2028-02-29"},
        {"key": "TB-1", "from": "2028-02-29", "to": None},
    ]
    assert {e.kind for e in events(db_url)[before:]} == {"card.due_changed"}


def test_the_same_due_date_or_clearing_none_writes_no_event(as_user, db_url):
    w = world(as_user, db_url)
    dated = add_card(db_url, w["board"], w["list"], "D", 2.0, due_at=datetime(2026, 5, 1, 12, 0))
    before = len(events(db_url))

    clear = w["client"].patch(curl(w["board"], w["card"]), json={"due_on": None})
    same = w["client"].patch(curl(w["board"], dated), json={"due_on": "2026-05-01"})

    assert clear.status_code == same.status_code == 200
    assert same.json()["due_on"] == "2026-05-01"
    assert card_row(db_url, dated).due_at == datetime(2026, 5, 1, 12, 0)
    assert len(events(db_url)) == before


# ---- members ----------------------------------------------------------------------


def test_assigning_and_unassigning_write_one_event_each(as_user, db_url):
    w = world(as_user, db_url)
    before = len(events(db_url))
    url = curl(w["board"], w["card"], "members", w["cy"])

    added = w["client"].put(url)
    removed = w["client"].delete(url)

    assert added.status_code == removed.status_code == 200
    assert added.json() == detail(w["card"], "TB-1", w["list"], "A", member_ids=[w["cy"]])
    assert removed.json() == detail(w["card"], "TB-1", w["list"], "A")
    assert [(e.kind, e.data) for e in events(db_url)[before:]] == [
        ("card.member_added", {"key": "TB-1", "user_id": w["cy"]}),
        ("card.member_removed", {"key": "TB-1", "user_id": w["cy"]}),
    ]


def test_member_ids_come_back_in_a_stable_order(as_user, db_url):
    w = world(as_user, db_url)
    for user in (w["cy"], w["boss"], w["ada"]):
        assert w["client"].put(curl(w["board"], w["card"], "members", user)).status_code == 200

    body = w["client"].get(curl(w["board"], w["card"])).json()
    tiles = w["client"].get(f"/api/boards/{w['board']}/cards").json()

    expected = sorted([w["cy"], w["boss"], w["ada"]])
    assert body["member_ids"] == tiles[0]["member_ids"] == expected


def test_assigning_twice_and_unassigning_a_stranger_are_quiet_no_ops(as_user, db_url):
    w = world(as_user, db_url)
    add_card_member(db_url, w["card"], w["cy"])
    before = len(events(db_url))

    again = w["client"].put(curl(w["board"], w["card"], "members", w["cy"]))
    nobody = w["client"].delete(curl(w["board"], w["card"], "members", w["boss"]))
    unknown = w["client"].delete(curl(w["board"], w["card"], "members", 424242))

    assert again.status_code == nobody.status_code == unknown.status_code == 200
    assert again.json()["member_ids"] == nobody.json()["member_ids"] == [w["cy"]]
    assert len(events(db_url)) == before
    assert card_member_ids(db_url, w["card"]) == [w["cy"]]


def test_a_pending_person_with_a_member_row_can_be_assigned(as_user, db_url):
    w = world(as_user, db_url)
    pending = add_user(db_url, "new@example.com", pending=True)
    query(
        db_url,
        lambda s: (
            s.add(BoardMember(board_id=w["board"], user_id=pending, role="member")),
            s.commit(),
        ),
    )

    response = w["client"].put(curl(w["board"], w["card"], "members", pending))

    assert response.status_code == 200
    assert response.json()["member_ids"] == [pending]


def test_an_owner_row_can_be_assigned_and_so_can_yourself(as_user, db_url):
    w = world(as_user, db_url, "owner")

    for user in (w["boss"], w["ada"]):
        response = w["client"].put(curl(w["board"], w["card"], "members", user))
        assert response.status_code == 200, user

    assert card_member_ids(db_url, w["card"]) == sorted([w["boss"], w["ada"]])


def _not_assignable_targets(db_url, w):
    observer = add_user(db_url, "obs@example.com")
    admin = add_user(db_url, "adm@example.com", "admin")
    admin_observer = add_user(db_url, "admobs@example.com", "admin")
    outsider = add_user(db_url, "out@example.com")
    query(
        db_url,
        lambda s: (
            s.add(BoardMember(board_id=w["board"], user_id=observer, role="observer")),
            s.add(BoardMember(board_id=w["board"], user_id=admin_observer, role="observer")),
            s.commit(),
        ),
    )
    return {
        "observer": observer,
        "admin_without_row": admin,
        "admin_with_observer_row": admin_observer,
        "not_on_board": outsider,
        "unknown": 424242,
    }


@pytest.mark.parametrize(
    "who",
    ["observer", "admin_without_row", "admin_with_observer_row", "not_on_board", "unknown"],
)
def test_someone_who_cannot_work_on_the_board_is_not_assignable(as_user, db_url, who):
    w = world(as_user, db_url)
    target = _not_assignable_targets(db_url, w)[who]
    snapshot = state(db_url, w["card"])
    before = len(events(db_url))

    response = w["client"].put(curl(w["board"], w["card"], "members", target))

    assert response.status_code == 422
    assert response.json() == {"detail": "not_assignable"}
    assert state(db_url, w["card"]) == snapshot
    assert len(events(db_url)) == before


@pytest.mark.parametrize("bad", [0, -1, 2**63])
def test_a_bad_user_id_in_the_path_is_a_validation_error(as_user, db_url, bad):
    w = world(as_user, db_url)

    for method in ("PUT", "DELETE"):
        response = w["client"].request(method, curl(w["board"], w["card"], "members", bad))
        assert response.status_code == 422


def test_unassigning_works_after_the_person_left_the_board(as_user, db_url):
    w = world(as_user, db_url)
    add_card_member(db_url, w["card"], w["cy"])
    query(
        db_url,
        lambda s: (
            s.execute(
                delete(BoardMember).where(
                    BoardMember.board_id == w["board"], BoardMember.user_id == w["cy"]
                )
            ),
            s.commit(),
        ),
    )
    before = len(events(db_url))

    response = w["client"].delete(curl(w["board"], w["card"], "members", w["cy"]))

    assert response.status_code == 200
    assert card_member_ids(db_url, w["card"]) == []
    [recorded] = events(db_url)[before:]
    assert recorded.kind == "card.member_removed"


def test_an_assignee_who_left_the_board_is_not_sent(as_user, db_url):
    w = world(as_user, db_url)
    add_card_member(db_url, w["card"], w["cy"])
    add_card_member(db_url, w["card"], w["boss"])
    query(
        db_url,
        lambda s: (
            s.execute(
                delete(BoardMember).where(
                    BoardMember.board_id == w["board"], BoardMember.user_id == w["cy"]
                )
            ),
            s.commit(),
        ),
    )

    tiles = w["client"].get(f"/api/boards/{w['board']}/cards").json()
    one = w["client"].get(curl(w["board"], w["card"])).json()

    assert tiles[0]["member_ids"] == one["member_ids"] == [w["boss"]]


# ---- labels on a card ------------------------------------------------------------


def test_adding_and_removing_a_label_write_one_event_each(as_user, db_url):
    w = world(as_user, db_url)
    before = len(events(db_url))

    added = w["client"].put(curl(w["board"], w["card"], "labels", 5))
    added_more = w["client"].put(curl(w["board"], w["card"], "labels", 2))
    removed = w["client"].delete(curl(w["board"], w["card"], "labels", 5))

    assert [r.status_code for r in (added, added_more, removed)] == [200, 200, 200]
    assert added.json() == detail(w["card"], "TB-1", w["list"], "A", label_ids=[5])
    assert added_more.json()["label_ids"] == [2, 5]
    assert removed.json() == detail(w["card"], "TB-1", w["list"], "A", label_ids=[2])
    assert [(e.kind, e.data) for e in events(db_url)[before:]] == [
        ("card.label_added", {"key": "TB-1", "label_id": 5, "name": "Marketing"}),
        ("card.label_added", {"key": "TB-1", "label_id": 2, "name": "Bug"}),
        ("card.label_removed", {"key": "TB-1", "label_id": 5, "name": "Marketing"}),
    ]


def test_a_repeated_label_change_is_a_quiet_no_op(as_user, db_url):
    w = world(as_user, db_url)
    add_card_label(db_url, w["card"], 3)
    before = len(events(db_url))

    again = w["client"].put(curl(w["board"], w["card"], "labels", 3))
    absent = w["client"].delete(curl(w["board"], w["card"], "labels", 4))

    assert again.status_code == absent.status_code == 200
    assert again.json()["label_ids"] == absent.json()["label_ids"] == [3]
    assert len(events(db_url)) == before


@pytest.mark.parametrize("method", ["PUT", "DELETE"])
def test_an_unknown_label_is_not_found(as_user, db_url, method):
    w = world(as_user, db_url)
    before = len(events(db_url))

    response = w["client"].request(method, curl(w["board"], w["card"], "labels", 99))

    assert response.status_code == 404
    assert response.json() == {"detail": "label_not_found"}
    assert len(events(db_url)) == before


@pytest.mark.parametrize("bad", [0, -1, 2**63])
def test_a_bad_label_id_in_the_path_is_a_validation_error(as_user, db_url, bad):
    w = world(as_user, db_url)

    for method in ("PUT", "DELETE"):
        response = w["client"].request(method, curl(w["board"], w["card"], "labels", bad))
        assert response.status_code == 422


# ---- the actor's role and the target are checked again inside the transaction -----


def _set_row_role(db_url, board_id, user_id, role):
    def write(s):
        s.execute(
            update(BoardMember)
            .where(BoardMember.board_id == board_id, BoardMember.user_id == user_id)
            .values(role=role)
        )
        s.commit()

    return lambda: query(db_url, write)


@pytest.mark.parametrize("change", ["demoted", "board_archived"])
@pytest.mark.parametrize("action", list(WRITES))
def test_a_role_lost_mid_request_writes_nothing(as_user, db_url, monkeypatch, action, change):
    w = world(as_user, db_url)
    add_card_label(db_url, w["card"], 1)
    add_card_member(db_url, w["card"], w["boss"])
    snapshot = state(db_url, w["card"])
    before = len(events(db_url))
    if change == "demoted":
        interfere(
            monkeypatch, _set_row_role(db_url, w["board"], w["ada"], "observer"), "card_fields"
        )
        status, name = 403, "forbidden"
    else:
        interfere(
            monkeypatch,
            lambda: set_board_columns(db_url, w["board"], archived_at=_now()),
            "card_fields",
        )
        status, name = 404, "board_not_found"

    response = WRITES[action](w["client"], w["board"], w["card"], w)

    assert response.status_code == status, response.text
    assert response.json() == {"detail": name}
    assert len(events(db_url)) == before
    assert state(db_url, w["card"]) == snapshot


@pytest.mark.parametrize("why", ["card_archived", "list_archived"])
@pytest.mark.parametrize("action", list(WRITES))
def test_a_card_hidden_mid_request_is_not_found_and_nothing_is_written(
    as_user, db_url, monkeypatch, action, why
):
    w = world(as_user, db_url)
    add_card_label(db_url, w["card"], 1)
    add_card_member(db_url, w["card"], w["boss"])

    def hide():
        def write(s):
            if why == "card_archived":
                s.execute(update(Card).where(Card.id == w["card"]).values(archived_at=_now()))
            else:
                s.execute(
                    update(BoardList)
                    .where(BoardList.id == w["list"])
                    .values(archived_at=_now(), archived_by=w["ada"])
                )
            s.commit()

        query(db_url, write)

    interfere(monkeypatch, hide, "card_fields")
    before = len(events(db_url))

    response = WRITES[action](w["client"], w["board"], w["card"], w)

    snapshot_after_hide = state(db_url, w["card"])
    assert response.status_code == 404, response.text
    assert response.json() == {"detail": "card_not_found"}
    assert len(events(db_url)) == before
    assert snapshot_after_hide[5] == [w["boss"]] and snapshot_after_hide[6] == [1]
    assert snapshot_after_hide[0] == "A" and snapshot_after_hide[1] is None


def _after_commit(monkeypatch, action):
    """Run `action` (a direct database write) right after the request's transaction ends."""
    from taskboard import card_fields

    real = card_fields.record_change

    def hooked(session, change, **kw):
        try:
            return real(session, change, **kw)
        finally:
            action()

    monkeypatch.setattr(card_fields, "record_change", hooked)


def _archive_card(db_url, card_id):
    def hide():
        def write(s):
            s.execute(update(Card).where(Card.id == card_id).values(archived_at=_now()))
            s.commit()

        query(db_url, write)

    return hide


@pytest.mark.parametrize("action", list(WRITES))
def test_the_answer_comes_from_the_same_transaction_as_the_write(
    as_user, db_url, monkeypatch, action
):
    w = world(as_user, db_url)
    add_card_label(db_url, w["card"], 1)
    add_card_member(db_url, w["card"], w["boss"])
    _after_commit(monkeypatch, _archive_card(db_url, w["card"]))

    response = WRITES[action](w["client"], w["board"], w["card"], w)

    assert response.status_code == 200, response.text
    assert response.json() == expected_detail(action, w)
    assert card_row(db_url, w["card"]).archived_at is not None  # the hide really ran after


@pytest.mark.parametrize(
    "call",
    [
        lambda c, url, w: c.patch(url, json={"title": "A"}),
        lambda c, url, w: c.patch(url, json={"description": None}),
        lambda c, url, w: c.patch(url, json={"due_on": None}),
        lambda c, url, w: c.put(url + f"/labels/{w['label']}"),
        lambda c, url, w: c.delete(url + f"/labels/{w['label'] + 1}"),
        lambda c, url, w: c.put(url + f"/members/{w['boss']}"),
        lambda c, url, w: c.delete(url + f"/members/{w['cy']}"),
    ],
    ids=["title", "description", "due", "label_add", "label_remove", "member_add", "member_remove"],
)
def test_a_no_op_answers_from_inside_its_transaction_too(as_user, db_url, monkeypatch, call):
    w = world(as_user, db_url)
    add_card_label(db_url, w["card"], 1)
    add_card_member(db_url, w["card"], w["boss"])
    _after_commit(monkeypatch, _archive_card(db_url, w["card"]))
    before = len(events(db_url))

    response = call(w["client"], curl(w["board"], w["card"]), {**w, "label": 1})

    assert response.status_code == 200, response.text
    assert response.json() == detail(
        w["card"], "TB-1", w["list"], "A", label_ids=[1], member_ids=[w["boss"]]
    )
    assert len(events(db_url)) == before


def test_a_saved_description_is_answered_even_if_the_card_is_archived_right_after(
    as_user, db_url, monkeypatch
):
    w = world(as_user, db_url)
    _after_commit(monkeypatch, _archive_card(db_url, w["card"]))

    response = w["client"].patch(
        curl(w["board"], w["card"]), json={"description": "Saved **body**"}
    )

    assert response.status_code == 200, response.text
    assert response.json()["description"] == "Saved **body**"
    assert card_row(db_url, w["card"]).description == "Saved **body**"


@pytest.mark.parametrize("change", ["demoted", "removed"])
def test_a_target_demoted_mid_assign_is_refused_and_nothing_is_written(
    as_user, db_url, monkeypatch, change
):
    w = world(as_user, db_url)
    if change == "demoted":
        action = _set_row_role(db_url, w["board"], w["cy"], "observer")
    else:

        def action():
            query(
                db_url,
                lambda s: (
                    s.execute(
                        delete(BoardMember).where(
                            BoardMember.board_id == w["board"], BoardMember.user_id == w["cy"]
                        )
                    ),
                    s.commit(),
                ),
            )

    interfere(monkeypatch, action, "card_fields")
    before = len(events(db_url))

    response = w["client"].put(curl(w["board"], w["card"], "members", w["cy"]))

    assert response.status_code == 422
    assert response.json() == {"detail": "not_assignable"}
    assert card_member_ids(db_url, w["card"]) == []
    assert len(events(db_url)) == before


@pytest.mark.parametrize("action", list(WRITES))
def test_a_failing_event_insert_rolls_the_change_back(as_user, db_url, monkeypatch, action):
    from taskboard import card_fields

    w = world(as_user, db_url)
    add_card_label(db_url, w["card"], 1)
    add_card_member(db_url, w["card"], w["boss"])
    snapshot = state(db_url, w["card"])
    before = len(events(db_url))
    real = card_fields.record_change

    def boom(session, change, **kw):
        return real(session, lambda s: (change(s), 1 / 0)[0], **kw)

    monkeypatch.setattr(card_fields, "record_change", boom)
    with pytest.raises(ZeroDivisionError):
        WRITES[action](w["client"], w["board"], w["card"], w)

    assert state(db_url, w["card"]) == snapshot
    assert len(events(db_url)) == before


# ---- create, move, copy and the stale-move answer return the full tile -----------


def test_create_and_move_return_the_full_tile(as_user, db_url):
    w = world(as_user, db_url)
    c = w["client"]

    created = c.post(f"/api/boards/{w['board']}/cards", json={"list_id": w["list"], "title": "N"})
    other = add_list(db_url, w["board"], "Two", 2.0)
    add_card_label(db_url, w["card"], 4)
    add_card_member(db_url, w["card"], w["boss"])
    moved = c.post(
        curl(w["board"], w["card"], "move"),
        json={"list_id": other, "after_id": None, "from_list_id": w["list"], "from_after_id": None},
    )

    assert created.status_code == 201
    assert created.json() == {
        k: v
        for k, v in detail(created.json()["id"], "TB-2", w["list"], "N").items()
        if k != "description"
    }
    assert moved.status_code == 200
    assert moved.json() == {
        "id": w["card"],
        "key": "TB-1",
        "list_id": other,
        "title": "A",
        "label_ids": [4],
        "member_ids": [w["boss"]],
        "due_on": None,
        "has_description": False,
    }


def test_the_stale_move_answer_carries_the_full_tile(as_user, db_url, monkeypatch):
    w = world(as_user, db_url)
    other = add_list(db_url, w["board"], "Two", 2.0)
    due = datetime(2026, 1, 2)
    query(
        db_url,
        lambda s: (
            s.execute(update(Card).where(Card.id == w["card"]).values(description="d", due_at=due)),
            s.commit(),
        ),
    )
    add_card_label(db_url, w["card"], 6)
    add_card_member(db_url, w["card"], w["cy"])

    def relocate():
        query(
            db_url,
            lambda s: (
                s.execute(
                    update(Card).where(Card.id == w["card"]).values(list_id=other, position=1.0)
                ),
                s.commit(),
            ),
        )

    interfere(monkeypatch, relocate, "cards")

    response = w["client"].post(
        curl(w["board"], w["card"], "move"),
        json={
            "list_id": w["list"],
            "after_id": None,
            "from_list_id": w["list"],
            "from_after_id": 1234,
        },
    )

    assert response.status_code == 409
    assert response.json()["card"] == {
        "id": w["card"],
        "key": "TB-1",
        "list_id": other,
        "title": "A",
        "label_ids": [6],
        "member_ids": [w["cy"]],
        "due_on": "2026-01-02",
        "has_description": True,
    }


# ---- copy ------------------------------------------------------------------------


def test_copy_carries_labels_members_description_and_due_date_in_one_event(as_user, db_url):
    w = world(as_user, db_url)
    gone = add_user(db_url, "gone@example.com")
    watcher = add_user(db_url, "watcher@example.com")
    pending = add_user(db_url, "pending@example.com", pending=True)
    query(
        db_url,
        lambda s: (
            s.add(BoardMember(board_id=w["board"], user_id=watcher, role="observer")),
            s.add(BoardMember(board_id=w["board"], user_id=pending, role="member")),
            s.execute(
                update(Card)
                .where(Card.id == w["card"])
                .values(description="Words", due_at=datetime(2026, 5, 1, 12, 0))
            ),
            s.commit(),
        ),
    )
    for label in (1, 5):
        add_card_label(db_url, w["card"], label)
    for user in (w["boss"], w["cy"], watcher, pending, gone):
        add_card_member(db_url, w["card"], user)  # watcher is only an observer now, gone is off
    before = len(events(db_url))

    response = w["client"].post(curl(w["board"], w["card"], "copy"), json={})

    assert response.status_code == 201, response.text
    body = response.json()
    assert body == {
        "id": body["id"],
        "key": "TB-2",
        "list_id": w["list"],
        "title": "A (copy)",
        "label_ids": [1, 5],
        "member_ids": sorted([w["boss"], w["cy"], pending]),
        "due_on": "2026-05-01",
        "has_description": True,
    }
    assert card_member_ids(db_url, body["id"]) == body["member_ids"]
    assert card_label_ids(db_url, body["id"]) == [1, 5]
    assert card_row(db_url, body["id"]).description == "Words"
    assert card_row(db_url, body["id"]).due_at == datetime(2026, 5, 1, 12, 0)
    [recorded] = events(db_url)[before:]
    assert recorded.kind == "card.copied"
    assert recorded.data == {"key": "TB-2", "from_key": "TB-1"}
    assert card_member_ids(db_url, w["card"]) == sorted(
        [w["boss"], w["cy"], watcher, pending, gone]
    )


def test_a_refused_copy_leaves_no_links_behind(as_user, db_url):
    w = world(as_user, db_url)
    add_card_label(db_url, w["card"], 2)
    add_card_member(db_url, w["card"], w["boss"])
    add_cards(db_url, w["board"], w["list"], 999)  # the board now holds 1,000 cards
    before = len(events(db_url))

    response = w["client"].post(curl(w["board"], w["card"], "copy"), json={})

    assert response.status_code == 422
    assert response.json() == {"detail": "card_limit"}
    assert len(events(db_url)) == before
    count = query(
        db_url, lambda s: s.query(CardMember).filter(CardMember.card_id != w["card"]).count()
    )
    assert count == 0
