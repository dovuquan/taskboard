"""Boards API: visibility, board roles, the last-owner guard, events and ownerless boards."""

import threading

import pytest
from sqlalchemy import select, update
from support import events, query, user_by_email

from taskboard.models import Board, BoardMember, User, WorkspaceMember

TILE_KEYS = {"id", "name", "visibility", "my_role", "member_count", "members", "updated_at"}
PERSON_KEYS = {"id", "name", "email", "avatar_url"}


def add_user(db_url, email, role="member", *, pending=False, workspace=True):
    """A user (and normally their workspace row) written directly; returns the user id."""

    def add(s):
        user = User(
            email=email,
            google_sub=None if pending else f"sub-{email}",
            name=None if pending else email.split("@")[0].title(),
        )
        s.add(user)
        s.flush()
        if workspace:
            s.add(WorkspaceMember(user_id=user.id, role=role))
        s.commit()
        return user.id

    return query(db_url, add)


def add_board(db_url, creator_id, name="Roadmap", visibility="workspace", members=None):
    """A board and its member rows written directly (no events); returns the board id."""

    def add(s):
        board = Board(name=name, visibility=visibility, created_by=creator_id)
        s.add(board)
        s.flush()
        for uid, role in (members or {}).items():
            s.add(BoardMember(board_id=board.id, user_id=uid, role=role))
        s.commit()
        return board.id

    return query(db_url, add)


def board_role(db_url, board_id, uid):
    return query(db_url, lambda s: s.scalar(_role_stmt(board_id, uid)))


def _role_stmt(board_id, uid):
    return select(BoardMember.role).where(
        BoardMember.board_id == board_id, BoardMember.user_id == uid
    )


def owners(db_url, board_id):
    stmt = select(BoardMember.user_id).where(
        BoardMember.board_id == board_id, BoardMember.role == "owner"
    )
    return query(db_url, lambda s: list(s.scalars(stmt)))


def board_row(db_url, board_id):
    return query(db_url, lambda s: s.get(Board, board_id))


def iso(dt):
    return dt.isoformat() + "Z"


def set_board_role(db_url, board_id, uid, role):
    def write(s):
        s.execute(
            update(BoardMember)
            .where(BoardMember.board_id == board_id, BoardMember.user_id == uid)
            .values(role=role)
        )
        s.commit()

    query(db_url, write)


def set_workspace_role(db_url, uid, role):
    def write(s):
        s.execute(update(WorkspaceMember).where(WorkspaceMember.user_id == uid).values(role=role))
        s.commit()

    query(db_url, write)


def set_board_columns(db_url, board_id, **values):
    def write(s):
        s.execute(update(Board).where(Board.id == board_id).values(**values))
        s.commit()

    query(db_url, write)


def interfere(monkeypatch, action):
    """Run `action` (a direct database write) just before the request's transaction starts."""
    from taskboard import boards

    real = boards.record_change

    def hooked(session, change, **kw):
        action()
        return real(session, change, **kw)

    monkeypatch.setattr(boards, "record_change", hooked)


# ---- not signed in, no workspace row --------------------------------------------

ROUTES = [
    ("GET", "/api/boards", None),
    ("GET", "/api/boards/ownerless", None),
    ("POST", "/api/boards", {"name": "X"}),
    ("GET", "/api/boards/1", None),
    ("PATCH", "/api/boards/1", {"name": "X"}),
    ("GET", "/api/boards/1/members", None),
    ("POST", "/api/boards/1/members", {"user_id": 2}),
    ("PATCH", "/api/boards/1/members/2", {"role": "member"}),
    ("DELETE", "/api/boards/1/members/2", None),
    ("POST", "/api/boards/1/take-ownership", None),
]


@pytest.mark.parametrize(("method", "path", "body"), ROUTES)
def test_board_endpoints_need_a_session(client, method, path, body):
    response = client.request(method, path, json=body)

    assert response.status_code == 401
    assert response.json() == {"detail": "not_signed_in"}


@pytest.mark.parametrize(("method", "path", "body"), ROUTES[:3])
def test_a_user_without_a_workspace_row_is_forbidden(as_user, db_url, method, path, body):
    ghost = as_user("ghost@example.com", "sub-ghost", "admin")
    ghost_id = user_by_email(db_url, "ghost@example.com").id

    def drop(s):
        s.delete(s.get(WorkspaceMember, ghost_id))
        s.commit()

    query(db_url, drop)

    response = ghost.request(method, path, json=body)

    assert response.status_code == 403
    assert response.json() == {"detail": "forbidden"}


# ---- list and detail ------------------------------------------------------------


