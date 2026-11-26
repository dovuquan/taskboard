"""Checklist items on a card: add, check, delete and undo, with roles, limits and events."""

from datetime import timedelta

import pytest
from sqlalchemy import event, update
from support import (
    add_board,
    add_card,
    add_checklist_item,
    add_checklist_items,
    add_comment,
    add_comments,
    add_list,
    add_user,
    card_world,
    checklist_rows,
    curl,
    events,
    interfere,
    query,
    set_board_columns,
    user_by_email,
)

from taskboard.models import BoardMember, Card, _now


def detail(w, items=(), **extra):
    """The card detail of card TB-1 (title "A") with `items` as (id, text, done) tuples."""
    return {
        "id": w["card"],
        "key": "TB-1",
        "list_id": w["list"],
        "title": "A",
        "label_ids": [],
        "member_ids": [],
        "due_on": None,
        "has_description": False,
        "description": None,
        "checklist_done": sum(1 for _i, _t, done in items if done),
        "checklist_total": len(items),
        "comment_count": 0,
        "checklist": [{"id": i, "text": t, "done": d} for i, t, d in items],
        **extra,
    }


def state(db_url, card_id):
    return checklist_rows(db_url, card_id)


def item_events(db_url):
    return [e for e in events(db_url) if e.subject_type == "card"]


# ---- not signed in ---------------------------------------------------------------

ROUTES = [
    ("POST", "/api/boards/1/cards/1/checklist", {"text": "X"}),
    ("PATCH", "/api/boards/1/cards/1/checklist/1", {"done": True}),
    ("DELETE", "/api/boards/1/cards/1/checklist/1", None),
    ("POST", "/api/boards/1/cards/1/checklist/1/restore", {}),
]


@pytest.mark.parametrize(("method", "path", "body"), ROUTES)
def test_the_checklist_routes_need_a_session(client, method, path, body):
    response = client.request(method, path, json=body)

    assert response.status_code == 401
    assert response.json() == {"detail": "not_signed_in"}


# ---- the role matrix: 6 actors x 2 visibilities x 5 actions ----------------------

# actor -> (workspace role, board row role, status on a Workspace board, on a Private board)
ACTORS = {
    "owner": ("member", "owner", "allow", "allow"),
    "member": ("member", "member", "allow", "allow"),
    "observer": ("member", "observer", 403, 403),
    "outsider": ("member", None, 403, 404),
    "admin": ("admin", None, "allow", 404),
    "admin_observer": ("admin", "observer", "allow", "allow"),
}

