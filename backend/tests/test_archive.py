"""Archive and restore: boards, cards, the Archived view, roles, events and limits."""

import re
from datetime import timedelta

import pytest
from sqlalchemy import delete, update
from support import (
    add_board,
    add_card,
    add_cards,
    add_comment,
    add_list,
    add_user,
    events,
    interfere,
    query,
    set_board_columns,
    user_by_email,
)

from taskboard.cards import visible_card_count
from taskboard.models import Board, BoardMember, Card, _now

ROLES = ["owner", "member", "observer", "outsider", "private_outsider", "admin"]


def world(as_user, db_url, who="member"):
    """Ada as `who` on a board with list L and card TB-1 (boss owns it, cy is a member).

    `outsider` is on no row of a Workspace board, `private_outsider` on no row of a Private board,
    `admin` is a workspace admin with no row on a Workspace board.
    """
    client = as_user("ada@example.com", "sub-ada", "admin" if who == "admin" else "member")
    ada = user_by_email(db_url, "ada@example.com").id
    boss = add_user(db_url, "boss@example.com")
    cy = add_user(db_url, "cy@example.com")
    members = {boss: "owner", cy: "member"}
    if who in ("owner", "member", "observer"):
        members[ada] = who
    visibility = "private" if who == "private_outsider" else "workspace"
    board = add_board(db_url, boss, "B", visibility, members)
    lst = add_list(db_url, board, "L", 1.0)
    card = add_card(db_url, board, lst, "A", 1.0)
    return {"client": client, "ada": ada, "boss": boss, "cy": cy, "board": board, "list": lst,
            "card": card}  # fmt: skip


ISO = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z")


def people(w):
    """The members `world` makes, as the API lists them: owners first, then by email."""
    return [
        {
            "id": w["ada"],
            "name": "Ada",
            "email": "ada@example.com",
            "avatar_url": "https://img.example.test/ada.png",
        },
        {"id": w["boss"], "name": "Boss", "email": "boss@example.com", "avatar_url": None},
        {"id": w["cy"], "name": "Cy", "email": "cy@example.com", "avatar_url": None},
    ]


def archive_board_directly(db_url, board_id, at=None):
    set_board_columns(db_url, board_id, archived_at=at or _now())


def archive_card_directly(db_url, card_id, *, by=None, ago=timedelta(minutes=5)):
    def write(s):
        s.execute(
            update(Card).where(Card.id == card_id).values(archived_at=_now() - ago, archived_by=by)
        )
        s.commit()

    query(db_url, write)


def set_row(db_url, board_id, user_id, role):
    """Change a person's board role directly; `None` removes their row."""

    def write(s):
        where = (BoardMember.board_id == board_id, BoardMember.user_id == user_id)
        if role is None:
            s.execute(delete(BoardMember).where(*where))
        else:
            s.execute(update(BoardMember).where(*where).values(role=role))
        s.commit()

    query(db_url, write)


def board_row(db_url, board_id):
    return query(db_url, lambda s: s.get(Board, board_id))


def card_row(db_url, card_id):
    return query(db_url, lambda s: s.get(Card, card_id))


def card_url(w, *rest):
    return "/".join(["/api/boards", str(w["board"]), "cards", str(w["card"]), *rest])


def ours(db_url):
    """The archive and restore events (sign-in writes events of its own)."""
    kinds = ("board.archived", "board.restored", "card.archived", "card.restored")
    return [e for e in events(db_url) if e.kind in kinds]


def board_events(db_url):
    return [e for e in ours(db_url) if e.kind.startswith("board.")]


def card_events(db_url):
    return [e for e in ours(db_url) if e.kind.startswith("card.")]


# ---- not signed in --------------------------------------------------------------

ROUTES = [
    ("POST", "/api/boards/1/archive"),
    ("POST", "/api/boards/1/restore"),
    ("GET", "/api/boards/archived"),
    ("GET", "/api/boards/1/archived"),
    ("POST", "/api/boards/1/cards/1/archive"),
    ("POST", "/api/boards/1/cards/1/restore"),
]


@pytest.mark.parametrize(("method", "path"), ROUTES)
def test_archive_endpoints_need_a_session(client, method, path):
    response = client.request(method, path)

    assert response.status_code == 401
    assert response.json() == {"detail": "not_signed_in"}