def test_the_list_shows_workspace_boards_and_my_private_boards_with_tile_fields(as_user, db_url):
    ada = as_user("ada@example.com", "sub-ada")
    ada_id = user_by_email(db_url, "ada@example.com").id
    other = add_user(db_url, "other@example.com")
    people = [add_user(db_url, f"p{i}@example.com") for i in range(5)]
    mine = add_board(
        db_url, other, "Mine", "private", {ada_id: "member", **{p: "observer" for p in people[:4]}}
    )
    open_board = add_board(db_url, other, "Open", "workspace", {other: "owner"})
    add_board(db_url, other, "Hidden", "private", {other: "owner"})

    response = ada.get("/api/boards")

    assert response.status_code == 200
    by_name = {b["name"]: b for b in response.json()}
    assert set(by_name) == {"Mine", "Open"}
    assert all(set(b) == TILE_KEYS for b in by_name.values())
    mine_tile, open_tile = by_name["Mine"], by_name["Open"]
    assert (mine_tile["id"], mine_tile["visibility"], mine_tile["my_role"]) == (
        mine,
        "private",
        "member",
    )
    assert mine_tile["member_count"] == 5
    assert len(mine_tile["members"]) == 4
    assert all(set(m) == PERSON_KEYS for m in mine_tile["members"])
    assert (open_tile["id"], open_tile["my_role"], open_tile["member_count"]) == (
        open_board,
        "observer",
        1,
    )
    assert open_tile["updated_at"] == iso(board_row(db_url, open_board).created_at)
    assert open_tile["updated_at"].endswith("Z")


def test_an_admin_sees_workspace_boards_as_owner_but_no_foreign_private_board(as_user, db_url):
    admin = as_user("root@example.com", "sub-root", "admin")
    other = add_user(db_url, "other@example.com")
    add_board(db_url, other, "Open", "workspace", {other: "owner"})
    add_board(db_url, other, "Hidden", "private", {other: "owner"})

    body = admin.get("/api/boards").json()

    assert [(b["name"], b["my_role"]) for b in body] == [("Open", "owner")]


def test_detail_returns_the_tile_with_my_role_and_created_at(as_user, db_url):
    ada = as_user("ada@example.com", "sub-ada")
    other = add_user(db_url, "other@example.com")
    board_id = add_board(db_url, other, "Open", "workspace", {other: "owner"})

    response = ada.get(f"/api/boards/{board_id}")

    assert response.status_code == 200
    body = response.json()
    assert set(body) == TILE_KEYS | {"created_at"}
    assert (body["id"], body["name"], body["my_role"]) == (board_id, "Open", "observer")
    assert body["created_at"] == iso(board_row(db_url, board_id).created_at)


def test_my_role_is_the_row_role_observer_for_outsiders_and_owner_for_admins(as_user, db_url):
    ada = as_user("ada@example.com", "sub-ada")
    admin = as_user("root@example.com", "sub-root", "admin")
    ada_id = user_by_email(db_url, "ada@example.com").id
    other = add_user(db_url, "other@example.com")
    board_id = add_board(db_url, other, "Open", "workspace", {other: "owner", ada_id: "member"})
    outsider = as_user("out@example.com", "sub-out")

    assert ada.get(f"/api/boards/{board_id}").json()["my_role"] == "member"
    assert outsider.get(f"/api/boards/{board_id}").json()["my_role"] == "observer"
    assert admin.get(f"/api/boards/{board_id}").json()["my_role"] == "owner"


def test_a_private_board_is_not_found_for_an_outsider_and_for_an_admin_not_on_it(as_user, db_url):
    outsider = as_user("out@example.com", "sub-out")
    admin = as_user("root@example.com", "sub-root", "admin")
    other = add_user(db_url, "other@example.com")
    board_id = add_board(db_url, other, "Hidden", "private", {other: "owner"})

    for client in (outsider, admin):
        for method, path, body in [
            ("GET", f"/api/boards/{board_id}", None),
            ("PATCH", f"/api/boards/{board_id}", {"name": "X"}),
            ("GET", f"/api/boards/{board_id}/members", None),
            ("POST", f"/api/boards/{board_id}/members", {"user_id": other}),
            ("PATCH", f"/api/boards/{board_id}/members/{other}", {"role": "member"}),
            ("DELETE", f"/api/boards/{board_id}/members/{other}", None),
        ]:
            response = client.request(method, path, json=body)
            assert response.status_code == 404, (method, path)
            assert response.json() == {"detail": "board_not_found"}


def test_an_unknown_board_is_not_found(as_user):
    ada = as_user("ada@example.com", "sub-ada")

    response = ada.get("/api/boards/99999")

    assert response.status_code == 404
    assert response.json() == {"detail": "board_not_found"}


@pytest.mark.parametrize("bad_id", [0, 2**70])
def test_an_out_of_range_board_id_is_a_validation_error(as_user, bad_id):
    ada = as_user("ada@example.com", "sub-ada")

    response = ada.get(f"/api/boards/{bad_id}")

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["path", "board_id"]


def test_an_archived_board_is_not_found(as_user, db_url):
    ada = as_user("ada@example.com", "sub-ada")
    other = add_user(db_url, "other@example.com")
    board_id = add_board(db_url, other, "Old", "workspace", {other: "owner"})

    def archive(s):
        from datetime import datetime

        s.get(Board, board_id).archived_at = datetime(2026, 1, 1)
        s.commit()

    query(db_url, archive)

    assert ada.get(f"/api/boards/{board_id}").status_code == 404
    assert ada.get("/api/boards").json() == []