# action -> (call, status, event kind, event data builder, expected items builder)
# Fixture: item `live` (id 1, unchecked); item `gone` (id 2, checked, deleted by the actor 5 s ago).
MATRIX = {
    "get": (
        lambda c, b, card, ids: c.get(curl(b, card)),
        200,
        None,
        None,
        lambda ids: [(1, "Live", False)],
    ),
    "add": (
        lambda c, b, card, ids: c.post(curl(b, card, "checklist"), json={"text": "New"}),
        201,
        "checklist.item_added",
        lambda ids: {"key": "TB-1", "item_id": 3, "text": "New"},
        lambda ids: [(1, "Live", False), (3, "New", False)],
    ),
    "check": (
        lambda c, b, card, ids: c.patch(curl(b, card, "checklist", 1), json={"done": True}),
        200,
        "checklist.item_checked",
        lambda ids: {"key": "TB-1", "item_id": 1, "text": "Live"},
        lambda ids: [(1, "Live", True)],
    ),
    "delete": (
        lambda c, b, card, ids: c.delete(curl(b, card, "checklist", 1)),
        200,
        "checklist.item_deleted",
        lambda ids: {"key": "TB-1", "item_id": 1, "text": "Live"},
        lambda ids: [],
    ),
    "restore": (
        lambda c, b, card, ids: c.post(curl(b, card, "checklist", 2, "restore"), json={}),
        200,
        "checklist.item_restored",
        lambda ids: {"key": "TB-1", "item_id": 2, "text": "Gone"},
        lambda ids: [(1, "Live", False), (2, "Gone", True)],
    ),
}


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
    members = {boss: "owner"}
    if row_role:
        members[actor_id] = row_role
    board_id = add_board(db_url, boss, "B", visibility, members)
    list_id = add_list(db_url, board_id, "L", 1.0)
    card_id = add_card(db_url, board_id, list_id, "A", 1.0)
    live = add_checklist_item(db_url, card_id, "Live", created_by=boss)
    gone = add_checklist_item(
        db_url,
        card_id,
        "Gone",
        done=True,
        deleted_at=_now() - timedelta(seconds=5),
        deleted_by=actor_id,
        created_by=boss,
    )
    assert (live, gone) == (1, 2)
    w = {"card": card_id, "list": list_id}
    snapshot = state(db_url, card_id)
    before = len(events(db_url))
    call, status, kind, data, items = MATRIX[action]

    response = call(client, board_id, card_id, None)

    if expected == "allow":
        assert response.status_code == status, response.text
        assert response.json() == detail(w, items(None))
        if kind is None:
            assert len(events(db_url)) == before
            return
        [recorded] = events(db_url)[before:]
        assert (recorded.kind, recorded.actor_id, recorded.board_id) == (kind, actor_id, board_id)
        assert (recorded.subject_type, recorded.subject_id) == ("card", str(card_id))
        assert recorded.data == data(None)
    else:
        assert response.status_code == expected, response.text
        assert response.json() == {"detail": "forbidden" if expected == 403 else "board_not_found"}
        assert len(events(db_url)) == before
        assert state(db_url, card_id) == snapshot


# ---- add ------------------------------------------------------------------------


def test_adding_trims_the_text_and_starts_unchecked(as_user, db_url):
    w = card_world(as_user, db_url)

    response = w["client"].post(curl(w["board"], w["card"], "checklist"), json={"text": "  Buy  "})

    assert response.status_code == 201
    assert response.json()["checklist"] == [{"id": 1, "text": "Buy", "done": False}]
    [row] = checklist_rows(db_url, w["card"])
    assert row[1:3] == ("Buy", False)
    [recorded] = item_events(db_url)
    assert recorded.data == {"key": "TB-1", "item_id": 1, "text": "Buy"}


def test_the_text_may_be_200_characters_but_not_201(as_user, db_url):
    w = card_world(as_user, db_url)
    url = curl(w["board"], w["card"], "checklist")

    ok = w["client"].post(url, json={"text": "x" * 200})
    too_long = w["client"].post(url, json={"text": "y" * 201})

    assert ok.status_code == 201
    assert too_long.status_code == 422
    assert "yyyy" not in too_long.text
    assert [r[1] for r in checklist_rows(db_url, w["card"])] == ["x" * 200]
    assert len(item_events(db_url)) == 1


@pytest.mark.parametrize(
    "body",
    [
        {"text": ""},
        {"text": "   "},
        {"text": "​​"},
        {"text": "a\x00b"},
        {"text": "a\nb"},
        {"text": 5},
        {"text": None},
        {},
        {"text": "ok", "done": True},
    ],
)
def test_bad_item_text_is_refused_and_writes_nothing(as_user, db_url, body):
    w = card_world(as_user, db_url)

    response = w["client"].post(curl(w["board"], w["card"], "checklist"), json=body)

    assert response.status_code == 422
    assert checklist_rows(db_url, w["card"]) == []
    assert item_events(db_url) == []


def test_item_text_with_a_lone_surrogate_is_refused_without_echo(as_user, db_url):
    w = card_world(as_user, db_url)

    response = w["client"].post(
        curl(w["board"], w["card"], "checklist"),
        content=b'{"text": "bad \\ud800 surrogate"}',
        headers={"content-type": "application/json"},
    )

    assert response.status_code == 422
    assert "input" not in response.text and "surrogate" not in response.text
    assert checklist_rows(db_url, w["card"]) == []
    assert item_events(db_url) == []