# ---- the role matrix ------------------------------------------------------------

BOARD_ARCHIVE = {
    "owner": (200, None),
    "member": (403, "forbidden"),
    "observer": (403, "forbidden"),
    "outsider": (403, "forbidden"),
    "private_outsider": (404, "board_not_found"),
    "admin": (200, None),
}
BOARD_RESTORE = BOARD_ARCHIVE
CARD_ARCHIVE = {**BOARD_ARCHIVE, "member": (200, None)}
CARD_RESTORE = BOARD_ARCHIVE
ARCHIVED_READ = {**{r: (200, None) for r in ROLES}, "private_outsider": (404, "board_not_found")}


def check(response, expected):
    status, detail = expected
    assert response.status_code == status, response.text
    if detail is not None:
        assert response.json() == {"detail": detail}


@pytest.mark.parametrize("who", ROLES)
def test_board_archive_roles(as_user, db_url, who):
    w = world(as_user, db_url, who)

    response = w["client"].post(f"/api/boards/{w['board']}/archive")

    check(response, BOARD_ARCHIVE[who])
    archived = BOARD_ARCHIVE[who][0] == 200
    assert (len(board_events(db_url)) == 1) is archived


@pytest.mark.parametrize("who", ROLES)
def test_board_restore_roles(as_user, db_url, who):
    w = world(as_user, db_url, who)
    archive_board_directly(db_url, w["board"])

    response = w["client"].post(f"/api/boards/{w['board']}/restore")

    check(response, BOARD_RESTORE[who])
    assert (len(board_events(db_url)) == 1) is (BOARD_RESTORE[who][0] == 200)


@pytest.mark.parametrize("who", ROLES)
def test_card_archive_roles(as_user, db_url, who):
    w = world(as_user, db_url, who)

    response = w["client"].post(card_url(w, "archive"))

    check(response, CARD_ARCHIVE[who])
    assert (len(card_events(db_url)) == 1) is (CARD_ARCHIVE[who][0] == 200)


@pytest.mark.parametrize("who", ROLES)
def test_card_restore_roles(as_user, db_url, who):
    w = world(as_user, db_url, who)
    archive_card_directly(db_url, w["card"], by=w["boss"])

    response = w["client"].post(card_url(w, "restore"))

    check(response, CARD_RESTORE[who])
    assert (len(card_events(db_url)) == 1) is (CARD_RESTORE[who][0] == 200)


@pytest.mark.parametrize("who", ROLES)
def test_archived_view_roles(as_user, db_url, who):
    w = world(as_user, db_url, who)

    response = w["client"].get(f"/api/boards/{w['board']}/archived")

    check(response, ARCHIVED_READ[who])


@pytest.mark.parametrize(
    ("who", "sees"),
    [
        ("owner", True),
        ("member", False),
        ("observer", False),
        ("outsider", False),
        ("private_outsider", False),
        ("admin", True),
    ],
)
def test_archived_boards_list_has_only_boards_the_caller_can_restore(as_user, db_url, who, sees):
    w = world(as_user, db_url, who)
    archive_board_directly(db_url, w["board"])

    response = w["client"].get("/api/boards/archived")

    assert response.status_code == 200
    assert [t["id"] for t in response.json()] == ([w["board"]] if sees else [])


def test_an_admin_cannot_restore_or_see_a_private_board_they_are_not_on(as_user, db_url):
    client = as_user("ada@example.com", "sub-ada", "admin")
    boss = add_user(db_url, "boss@example.com")
    board = add_board(db_url, boss, "P", "private", {boss: "owner"})
    archive_board_directly(db_url, board)

    assert client.get("/api/boards/archived").json() == []
    response = client.post(f"/api/boards/{board}/restore")
    assert (response.status_code, response.json()) == (404, {"detail": "board_not_found"})
    response = client.post(f"/api/boards/{board}/archive")
    assert (response.status_code, response.json()) == (404, {"detail": "board_not_found"})