def test_members_list_orders_owners_first_then_by_email_and_marks_pending(as_user, db_url):
    ada = as_user("ada@example.com", "sub-ada")
    ada_id = user_by_email(db_url, "ada@example.com").id
    zed = add_user(db_url, "zed@example.com")
    bob = add_user(db_url, "bob@example.com", pending=True)
    amy = add_user(db_url, "amy@example.com")
    board_id = add_board(
        db_url,
        zed,
        "Open",
        "workspace",
        {zed: "owner", ada_id: "observer", bob: "member", amy: "member"},
    )

    response = ada.get(f"/api/boards/{board_id}/members")

    assert response.status_code == 200
    body = response.json()
    assert [m["email"] for m in body] == [
        "zed@example.com",
        "amy@example.com",
        "bob@example.com",
        "ada@example.com",
    ]
    assert [m["role"] for m in body] == ["owner", "member", "member", "observer"]
    assert set(body[0]) == PERSON_KEYS | {"role", "added_at", "pending"}
    assert body[0]["id"] == zed and body[0]["added_at"].endswith("Z")
    assert [m["pending"] for m in body] == [False, False, True, False]


# ---- create ---------------------------------------------------------------------


def test_create_makes_the_creator_owner_and_writes_one_event(as_user, db_url):
    ada = as_user("ada@example.com", "sub-ada")
    ada_id = user_by_email(db_url, "ada@example.com").id
    before = len(events(db_url))

    response = ada.post("/api/boards", json={"name": "  Launch  ", "visibility": "private"})

    assert response.status_code == 201
    body = response.json()
    assert set(body) == TILE_KEYS | {"created_at"}
    assert (body["name"], body["visibility"], body["my_role"]) == ("Launch", "private", "owner")
    assert body["member_count"] == 1
    board_id = body["id"]
    assert board_role(db_url, board_id, ada_id) == "owner"
    assert board_row(db_url, board_id).created_by == ada_id
    [event] = events(db_url)[before:]
    assert (event.actor_id, event.kind) == (ada_id, "board.created")
    assert (event.subject_type, event.subject_id, event.board_id) == (
        "board",
        str(board_id),
        board_id,
    )
    assert event.data == {"name": "Launch", "visibility": "private"}
    assert body["updated_at"] == iso(event.at)


def test_a_new_board_defaults_to_workspace_visibility(as_user):
    ada = as_user("ada@example.com", "sub-ada")

    response = ada.post("/api/boards", json={"name": "Launch"})

    assert response.status_code == 201
    assert response.json()["visibility"] == "workspace"


def test_a_failing_create_leaves_no_board_and_no_event(as_user, db_url, monkeypatch):
    from taskboard import boards

    ada = as_user("ada@example.com", "sub-ada")
    real = boards.record_change
    before = len(events(db_url))

    def boom(session, change, **kw):
        return real(session, lambda s: (change(s), 1 / 0)[0], **kw)

    monkeypatch.setattr(boards, "record_change", boom)
    with pytest.raises(ZeroDivisionError):
        ada.post("/api/boards", json={"name": "Launch"})

    assert query(db_url, lambda s: s.scalars(select(Board)).all()) == []
    assert query(db_url, lambda s: s.scalars(select(BoardMember)).all()) == []
    assert len(events(db_url)) == before


@pytest.mark.parametrize(
    "body",
    [
        {"name": "x" * 81},
        {"name": ""},
        {"name": "   "},
        {},
        {"name": "ok", "visibility": "secret"},
    ],
)
def test_create_validates_the_body(as_user, db_url, body):
    ada = as_user("ada@example.com", "sub-ada")
    before = len(events(db_url))

    response = ada.post("/api/boards", json=body)

    assert response.status_code == 422
    assert query(db_url, lambda s: s.scalars(select(Board)).all()) == []
    assert len(events(db_url)) == before


def test_an_80_character_name_is_accepted(as_user):
    ada = as_user("ada@example.com", "sub-ada")

    assert ada.post("/api/boards", json={"name": "x" * 80}).status_code == 201


# ---- rename and visibility ------------------------------------------------------


def test_rename_trims_and_writes_one_event_that_moves_updated_at(as_user, db_url):
    ada = as_user("ada@example.com", "sub-ada")
    ada_id = user_by_email(db_url, "ada@example.com").id
    board_id = add_board(db_url, ada_id, "Old", "workspace", {ada_id: "owner"})
    before = len(events(db_url))

    response = ada.patch(f"/api/boards/{board_id}", json={"name": "  New  "})

    assert response.status_code == 200
    assert response.json()["name"] == "New"
    [event] = events(db_url)[before:]
    assert (event.actor_id, event.kind, event.board_id) == (ada_id, "board.renamed", board_id)
    assert (event.subject_type, event.subject_id) == ("board", str(board_id))
    assert event.data == {"from": "Old", "to": "New"}
    assert response.json()["updated_at"] == iso(event.at)