def test_the_101st_live_item_is_refused_and_deleted_ones_do_not_count(as_user, db_url):
    w = card_world(as_user, db_url)
    add_checklist_items(db_url, w["card"], 99, deleted=5)
    url = curl(w["board"], w["card"], "checklist")

    hundredth = w["client"].post(url, json={"text": "100th"})
    hundred_and_first = w["client"].post(url, json={"text": "101st"})

    assert hundredth.status_code == 201
    assert hundred_and_first.status_code == 422
    assert hundred_and_first.json() == {"detail": "checklist_limit"}
    assert len([r for r in checklist_rows(db_url, w["card"]) if r[3] is None]) == 100
    assert len(checklist_rows(db_url, w["card"])) == 105
    assert len(item_events(db_url)) == 1


# ---- check and uncheck -----------------------------------------------------------


def test_checking_and_unchecking_each_write_one_event(as_user, db_url):
    w = card_world(as_user, db_url)
    item = add_checklist_item(db_url, w["card"], "Do it")
    url = curl(w["board"], w["card"], "checklist", item)

    checked = w["client"].patch(url, json={"done": True})
    unchecked = w["client"].patch(url, json={"done": False})

    assert checked.json() == detail(w, [(item, "Do it", True)])
    assert unchecked.json() == detail(w, [(item, "Do it", False)])
    first, second = item_events(db_url)
    assert (first.kind, second.kind) == ("checklist.item_checked", "checklist.item_unchecked")
    assert first.actor_id == w["ada"]
    assert second.data == {"key": "TB-1", "item_id": item, "text": "Do it"}


@pytest.mark.parametrize("done", [True, False])
def test_a_check_that_changes_nothing_answers_200_and_writes_no_event(as_user, db_url, done):
    w = card_world(as_user, db_url)
    item = add_checklist_item(db_url, w["card"], "Same", done=done)
    snapshot = state(db_url, w["card"])

    response = w["client"].patch(
        curl(w["board"], w["card"], "checklist", item), json={"done": done}
    )

    assert response.status_code == 200
    assert response.json() == detail(w, [(item, "Same", done)])
    assert state(db_url, w["card"]) == snapshot
    assert item_events(db_url) == []


@pytest.mark.parametrize(
    "body", [{"done": "yes"}, {"done": 1}, {"done": None}, {}, {"done": True, "text": "x"}]
)
def test_the_done_flag_must_be_a_real_boolean(as_user, db_url, body):
    w = card_world(as_user, db_url)
    item = add_checklist_item(db_url, w["card"], "Same")

    response = w["client"].patch(curl(w["board"], w["card"], "checklist", item), json=body)

    assert response.status_code == 422
    assert checklist_rows(db_url, w["card"])[0][2] is False
    assert item_events(db_url) == []


# ---- delete and undo -------------------------------------------------------------


def test_deleting_hides_the_item_but_keeps_the_row(as_user, db_url):
    w = card_world(as_user, db_url)
    item = add_checklist_item(db_url, w["card"], "Bye")
    add_checklist_item(db_url, w["card"], "Stay")

    response = w["client"].delete(curl(w["board"], w["card"], "checklist", item))

    assert response.status_code == 200
    assert response.json() == detail(w, [(2, "Stay", False)])
    [row] = [r for r in checklist_rows(db_url, w["card"]) if r[0] == item]
    assert row[3] is not None and row[4] == w["ada"]
    assert w["client"].get(curl(w["board"], w["card"])).json()["checklist"] == [
        {"id": 2, "text": "Stay", "done": False}
    ]