def test_an_admin_on_a_private_board_row_restores_it_as_owner(as_user, db_url):
    client = as_user("ada@example.com", "sub-ada", "admin")
    ada = user_by_email(db_url, "ada@example.com").id
    boss = add_user(db_url, "boss@example.com")
    board = add_board(db_url, boss, "P", "private", {boss: "owner", ada: "member"})
    archive_board_directly(db_url, board)

    assert [t["id"] for t in client.get("/api/boards/archived").json()] == [board]
    assert client.post(f"/api/boards/{board}/restore").status_code == 200


# ---- card archive ---------------------------------------------------------------


def test_archiving_a_card_hides_it_and_writes_one_event_with_archived_by(as_user, db_url):
    w = world(as_user, db_url, "member")
    client = w["client"]

    response = client.post(card_url(w, "archive"))

    assert response.status_code == 200
    assert response.json() == {
        "id": w["card"],
        "key": "TB-1",
        "list_id": w["list"],
        "title": "A",
        "label_ids": [],
        "member_ids": [],
        "due_on": None,
        "has_description": False,
        "checklist_done": 0,
        "checklist_total": 0,
        "comment_count": 0,
    }
    assert client.get(f"/api/boards/{w['board']}/cards").json() == []
    assert client.get(card_url(w)).status_code == 404
    feed = client.get(card_url(w, "feed"))
    assert (feed.status_code, feed.json()) == (404, {"detail": "card_not_found"})
    assert query(db_url, lambda s: visible_card_count(s, w["board"])) == 0
    row = card_row(db_url, w["card"])
    assert row.archived_at is not None and row.archived_by == w["ada"]
    [event] = ours(db_url)
    assert (event.actor_id, event.board_id, event.subject_type, event.subject_id) == (
        w["ada"],
        w["board"],
        "card",
        str(w["card"]),
    )
    assert (event.kind, event.data) == ("card.archived", {"key": "TB-1", "list_id": w["list"]})


def test_archiving_a_card_twice_or_a_card_in_an_archived_list_is_a_404(as_user, db_url):
    w = world(as_user, db_url, "owner")
    other = add_list(db_url, w["board"], "Gone", 2.0)
    hidden = add_card(db_url, w["board"], other, "H", 1.0)
    set_archived_list(db_url, other)

    assert w["client"].post(card_url(w, "archive")).status_code == 200
    again = w["client"].post(card_url(w, "archive"))
    assert (again.status_code, again.json()) == (404, {"detail": "card_not_found"})
    url = f"/api/boards/{w['board']}/cards/{hidden}/archive"
    assert w["client"].post(url).status_code == 404
    assert len(card_events(db_url)) == 1


def test_a_card_of_another_board_cannot_be_archived_here(as_user, db_url):
    w = world(as_user, db_url, "owner")
    board2 = add_board(
        db_url, w["boss"], "B2", "workspace", {w["boss"]: "owner", w["ada"]: "owner"}
    )
    list2 = add_list(db_url, board2, "L2", 1.0)
    foreign = add_card(db_url, board2, list2, "F", 1.0)

    response = w["client"].post(f"/api/boards/{w['board']}/cards/{foreign}/archive")

    assert (response.status_code, response.json()) == (404, {"detail": "card_not_found"})
    assert ours(db_url) == []


def test_a_member_demoted_before_the_write_is_refused(as_user, db_url, monkeypatch):
    w = world(as_user, db_url, "member")

    def demote():
        def write(s):
            s.execute(
                update(BoardMember)
                .where(BoardMember.board_id == w["board"], BoardMember.user_id == w["ada"])
                .values(role="observer")
            )
            s.commit()

        query(db_url, write)

    interfere(monkeypatch, demote, "cards")

    response = w["client"].post(card_url(w, "archive"))

    assert (response.status_code, response.json()) == (403, {"detail": "forbidden"})
    assert card_row(db_url, w["card"]).archived_at is None
    assert ours(db_url) == []


def set_archived_list(db_url, list_id, by=None):
    from taskboard.models import BoardList

    def write(s):
        s.execute(
            update(BoardList)
            .where(BoardList.id == list_id)
            .values(archived_at=_now(), archived_by=by)
        )
        s.commit()

    query(db_url, write)


# ---- card restore ---------------------------------------------------------------