def test_a_visibility_change_writes_one_event(as_user, db_url):
    ada = as_user("ada@example.com", "sub-ada")
    ada_id = user_by_email(db_url, "ada@example.com").id
    board_id = add_board(db_url, ada_id, "B", "workspace", {ada_id: "owner"})
    before = len(events(db_url))

    response = ada.patch(f"/api/boards/{board_id}", json={"visibility": "private"})

    assert response.status_code == 200
    assert response.json()["visibility"] == "private"
    [event] = events(db_url)[before:]
    assert (event.kind, event.board_id) == ("board.visibility_changed", board_id)
    assert event.data == {"from": "workspace", "to": "private"}


def test_an_unchanged_rename_writes_no_event(as_user, db_url):
    ada = as_user("ada@example.com", "sub-ada")
    ada_id = user_by_email(db_url, "ada@example.com").id
    board_id = add_board(db_url, ada_id, "Same", "workspace", {ada_id: "owner"})
    before = len(events(db_url))

    response = ada.patch(f"/api/boards/{board_id}", json={"name": "Same"})

    assert response.status_code == 200
    assert len(events(db_url)) == before


@pytest.mark.parametrize(
    "body", [{"name": "x" * 81}, {"name": ""}, {"name": "  "}, {"visibility": "secret"}]
)
def test_patch_validates_the_body(as_user, db_url, body):
    ada = as_user("ada@example.com", "sub-ada")
    ada_id = user_by_email(db_url, "ada@example.com").id
    board_id = add_board(db_url, ada_id, "Keep", "workspace", {ada_id: "owner"})
    before = len(events(db_url))

    response = ada.patch(f"/api/boards/{board_id}", json=body)

    assert response.status_code == 422
    assert board_row(db_url, board_id).name == "Keep"
    assert len(events(db_url)) == before


def test_a_patch_with_name_and_visibility_writes_one_event_and_applies_both(as_user, db_url):
    ada = as_user("ada@example.com", "sub-ada")
    ada_id = user_by_email(db_url, "ada@example.com").id
    board_id = add_board(db_url, ada_id, "Old", "workspace", {ada_id: "owner"})
    before = len(events(db_url))

    response = ada.patch(f"/api/boards/{board_id}", json={"name": "New", "visibility": "private"})

    assert response.status_code == 200
    assert (response.json()["name"], response.json()["visibility"]) == ("New", "private")
    [event] = events(db_url)[before:]
    assert (event.actor_id, event.kind, event.board_id) == (ada_id, "board.updated", board_id)
    assert event.data == {
        "name": {"from": "Old", "to": "New"},
        "visibility": {"from": "workspace", "to": "private"},
    }


def test_a_patch_that_cannot_apply_one_field_changes_neither_and_writes_no_event(
    as_user, db_url, monkeypatch
):
    ada = as_user("ada@example.com", "sub-ada")
    ada_id = user_by_email(db_url, "ada@example.com").id
    board_id = add_board(db_url, ada_id, "Old", "workspace", {ada_id: "owner"})
    before = len(events(db_url))
    interfere(monkeypatch, lambda: set_board_columns(db_url, board_id, visibility="private"))

    response = ada.patch(f"/api/boards/{board_id}", json={"name": "New", "visibility": "private"})

    assert response.status_code == 200
    assert (response.json()["name"], response.json()["visibility"]) == ("Old", "private")
    assert board_row(db_url, board_id).name == "Old"
    assert len(events(db_url)) == before


def test_a_rename_that_lost_a_race_writes_no_event_and_keeps_the_other_name(
    as_user, db_url, monkeypatch
):
    ada = as_user("ada@example.com", "sub-ada")
    ada_id = user_by_email(db_url, "ada@example.com").id
    board_id = add_board(db_url, ada_id, "Old", "workspace", {ada_id: "owner"})
    before = len(events(db_url))
    interfere(monkeypatch, lambda: set_board_columns(db_url, board_id, name="Other"))

    response = ada.patch(f"/api/boards/{board_id}", json={"name": "New"})

    assert response.status_code == 200
    assert response.json()["name"] == "Other"
    assert board_row(db_url, board_id).name == "Other"
    assert len(events(db_url)) == before


# ---- the actor is checked again inside the transaction ----------------------------


def _demoted_actor_case(as_user, db_url, monkeypatch):
    ada = as_user("ada@example.com", "sub-ada")
    ada_id = user_by_email(db_url, "ada@example.com").id
    bob = add_user(db_url, "bob@example.com")
    new = add_user(db_url, "new@example.com")
    board_id = add_board(db_url, ada_id, "B", "workspace", {ada_id: "owner", bob: "member"})
    interfere(monkeypatch, lambda: set_board_role(db_url, board_id, ada_id, "member"))
    return ada, board_id, bob, new