def test_an_unknown_or_foreign_or_deleted_item_is_not_found(as_user, db_url):
    w = card_world(as_user, db_url)
    other_card = add_card(db_url, w["board"], w["list"], "Other", 2.0)
    foreign = add_checklist_item(db_url, other_card, "Elsewhere")
    gone = add_checklist_item(db_url, w["card"], "Gone", deleted_at=_now(), deleted_by=w["ada"])
    live = add_checklist_item(db_url, w["card"], "Live")
    snapshot = (state(db_url, w["card"]), state(db_url, other_card))
    calls = []
    for item in (99999, foreign, gone):
        calls.append(("patch", item, {"done": True}))
        calls.append(("delete", item, None))
    calls.append(("post", live, {}))  # restoring an item that is not deleted
    calls.append(("post", 99999, {}))
    calls.append(("post", foreign, {}))

    for method, item, body in calls:
        path = curl(w["board"], w["card"], "checklist", item)
        if method == "post":
            path += "/restore"
        response = w["client"].request(method.upper(), path, json=body)
        assert response.status_code == 404, (method, item, response.text)
        assert response.json() == {"detail": "item_not_found"}

    assert (state(db_url, w["card"]), state(db_url, other_card)) == snapshot
    assert item_events(db_url) == []


def _deleted_item(db_url, w, *, age, by):
    return add_checklist_item(
        db_url,
        w["card"],
        "Gone",
        done=True,
        deleted_at=_now() - timedelta(seconds=age),
        deleted_by={"ada": w["ada"], "cy": w["cy"], "boss": w["boss"]}[by],
    )


def test_undo_by_the_deleter_within_60_seconds_keeps_id_order_and_done(as_user, db_url):
    w = card_world(as_user, db_url)
    first = add_checklist_item(db_url, w["card"], "First")
    gone = _deleted_item(db_url, w, age=5, by="ada")
    last = add_checklist_item(db_url, w["card"], "Last")

    response = w["client"].post(curl(w["board"], w["card"], "checklist", gone, "restore"), json={})

    assert response.status_code == 200
    assert response.json() == detail(
        w, [(first, "First", False), (gone, "Gone", True), (last, "Last", False)]
    )
    [recorded] = item_events(db_url)
    assert recorded.kind == "checklist.item_restored"
    assert [r[3:] for r in checklist_rows(db_url, w["card"]) if r[0] == gone] == [(None, None)]


def test_a_delete_then_undo_through_the_api_round_trips(as_user, db_url):
    w = card_world(as_user, db_url)
    item = add_checklist_item(db_url, w["card"], "Round", done=True)
    base = curl(w["board"], w["card"], "checklist", item)

    w["client"].delete(base)
    response = w["client"].post(base + "/restore", json={})

    assert response.json() == detail(w, [(item, "Round", True)])
    assert [e.kind for e in item_events(db_url)] == [
        "checklist.item_deleted",
        "checklist.item_restored",
    ]


@pytest.mark.parametrize(
    ("age", "by"),
    [(61, "ada"), (3600, "ada"), (5, "cy"), (5, "boss")],
    ids=["after 61 s", "after an hour", "another member deleted", "the owner deleted"],
)
def test_undo_is_refused_after_60_seconds_or_for_someone_else(as_user, db_url, age, by):
    w = card_world(as_user, db_url, "owner")
    gone = _deleted_item(db_url, w, age=age, by=by)
    snapshot = state(db_url, w["card"])

    response = w["client"].post(curl(w["board"], w["card"], "checklist", gone, "restore"), json={})

    assert response.status_code == 403
    assert response.json() == {"detail": "forbidden"}
    assert state(db_url, w["card"]) == snapshot
    assert item_events(db_url) == []


def test_undo_over_the_limit_is_refused(as_user, db_url):
    w = card_world(as_user, db_url)
    add_checklist_items(db_url, w["card"], 100)
    gone = _deleted_item(db_url, w, age=5, by="ada")
    snapshot = state(db_url, w["card"])

    response = w["client"].post(curl(w["board"], w["card"], "checklist", gone, "restore"), json={})

    assert response.status_code == 422
    assert response.json() == {"detail": "checklist_limit"}
    assert state(db_url, w["card"]) == snapshot
    assert item_events(db_url) == []


# ---- hidden cards ----------------------------------------------------------------