def test_an_owner_restores_any_card_and_it_keeps_its_place(as_user, db_url):
    w = world(as_user, db_url, "owner")
    first = add_card(db_url, w["board"], w["list"], "First", 0.5)
    archive_card_directly(db_url, w["card"], by=w["cy"], ago=timedelta(days=3))

    response = w["client"].post(card_url(w, "restore"))

    assert response.status_code == 200
    assert (response.json()["id"], response.json()["list_id"]) == (w["card"], w["list"])
    assert [t["id"] for t in w["client"].get(f"/api/boards/{w['board']}/cards").json()] == [
        first,
        w["card"],
    ]
    row = card_row(db_url, w["card"])
    assert (row.archived_at, row.archived_by, row.position) == (None, None, 1.0)
    [event] = ours(db_url)
    assert (event.kind, event.actor_id, event.subject_id) == (
        "card.restored",
        w["ada"],
        str(w["card"]),
    )
    assert event.data == {"key": "TB-1", "list_id": w["list"], "from_list_id": w["list"]}


def test_the_archiver_restores_within_a_minute_and_not_after(as_user, db_url):
    w = world(as_user, db_url, "member")
    archive_card_directly(db_url, w["card"], by=w["ada"], ago=timedelta(seconds=10))

    assert w["client"].post(card_url(w, "restore")).status_code == 200

    archive_card_directly(db_url, w["card"], by=w["ada"], ago=timedelta(seconds=90))
    late = w["client"].post(card_url(w, "restore"))
    assert (late.status_code, late.json()) == (403, {"detail": "forbidden"})
    assert card_row(db_url, w["card"]).archived_at is not None
    assert len(card_events(db_url)) == 1


def test_a_member_who_did_not_archive_it_is_refused_even_within_a_minute(as_user, db_url):
    w = world(as_user, db_url, "member")
    archive_card_directly(db_url, w["card"], by=w["cy"], ago=timedelta(seconds=5))

    response = w["client"].post(card_url(w, "restore"))

    assert (response.status_code, response.json()) == (403, {"detail": "forbidden"})
    assert ours(db_url) == []


def test_restoring_a_card_that_is_not_archived_is_a_404(as_user, db_url):
    w = world(as_user, db_url, "owner")

    response = w["client"].post(card_url(w, "restore"))

    assert (response.status_code, response.json()) == (404, {"detail": "card_not_found"})
    assert ours(db_url) == []


def test_a_card_restored_by_someone_else_first_is_a_404_and_writes_nothing(
    as_user, db_url, monkeypatch
):
    w = world(as_user, db_url, "owner")
    archive_card_directly(db_url, w["card"], by=w["cy"])

    def restore_first():
        def write(s):
            s.execute(update(Card).where(Card.id == w["card"]).values(archived_at=None))
            s.commit()

        query(db_url, write)

    interfere(monkeypatch, restore_first, "cards")

    response = w["client"].post(card_url(w, "restore"))

    assert (response.status_code, response.json()) == (404, {"detail": "card_not_found"})
    assert ours(db_url) == []


def test_an_owner_demoted_before_the_card_restore_is_refused(as_user, db_url, monkeypatch):
    w = world(as_user, db_url, "owner")
    archive_card_directly(db_url, w["card"], by=w["cy"], ago=timedelta(days=3))
    interfere(monkeypatch, lambda: set_row(db_url, w["board"], w["ada"], "member"), "cards")

    response = w["client"].post(card_url(w, "restore"))

    assert (response.status_code, response.json()) == (403, {"detail": "forbidden"})
    assert card_row(db_url, w["card"]).archived_at is not None
    assert ours(db_url) == []


@pytest.mark.parametrize("now", ["observer", None])
def test_the_archiver_who_lost_access_before_the_card_restore_is_refused(
    as_user, db_url, monkeypatch, now
):
    w = world(as_user, db_url, "member")
    archive_card_directly(db_url, w["card"], by=w["ada"], ago=timedelta(seconds=10))
    interfere(monkeypatch, lambda: set_row(db_url, w["board"], w["ada"], now), "cards")

    response = w["client"].post(card_url(w, "restore"))

    assert (response.status_code, response.json()) == (403, {"detail": "forbidden"})
    assert card_row(db_url, w["card"]).archived_at is not None
    assert ours(db_url) == []