def test_an_owner_demoted_mid_request_cannot_rename(as_user, db_url, monkeypatch):
    ada, board_id, _bob, _new = _demoted_actor_case(as_user, db_url, monkeypatch)
    before = len(events(db_url))

    response = ada.patch(f"/api/boards/{board_id}", json={"name": "Renamed"})

    assert response.status_code == 403
    assert response.json() == {"detail": "forbidden"}
    assert board_row(db_url, board_id).name == "B"
    assert len(events(db_url)) == before


def test_an_owner_demoted_mid_request_cannot_add_a_member(as_user, db_url, monkeypatch):
    ada, board_id, _bob, new = _demoted_actor_case(as_user, db_url, monkeypatch)
    before = len(events(db_url))

    response = ada.post(f"/api/boards/{board_id}/members", json={"user_id": new})

    assert response.status_code == 403
    assert response.json() == {"detail": "forbidden"}
    assert board_role(db_url, board_id, new) is None
    assert len(events(db_url)) == before


def test_an_owner_demoted_mid_request_cannot_remove_a_member(as_user, db_url, monkeypatch):
    ada, board_id, bob, _new = _demoted_actor_case(as_user, db_url, monkeypatch)
    before = len(events(db_url))

    response = ada.delete(f"/api/boards/{board_id}/members/{bob}")

    assert response.status_code == 403
    assert response.json() == {"detail": "forbidden"}
    assert board_role(db_url, board_id, bob) == "member"
    assert len(events(db_url)) == before


# ---- role matrix ----------------------------------------------------------------

ACTIONS = {
    "rename": (200, lambda c, b, v, ids: c.patch(f"/api/boards/{b}", json={"name": "Renamed"})),
    "visibility": (
        200,
        lambda c, b, v, ids: c.patch(
            f"/api/boards/{b}", json={"visibility": "workspace" if v == "private" else "private"}
        ),
    ),
    "add": (
        201,
        lambda c, b, v, ids: c.post(f"/api/boards/{b}/members", json={"user_id": ids["new"]}),
    ),
    "role": (
        200,
        lambda c, b, v, ids: c.patch(
            f"/api/boards/{b}/members/{ids['tgt']}", json={"role": "observer"}
        ),
    ),
    "remove": (204, lambda c, b, v, ids: c.delete(f"/api/boards/{b}/members/{ids['tgt']}")),
}