ACTIONS = {
    "add": lambda c, b, card, item: c.post(curl(b, card, "checklist"), json={"text": "New"}),
    "check": lambda c, b, card, item: c.patch(
        curl(b, card, "checklist", item), json={"done": True}
    ),
    "delete": lambda c, b, card, item: c.delete(curl(b, card, "checklist", item)),
    "restore": lambda c, b, card, item: c.post(
        curl(b, card, "checklist", item, "restore"), json={}
    ),
}


@pytest.mark.parametrize("action", list(ACTIONS))
@pytest.mark.parametrize("why", ["archived_card", "archived_list", "foreign_board", "unknown"])
def test_every_route_says_card_not_found_for_a_hidden_card(as_user, db_url, action, why):
    w = card_world(as_user, db_url, "owner")
    other = add_board(db_url, w["ada"], "O", "workspace", {w["ada"]: "owner"})
    foreign = add_card(db_url, other, add_list(db_url, other, "L", 1.0), "z", 1.0)
    gone_list = add_list(db_url, w["board"], "G", 2.0, archived_by=w["ada"], archived_at=_now())
    card = {
        "archived_card": add_card(db_url, w["board"], w["list"], "x", 2.0, archived_at=_now()),
        "archived_list": add_card(db_url, w["board"], gone_list, "y", 1.0),
        "foreign_board": foreign,
        "unknown": 99999,
    }[why]
    targets = {card, foreign} - {99999}
    item = 0
    for target in targets:
        item = add_checklist_item(db_url, target, "Gone", deleted_at=_now(), deleted_by=w["ada"])
    snapshot = {c: state(db_url, c) for c in targets}
    before = len(events(db_url))

    response = ACTIONS[action](w["client"], w["board"], card, item or 1)

    assert response.status_code == 404, response.text
    assert response.json() == {"detail": "card_not_found"}
    assert len(events(db_url)) == before
    assert {c: state(db_url, c) for c in snapshot} == snapshot


@pytest.mark.parametrize("action", list(ACTIONS))
def test_every_route_says_board_not_found_on_an_archived_board(as_user, db_url, action):
    w = card_world(as_user, db_url, "owner")
    item = add_checklist_item(db_url, w["card"], "Gone", deleted_at=_now(), deleted_by=w["ada"])
    set_board_columns(db_url, w["board"], archived_at=_now())
    snapshot = state(db_url, w["card"])

    response = ACTIONS[action](w["client"], w["board"], w["card"], item)

    assert response.status_code == 404
    assert response.json() == {"detail": "board_not_found"}
    assert state(db_url, w["card"]) == snapshot
    assert item_events(db_url) == []


# ---- concurrency and atomicity ---------------------------------------------------


@pytest.mark.parametrize("action", list(ACTIONS))
def test_a_card_archived_just_before_the_transaction_is_not_found(
    as_user, db_url, monkeypatch, action
):
    w = card_world(as_user, db_url)
    item = add_checklist_item(db_url, w["card"], "Gone", deleted_at=_now(), deleted_by=w["ada"])

    def archive():
        query(
            db_url,
            lambda s: (
                s.execute(update(Card).where(Card.id == w["card"]).values(archived_at=_now())),
                s.commit(),
            ),
        )

    interfere(monkeypatch, archive, "checklist")
    snapshot = state(db_url, w["card"])

    response = ACTIONS[action](w["client"], w["board"], w["card"], item)

    assert response.status_code == 404
    assert response.json() == {"detail": "card_not_found"}
    assert state(db_url, w["card"]) == snapshot
    assert item_events(db_url) == []


@pytest.mark.parametrize("action", list(ACTIONS))
def test_an_actor_demoted_just_before_the_transaction_cannot_write(
    as_user, db_url, monkeypatch, action
):
    w = card_world(as_user, db_url, "member")
    item = add_checklist_item(db_url, w["card"], "Gone", deleted_at=_now(), deleted_by=w["ada"])

    def demote():
        query(
            db_url,
            lambda s: (
                s.execute(
                    update(BoardMember)
                    .where(BoardMember.board_id == w["board"], BoardMember.user_id == w["ada"])
                    .values(role="observer")
                ),
                s.commit(),
            ),
        )

    interfere(monkeypatch, demote, "checklist")
    snapshot = state(db_url, w["card"])

    response = ACTIONS[action](w["client"], w["board"], w["card"], item)

    assert response.status_code == 403
    assert response.json() == {"detail": "forbidden"}
    assert state(db_url, w["card"]) == snapshot
    assert item_events(db_url) == []