def test_the_archiver_removed_from_a_private_board_before_the_card_restore_is_a_404(
    as_user, db_url, monkeypatch
):
    w = world(as_user, db_url, "member")
    set_board_columns(db_url, w["board"], visibility="private")
    archive_card_directly(db_url, w["card"], by=w["ada"], ago=timedelta(seconds=10))
    interfere(monkeypatch, lambda: set_row(db_url, w["board"], w["ada"], None), "cards")

    response = w["client"].post(card_url(w, "restore"))

    assert (response.status_code, response.json()) == (404, {"detail": "board_not_found"})
    assert card_row(db_url, w["card"]).archived_at is not None
    assert ours(db_url) == []


def test_a_card_whose_list_is_archived_goes_to_the_end_of_the_first_active_list(as_user, db_url):
    w = world(as_user, db_url, "owner")
    gone = add_list(db_url, w["board"], "Gone", 0.5)
    stuck = add_card(db_url, w["board"], gone, "Stuck", 1.0)
    set_archived_list(db_url, gone)
    archive_card_directly(db_url, stuck, by=w["cy"])
    last = add_card(db_url, w["board"], w["list"], "Last", 7.0)

    response = w["client"].post(f"/api/boards/{w['board']}/cards/{stuck}/restore")

    assert response.status_code == 200
    assert response.json()["list_id"] == w["list"]
    ids = [t["id"] for t in w["client"].get(f"/api/boards/{w['board']}/cards").json()]
    assert ids == [w["card"], last, stuck]
    row = card_row(db_url, stuck)
    assert (row.list_id, row.position, row.archived_at) == (w["list"], 8.0, None)
    [event] = ours(db_url)
    assert event.data == {"key": "TB-2", "list_id": w["list"], "from_list_id": gone}


def test_no_active_list_is_a_409_no_list(as_user, db_url):
    w = world(as_user, db_url, "owner")
    archive_card_directly(db_url, w["card"], by=w["cy"])
    set_archived_list(db_url, w["list"])

    response = w["client"].post(card_url(w, "restore"))

    assert (response.status_code, response.json()) == (409, {"detail": "no_list"})
    assert card_row(db_url, w["card"]).archived_at is not None
    assert ours(db_url) == []


def test_a_full_board_refuses_the_restore_with_card_limit(as_user, db_url):
    w = world(as_user, db_url, "owner")
    archive_card_directly(db_url, w["card"], by=w["cy"])
    add_cards(db_url, w["board"], w["list"], 1000)

    response = w["client"].post(card_url(w, "restore"))

    assert (response.status_code, response.json()) == (422, {"detail": "card_limit"})
    assert card_row(db_url, w["card"]).archived_at is not None
    assert ours(db_url) == []


# ---- board archive and restore --------------------------------------------------


def test_an_archived_board_leaves_the_list_and_every_route_but_restore(as_user, db_url):
    w = world(as_user, db_url, "owner")
    client, board = w["client"], w["board"]
    assert [t["id"] for t in client.get("/api/boards").json()] == [board]

    response = client.post(f"/api/boards/{board}/archive")

    assert response.status_code == 200
    assert response.json() == {"id": board, "name": "B"}
    assert client.get("/api/boards").json() == []
    for path in ("", "/lists", "/cards", "/members", "/archived", f"/cards/{w['card']}"):
        got = client.get(f"/api/boards/{board}{path}")
        assert (got.status_code, got.json()) == (404, {"detail": "board_not_found"}), path
    again = client.post(f"/api/boards/{board}/archive")
    assert (again.status_code, again.json()) == (404, {"detail": "board_not_found"})
    [event] = ours(db_url)
    assert (event.kind, event.actor_id, event.board_id, event.subject_type) == (
        "board.archived",
        w["ada"],
        board,
        "board",
    )
    assert (event.subject_id, event.data) == (str(board), {"name": "B"})