# actor -> (workspace role, board row role, status on a Workspace board, on a Private board)
ACTORS = {
    "owner": ("member", "owner", "allow", "allow"),
    "member": ("member", "member", 403, 403),
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
    client = as_user("actor@example.com", "sub-actor", ws_role)
    actor_id = user_by_email(db_url, "actor@example.com").id
    boss = add_user(db_url, "boss@example.com")
    tgt = add_user(db_url, "tgt@example.com")
    new = add_user(db_url, "new@example.com")
    members = {boss: "owner", tgt: "member"}
    if row_role:
        members[actor_id] = row_role
    board_id = add_board(db_url, boss, "B", visibility, members)
    before = len(events(db_url))
    success, call = ACTIONS[action]

    response = call(client, board_id, visibility, {"tgt": tgt, "new": new})

    if expected == "allow":
        assert response.status_code == success, response.text
        [event] = events(db_url)[before:]
        assert event.actor_id == actor_id and event.board_id == board_id
    else:
        assert response.status_code == expected, response.text
        assert response.json() == {"detail": "forbidden" if expected == 403 else "board_not_found"}
        assert len(events(db_url)) == before
        assert board_row(db_url, board_id).name == "B"
        assert board_role(db_url, board_id, tgt) == "member"
        assert board_role(db_url, board_id, new) is None


# ---- members --------------------------------------------------------------------


def test_add_member_adds_a_member_row_and_one_event(as_user, db_url):
    ada = as_user("ada@example.com", "sub-ada")
    ada_id = user_by_email(db_url, "ada@example.com").id
    bob = add_user(db_url, "bob@example.com", pending=True)
    board_id = add_board(db_url, ada_id, "B", "workspace", {ada_id: "owner"})
    before = len(events(db_url))

    response = ada.post(f"/api/boards/{board_id}/members", json={"user_id": bob})

    assert response.status_code == 201
    body = response.json()
    assert (body["id"], body["role"], body["pending"]) == (bob, "member", True)
    assert set(body) == PERSON_KEYS | {"role", "added_at", "pending"}
    assert board_role(db_url, board_id, bob) == "member"
    [event] = events(db_url)[before:]
    assert (event.actor_id, event.kind, event.board_id) == (ada_id, "board_member.added", board_id)
    assert (event.subject_type, event.subject_id) == ("board", str(board_id))
    assert event.data == {"user_id": bob, "role": "member"}


@pytest.mark.parametrize("target", ["no_workspace_row", "missing"])
def test_add_member_needs_a_workspace_member(as_user, db_url, target):
    ada = as_user("ada@example.com", "sub-ada")
    ada_id = user_by_email(db_url, "ada@example.com").id
    board_id = add_board(db_url, ada_id, "B", "workspace", {ada_id: "owner"})
    user_id = (
        add_user(db_url, "ghost@example.com", workspace=False)
        if target == "no_workspace_row"
        else 99999
    )
    before = len(events(db_url))

    response = ada.post(f"/api/boards/{board_id}/members", json={"user_id": user_id})

    assert response.status_code == 404
    assert response.json() == {"detail": "member_not_found"}
    assert len(events(db_url)) == before


def test_add_member_twice_is_a_conflict(as_user, db_url):
    ada = as_user("ada@example.com", "sub-ada")
    ada_id = user_by_email(db_url, "ada@example.com").id
    bob = add_user(db_url, "bob@example.com")
    board_id = add_board(db_url, ada_id, "B", "workspace", {ada_id: "owner", bob: "observer"})
    before = len(events(db_url))

    response = ada.post(f"/api/boards/{board_id}/members", json={"user_id": bob})

    assert response.status_code == 409
    assert response.json() == {"detail": "already_member"}
    assert board_role(db_url, board_id, bob) == "observer"
    assert len(events(db_url)) == before


@pytest.mark.parametrize("body", [{"email": "bob@example.com"}, {"user_id": 2, "email": "x"}, {}])
def test_add_member_takes_a_user_id_only(as_user, db_url, body):
    ada = as_user("ada@example.com", "sub-ada")
    ada_id = user_by_email(db_url, "ada@example.com").id
    add_user(db_url, "bob@example.com")
    board_id = add_board(db_url, ada_id, "B", "workspace", {ada_id: "owner"})
    before = len(events(db_url))

    response = ada.post(f"/api/boards/{board_id}/members", json=body)

    assert response.status_code == 422
    assert len(events(db_url)) == before


def test_change_role_writes_one_event(as_user, db_url):
    ada = as_user("ada@example.com", "sub-ada")
    ada_id = user_by_email(db_url, "ada@example.com").id
    bob = add_user(db_url, "bob@example.com")
    board_id = add_board(db_url, ada_id, "B", "workspace", {ada_id: "owner", bob: "member"})
    before = len(events(db_url))

    response = ada.patch(f"/api/boards/{board_id}/members/{bob}", json={"role": "owner"})

    assert response.status_code == 200
    assert (response.json()["id"], response.json()["role"]) == (bob, "owner")
    assert board_role(db_url, board_id, bob) == "owner"
    [event] = events(db_url)[before:]
    assert (event.kind, event.board_id) == ("board_member.role_changed", board_id)
    assert (event.subject_type, event.subject_id) == ("board", str(board_id))
    assert event.data == {"user_id": bob, "from": "member", "to": "owner"}


def test_an_unchanged_board_role_answers_200_without_an_event(as_user, db_url):
    ada = as_user("ada@example.com", "sub-ada")
    ada_id = user_by_email(db_url, "ada@example.com").id
    bob = add_user(db_url, "bob@example.com")
    board_id = add_board(db_url, ada_id, "B", "workspace", {ada_id: "owner", bob: "member"})
    before = len(events(db_url))

    response = ada.patch(f"/api/boards/{board_id}/members/{bob}", json={"role": "member"})

    assert response.status_code == 200
    assert len(events(db_url)) == before


@pytest.mark.parametrize("method", ["PATCH", "DELETE"])
def test_a_person_not_on_the_board_is_not_found_on_role_routes(as_user, db_url, method):
    ada = as_user("ada@example.com", "sub-ada")
    ada_id = user_by_email(db_url, "ada@example.com").id
    bob = add_user(db_url, "bob@example.com")
    board_id = add_board(db_url, ada_id, "B", "workspace", {ada_id: "owner"})

    response = ada.request(method, f"/api/boards/{board_id}/members/{bob}", json={"role": "member"})

    assert response.status_code == 404
    assert response.json() == {"detail": "member_not_found"}


def test_a_bad_board_role_is_a_validation_error(as_user, db_url):
    ada = as_user("ada@example.com", "sub-ada")
    ada_id = user_by_email(db_url, "ada@example.com").id
    bob = add_user(db_url, "bob@example.com")
    board_id = add_board(db_url, ada_id, "B", "workspace", {ada_id: "owner", bob: "member"})

    response = ada.patch(f"/api/boards/{board_id}/members/{bob}", json={"role": "admin"})

    assert response.status_code == 422
    assert board_role(db_url, board_id, bob) == "member"


def test_remove_member_deletes_the_row_and_writes_one_event(as_user, db_url):
    ada = as_user("ada@example.com", "sub-ada")
    ada_id = user_by_email(db_url, "ada@example.com").id
    bob = add_user(db_url, "bob@example.com")
    board_id = add_board(db_url, ada_id, "B", "workspace", {ada_id: "owner", bob: "observer"})
    before = len(events(db_url))

    response = ada.delete(f"/api/boards/{board_id}/members/{bob}")

    assert response.status_code == 204
    assert board_role(db_url, board_id, bob) is None
    [event] = events(db_url)[before:]
    assert (event.kind, event.board_id) == ("board_member.removed", board_id)
    assert event.data == {"user_id": bob, "role": "observer"}


# ---- last owner -----------------------------------------------------------------


def test_the_only_owner_cannot_demote_themself(as_user, db_url):
    ada = as_user("ada@example.com", "sub-ada")
    ada_id = user_by_email(db_url, "ada@example.com").id
    board_id = add_board(db_url, ada_id, "B", "workspace", {ada_id: "owner"})
    before = len(events(db_url))

    response = ada.patch(f"/api/boards/{board_id}/members/{ada_id}", json={"role": "member"})

    assert response.status_code == 409
    assert response.json() == {"detail": "last_owner"}
    assert board_role(db_url, board_id, ada_id) == "owner"
    assert len(events(db_url)) == before


def test_the_only_owner_cannot_be_removed(as_user, db_url):
    ada = as_user("ada@example.com", "sub-ada")
    ada_id = user_by_email(db_url, "ada@example.com").id
    board_id = add_board(db_url, ada_id, "B", "workspace", {ada_id: "owner"})
    before = len(events(db_url))

    response = ada.delete(f"/api/boards/{board_id}/members/{ada_id}")

    assert response.status_code == 409
    assert response.json() == {"detail": "last_owner"}
    assert board_role(db_url, board_id, ada_id) == "owner"
    assert len(events(db_url)) == before


def test_with_two_owners_one_may_demote_themself_or_leave(as_user, db_url):
    ada = as_user("ada@example.com", "sub-ada")
    ada_id = user_by_email(db_url, "ada@example.com").id
    bob = add_user(db_url, "bob@example.com")
    cy = add_user(db_url, "cy@example.com")
    board_id = add_board(
        db_url, ada_id, "B", "workspace", {ada_id: "owner", bob: "owner", cy: "owner"}
    )

    demote = ada.patch(f"/api/boards/{board_id}/members/{ada_id}", json={"role": "member"})
    assert demote.status_code == 200
    assert board_role(db_url, board_id, ada_id) == "member"
    assert sorted(owners(db_url, board_id)) == sorted([bob, cy])


def test_an_owner_may_leave_when_another_owner_remains(as_user, db_url):
    ada = as_user("ada@example.com", "sub-ada")
    ada_id = user_by_email(db_url, "ada@example.com").id
    bob = add_user(db_url, "bob@example.com")
    board_id = add_board(db_url, ada_id, "B", "workspace", {ada_id: "owner", bob: "owner"})

    response = ada.delete(f"/api/boards/{board_id}/members/{ada_id}")

    assert response.status_code == 204
    assert owners(db_url, board_id) == [bob]


@pytest.mark.parametrize("action", ["demote", "remove"])
def test_an_admin_acting_as_owner_does_not_count_as_an_owner(as_user, db_url, action):
    admin = as_user("root@example.com", "sub-root", "admin")
    boss = add_user(db_url, "boss@example.com")
    board_id = add_board(db_url, boss, "B", "workspace", {boss: "owner"})
    before = len(events(db_url))

    path = f"/api/boards/{board_id}/members/{boss}"
    response = (
        admin.patch(path, json={"role": "member"}) if action == "demote" else admin.delete(path)
    )

    assert response.status_code == 409
    assert response.json() == {"detail": "last_owner"}
    assert owners(db_url, board_id) == [boss]
    assert len(events(db_url)) == before


def test_two_owners_demoting_each_other_at_once_leave_an_owner(as_user, db_url):
    a = as_user("a@example.com", "sub-a")
    b = as_user("b@example.com", "sub-b")
    a_id = user_by_email(db_url, "a@example.com").id
    b_id = user_by_email(db_url, "b@example.com").id
    board_id = add_board(db_url, a_id, "B", "workspace", {a_id: "owner", b_id: "owner"})
    barrier = threading.Barrier(2)
    statuses: list[int] = []

    def demote(client, target):
        barrier.wait()
        response = client.patch(f"/api/boards/{board_id}/members/{target}", json={"role": "member"})
        statuses.append(response.status_code)

    threads = [
        threading.Thread(target=demote, args=(a, b_id)),
        threading.Thread(target=demote, args=(b, a_id)),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(owners(db_url, board_id)) >= 1
    assert set(statuses) <= {200, 403, 409}


# ---- ownerless boards and take-ownership ----------------------------------------


def test_ownerless_lists_only_private_boards_with_no_owner_row_and_only_for_admins(as_user, db_url):
    admin = as_user("root@example.com", "sub-root", "admin")
    member = as_user("ada@example.com", "sub-ada")
    boss = add_user(db_url, "boss@example.com")
    add_board(db_url, boss, "Has owner", "private", {boss: "owner"})
    add_board(db_url, boss, "Open no owner", "workspace", {boss: "member"})
    orphan = add_board(db_url, boss, "Orphan", "private", {boss: "member"})

    response = admin.get("/api/boards/ownerless")

    assert response.status_code == 200
    assert [(b["id"], b["name"]) for b in response.json()] == [(orphan, "Orphan")]
    assert response.json()[0]["member_count"] == 1
    forbidden = member.get("/api/boards/ownerless")
    assert forbidden.status_code == 403
    assert forbidden.json() == {"detail": "forbidden"}


def test_take_ownership_makes_the_admin_an_owner_and_writes_one_event(as_user, db_url):
    admin = as_user("root@example.com", "sub-root", "admin")
    admin_id = user_by_email(db_url, "root@example.com").id
    boss = add_user(db_url, "boss@example.com")
    board_id = add_board(db_url, boss, "Orphan", "private", {boss: "member"})
    assert admin.get(f"/api/boards/{board_id}").status_code == 404
    before = len(events(db_url))

    response = admin.post(f"/api/boards/{board_id}/take-ownership")

    assert response.status_code == 200
    assert response.json()["my_role"] == "owner"
    assert owners(db_url, board_id) == [admin_id]
    [event] = events(db_url)[before:]
    assert (event.actor_id, event.kind, event.board_id) == (
        admin_id,
        "board.ownership_taken",
        board_id,
    )
    assert admin.get("/api/boards/ownerless").json() == []
    assert [b["name"] for b in admin.get("/api/boards").json()] == ["Orphan"]


def test_take_ownership_upgrades_an_admin_who_is_already_on_the_board(as_user, db_url):
    admin = as_user("root@example.com", "sub-root", "admin")
    admin_id = user_by_email(db_url, "root@example.com").id
    boss = add_user(db_url, "boss@example.com")
    board_id = add_board(db_url, boss, "Orphan", "private", {boss: "member", admin_id: "observer"})

    response = admin.post(f"/api/boards/{board_id}/take-ownership")

    assert response.status_code == 200
    assert board_role(db_url, board_id, admin_id) == "owner"


def test_take_ownership_of_a_private_board_the_admin_cannot_see_is_not_found(as_user, db_url):
    admin = as_user("root@example.com", "sub-root", "admin")
    boss = add_user(db_url, "boss@example.com")
    board_id = add_board(db_url, boss, "Owned", "private", {boss: "owner"})
    before = len(events(db_url))

    response = admin.post(f"/api/boards/{board_id}/take-ownership")

    assert response.status_code == 404
    assert response.json() == {"detail": "board_not_found"}
    assert owners(db_url, board_id) == [boss]
    assert len(events(db_url)) == before


def test_take_ownership_is_a_conflict_on_a_board_the_admin_can_see(as_user, db_url):
    admin = as_user("root@example.com", "sub-root", "admin")
    admin_id = user_by_email(db_url, "root@example.com").id
    boss = add_user(db_url, "boss@example.com")
    on_it = add_board(db_url, boss, "Mine", "private", {boss: "owner", admin_id: "observer"})
    open_board = add_board(db_url, boss, "Open", "workspace", {boss: "owner"})
    before = len(events(db_url))

    for board_id in (on_it, open_board):
        response = admin.post(f"/api/boards/{board_id}/take-ownership")

        assert response.status_code == 409
        assert response.json() == {"detail": "has_owner"}
        assert owners(db_url, board_id) == [boss]
    assert board_role(db_url, on_it, admin_id) == "observer"
    assert len(events(db_url)) == before


def test_an_admin_demoted_mid_request_cannot_take_ownership(as_user, db_url, monkeypatch):
    admin = as_user("root@example.com", "sub-root", "admin")
    admin_id = user_by_email(db_url, "root@example.com").id
    boss = add_user(db_url, "boss@example.com")
    board_id = add_board(db_url, boss, "Orphan", "private", {boss: "member"})
    before = len(events(db_url))
    interfere(monkeypatch, lambda: set_workspace_role(db_url, admin_id, "member"))

    response = admin.post(f"/api/boards/{board_id}/take-ownership")

    assert response.status_code == 403
    assert response.json() == {"detail": "forbidden"}
    assert owners(db_url, board_id) == []
    assert board_role(db_url, board_id, admin_id) is None
    assert len(events(db_url)) == before


def test_take_ownership_is_for_admins_only(as_user, db_url):
    member = as_user("ada@example.com", "sub-ada")
    boss = add_user(db_url, "boss@example.com")
    board_id = add_board(db_url, boss, "Orphan", "private", {boss: "member"})
    before = len(events(db_url))

    response = member.post(f"/api/boards/{board_id}/take-ownership")

    assert response.status_code == 403
    assert response.json() == {"detail": "forbidden"}
    assert owners(db_url, board_id) == []
    assert len(events(db_url)) == before


def test_take_ownership_of_an_unknown_board_is_not_found(as_user):
    admin = as_user("root@example.com", "sub-root", "admin")

    response = admin.post("/api/boards/99999/take-ownership")

    assert response.status_code == 404
    assert response.json() == {"detail": "board_not_found"}