def test_an_item_deleted_by_someone_else_in_the_meantime_is_not_found(as_user, db_url, monkeypatch):
    from taskboard.models import ChecklistItem

    w = card_world(as_user, db_url)
    item = add_checklist_item(db_url, w["card"], "Racy")

    def delete_it():
        query(
            db_url,
            lambda s: (
                s.execute(
                    update(ChecklistItem)
                    .where(ChecklistItem.id == item)
                    .values(deleted_at=_now(), deleted_by=w["cy"])
                ),
                s.commit(),
            ),
        )

    interfere(monkeypatch, delete_it, "checklist")

    response = w["client"].patch(
        curl(w["board"], w["card"], "checklist", item), json={"done": True}
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "item_not_found"}
    assert checklist_rows(db_url, w["card"])[0][2] is False
    assert item_events(db_url) == []


def test_a_failing_event_insert_leaves_no_item_and_no_event(as_user, db_url, monkeypatch):
    from taskboard import checklist

    w = card_world(as_user, db_url)
    real = checklist.record_change

    def boom(session, change, **kw):
        return real(session, lambda s: (change(s), 1 / 0)[0], **kw)

    monkeypatch.setattr(checklist, "record_change", boom)
    with pytest.raises(ZeroDivisionError):
        w["client"].post(curl(w["board"], w["card"], "checklist"), json={"text": "X"})

    assert checklist_rows(db_url, w["card"]) == []
    assert item_events(db_url) == []


# ---- the tile and the detail -----------------------------------------------------


def test_the_tile_counts_live_items_done_items_and_live_comments(as_user, db_url):
    w = card_world(as_user, db_url, "observer")
    add_checklist_item(db_url, w["card"], "a", done=True)
    add_checklist_item(db_url, w["card"], "b")
    add_checklist_item(db_url, w["card"], "c", done=True, deleted_at=_now(), deleted_by=w["boss"])
    add_comment(db_url, w["card"], w["boss"], "one")
    add_comment(db_url, w["card"], w["cy"], "two", deleted_at=_now(), deleted_by=w["cy"])
    empty = add_card(db_url, w["board"], w["list"], "Empty", 2.0)

    tiles = w["client"].get(f"/api/boards/{w['board']}/cards").json()
    one = w["client"].get(curl(w["board"], w["card"])).json()

    by_id = {t["id"]: t for t in tiles}
    assert [
        by_id[w["card"]][k] for k in ("checklist_done", "checklist_total", "comment_count")
    ] == [
        1,
        2,
        1,
    ]
    assert [by_id[empty][k] for k in ("checklist_done", "checklist_total", "comment_count")] == [
        0,
        0,
        0,
    ]
    assert one["checklist"] == [
        {"id": 1, "text": "a", "done": True},
        {"id": 2, "text": "b", "done": False},
    ]
    assert (one["checklist_done"], one["checklist_total"], one["comment_count"]) == (1, 2, 1)


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


def test_the_number_of_queries_does_not_grow_with_items_and_comments(as_user, db_url, app):
    w = card_world(as_user, db_url)
    url = f"/api/boards/{w['board']}/cards"

    def fill(n):
        for i in range(n):
            card = add_card(db_url, w["board"], w["list"], f"c{i}", 10.0 + i)
            add_checklist_items(db_url, card, 2)
            add_comments(db_url, card, w["boss"], 2)

    fill(2)
    few = _count_queries(app, lambda: w["client"].get(url))
    fill(30)
    many = _count_queries(app, lambda: w["client"].get(url))

    assert many == few