def test_the_archived_boards_route_is_not_shadowed_by_the_board_id_route(as_user, db_url):
    w = world(as_user, db_url, "owner")
    archive_board_directly(db_url, w["board"])

    response = w["client"].get("/api/boards/archived")

    assert response.status_code == 200
    [tile] = response.json()
    stamps = {key: tile.pop(key) for key in ("updated_at", "archived_at")}
    assert all(ISO.fullmatch(value) for value in stamps.values())
    assert tile == {
        "id": w["board"],
        "name": "B",
        "visibility": "workspace",
        "my_role": "owner",
        "member_count": 3,
        "members": people(w),
    }


def test_archived_boards_are_newest_first(as_user, db_url):
    w = world(as_user, db_url, "owner")
    members = {w["boss"]: "owner", w["ada"]: "owner"}
    older = add_board(db_url, w["boss"], "Older", "workspace", members)
    archive_board_directly(db_url, older, _now() - timedelta(days=2))
    archive_board_directly(db_url, w["board"], _now() - timedelta(days=1))

    response = w["client"].get("/api/boards/archived")

    assert [t["id"] for t in response.json()] == [w["board"], older]


def test_restoring_a_board_brings_back_its_lists_and_cards(as_user, db_url):
    w = world(as_user, db_url, "owner")
    client, board = w["client"], w["board"]
    client.post(f"/api/boards/{board}/archive")

    response = client.post(f"/api/boards/{board}/restore")

    assert response.status_code == 200
    body = response.json()
    stamps = {key: body.pop(key) for key in ("updated_at", "created_at")}
    assert all(ISO.fullmatch(value) for value in stamps.values())
    assert body == {
        "id": board,
        "name": "B",
        "visibility": "workspace",
        "my_role": "owner",
        "member_count": 3,
        "members": people(w),
    }
    assert [t["id"] for t in client.get("/api/boards").json()] == [board]
    assert [row["id"] for row in client.get(f"/api/boards/{board}/lists").json()] == [w["list"]]
    assert [t["id"] for t in client.get(f"/api/boards/{board}/cards").json()] == [w["card"]]
    assert client.get("/api/boards/archived").json() == []
    kinds = [e.kind for e in board_events(db_url)]
    assert kinds == ["board.archived", "board.restored"]
    assert board_events(db_url)[1].data == {"name": "B"}


def test_restoring_a_board_that_is_not_archived_or_missing_is_a_404(as_user, db_url):
    w = world(as_user, db_url, "owner")

    for board in (w["board"], 9999):
        response = w["client"].post(f"/api/boards/{board}/restore")
        assert (response.status_code, response.json()) == (404, {"detail": "board_not_found"})
    assert ours(db_url) == []


def test_a_board_restored_by_someone_else_first_writes_no_event(as_user, db_url, monkeypatch):
    w = world(as_user, db_url, "owner")
    archive_board_directly(db_url, w["board"])
    interfere(monkeypatch, lambda: set_board_columns(db_url, w["board"], archived_at=None))

    response = w["client"].post(f"/api/boards/{w['board']}/restore")

    assert (response.status_code, response.json()) == (404, {"detail": "board_not_found"})
    assert ours(db_url) == []


def test_an_owner_demoted_before_the_archive_is_refused(as_user, db_url, monkeypatch):
    w = world(as_user, db_url, "owner")

    def demote():
        def write(s):
            s.execute(
                update(BoardMember)
                .where(BoardMember.board_id == w["board"], BoardMember.user_id == w["ada"])
                .values(role="member")
            )
            s.commit()

        query(db_url, write)

    interfere(monkeypatch, demote)

    response = w["client"].post(f"/api/boards/{w['board']}/archive")

    assert (response.status_code, response.json()) == (403, {"detail": "forbidden"})
    assert ours(db_url) == []


def test_an_owner_demoted_before_the_board_restore_is_refused(as_user, db_url, monkeypatch):
    w = world(as_user, db_url, "owner")
    archive_board_directly(db_url, w["board"])
    interfere(monkeypatch, lambda: set_row(db_url, w["board"], w["ada"], "member"))

    response = w["client"].post(f"/api/boards/{w['board']}/restore")

    assert (response.status_code, response.json()) == (403, {"detail": "forbidden"})
    assert board_row(db_url, w["board"]).archived_at is not None
    assert ours(db_url) == []


def test_an_admin_removed_from_a_private_board_before_the_archive_is_refused(
    as_user, db_url, monkeypatch
):
    client = as_user("ada@example.com", "sub-ada", "admin")
    ada = user_by_email(db_url, "ada@example.com").id
    boss = add_user(db_url, "boss@example.com")
    board = add_board(db_url, boss, "P", "private", {boss: "owner", ada: "member"})
    interfere(monkeypatch, lambda: set_row(db_url, board, ada, None))

    response = client.post(f"/api/boards/{board}/archive")

    assert (response.status_code, response.json()) == (404, {"detail": "board_not_found"})
    assert board_row(db_url, board).archived_at is None
    assert ours(db_url) == []


def test_an_admin_loses_sight_of_a_board_made_private_before_the_archive(
    as_user, db_url, monkeypatch
):
    w = world(as_user, db_url, "admin")

    def hide():
        set_board_columns(db_url, w["board"], visibility="private")

    interfere(monkeypatch, hide)

    response = w["client"].post(f"/api/boards/{w['board']}/archive")

    assert (response.status_code, response.json()) == (404, {"detail": "board_not_found"})
    assert board_row(db_url, w["board"]).archived_at is None
    assert ours(db_url) == []


# ---- the Archived view ----------------------------------------------------------


def test_the_archived_view_lists_rows_newest_first_and_counts_only_active_cards(as_user, db_url):
    w = world(as_user, db_url, "observer")
    old = add_list(db_url, w["board"], "Old", 2.0)
    new = add_list(db_url, w["board"], "New", 3.0)
    for title, pos in (("a", 1.0), ("b", 2.0)):
        add_card(db_url, w["board"], new, title, pos)
    hidden = add_card(db_url, w["board"], new, "own", 3.0)
    archive_card_directly(db_url, hidden, by=w["cy"], ago=timedelta(days=9))
    set_archived_list(db_url, old)
    set_archived_list(db_url, new)

    def stamp(s):
        from taskboard.models import BoardList

        s.execute(
            update(BoardList)
            .where(BoardList.id == old)
            .values(archived_at=_now() - timedelta(days=2))
        )
        s.execute(
            update(BoardList)
            .where(BoardList.id == new)
            .values(archived_at=_now() - timedelta(days=1))
        )
        s.commit()

    query(db_url, stamp)
    solo = add_card(db_url, w["board"], w["list"], "Solo", 2.0)
    archive_card_directly(db_url, solo, by=w["cy"], ago=timedelta(days=1))
    add_card(db_url, w["board"], w["list"], "Live", 3.0)

    response = w["client"].get(f"/api/boards/{w['board']}/archived")

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"lists", "cards"}
    assert [(row["id"], row["name"], row["card_count"]) for row in body["lists"]] == [
        (new, "New", 2),
        (old, "Old", 0),
    ]
    assert all(row["archived_at"].endswith("Z") for row in body["lists"])
    assert [
        (r["id"], r["key"], r["title"], r["list_id"], r["list_name"]) for r in body["cards"]
    ] == [
        (solo, "TB-5", "Solo", w["list"], "L"),
        (hidden, "TB-4", "own", new, "New"),
    ]
    assert all(row["archived_at"].endswith("Z") for row in body["cards"])


def test_an_empty_archived_view(as_user, db_url):
    w = world(as_user, db_url, "observer")

    response = w["client"].get(f"/api/boards/{w['board']}/archived")

    assert response.json() == {"lists": [], "cards": []}


# ---- the feed -------------------------------------------------------------------


def test_the_feed_shows_archive_and_restore_with_only_the_allowed_keys(as_user, db_url):
    w = world(as_user, db_url, "owner")
    client = w["client"]
    assert client.post(card_url(w, "archive")).status_code == 200
    assert client.post(card_url(w, "restore")).status_code == 200
    add_comment(db_url, w["card"], w["ada"], "hello")

    entries = client.get(card_url(w, "feed")).json()["entries"]

    kinds = [(e["kind"], e["data"]) for e in entries if e["type"] == "event"]
    assert kinds == [
        ("card.restored", {"key": "TB-1", "list_id": w["list"]}),
        ("card.archived", {"key": "TB-1", "list_id": w["list"]}),
    ]
