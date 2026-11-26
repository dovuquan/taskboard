"""Comments on a card: post, edit and delete within 24 hours by the author, and undo."""

from datetime import datetime, timedelta

import pytest
from sqlalchemy import update
from support import (
    add_board,
    add_card,
    add_comment,
    add_comments,
    add_list,
    add_user,
    card_world,
    comment_rows,
    curl,
    events,
    interfere,
    query,
    set_board_columns,
    user_by_email,
)

from taskboard import comments
from taskboard.models import BoardMember, Card, Comment, User, _now

HOUR = timedelta(hours=1)
DAY = timedelta(hours=24)


def iso(dt):
    return None if dt is None else dt.isoformat() + "Z"


def person(db_url, user_id):
    def read(s):
        user = s.get(User, user_id)
        return {"id": user.id, "name": user.name, "avatar_url": user.avatar_url}

    return query(db_url, read)


def row_of(db_url, comment_id):
    return query(db_url, lambda s: s.get(Comment, comment_id))


def expected_comment(db_url, comment_id, *, editable):
    """The wire shape of a comment as the database holds it now."""
    row = row_of(db_url, comment_id)
    return {
        "id": row.id,
        "author": person(db_url, row.author_id),
        "text": row.text,
        "created_at": iso(row.created_at),
        "edited_at": iso(row.edited_at),
        "editable_until": iso(row.created_at + DAY) if editable else None,
    }


def state(db_url, card_id):
    return comment_rows(db_url, card_id)


def comment_events(db_url):
    return [e for e in events(db_url) if e.subject_type == "card"]


# ---- not signed in ---------------------------------------------------------------

ROUTES = [
    ("GET", "/api/boards/1/cards/1/feed", None),
    ("POST", "/api/boards/1/cards/1/comments", {"text": "X"}),
    ("PATCH", "/api/boards/1/cards/1/comments/1", {"text": "X"}),
    ("DELETE", "/api/boards/1/cards/1/comments/1", None),
    ("POST", "/api/boards/1/cards/1/comments/1/restore", {}),
]


@pytest.mark.parametrize(("method", "path", "body"), ROUTES)
def test_the_comment_routes_need_a_session(client, method, path, body):
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

# action -> (call, status, event kind or None, id of the comment the answer is about)
# Fixture: comment 1 is the actor's own (1 h old); comment 2 is the actor's, created 1 h ago and
# deleted by the actor 5 s ago.
MATRIX = {
    "feed": (lambda c, b, card: c.get(curl(b, card, "feed")), 200, None, None),
    "post": (
        lambda c, b, card: c.post(curl(b, card, "comments"), json={"text": "Hello"}),
        201,
        "comment.added",
        3,
    ),
    "edit": (
        lambda c, b, card: c.patch(curl(b, card, "comments", 1), json={"text": "Changed"}),
        200,
        "comment.edited",
        1,
    ),
    "delete": (
        lambda c, b, card: c.delete(curl(b, card, "comments", 1)),
        204,
        "comment.deleted",
        None,
    ),
    "restore": (
        lambda c, b, card: c.post(curl(b, card, "comments", 2, "restore"), json={}),
        200,
        "comment.restored",
        2,
    ),
}


@pytest.mark.parametrize("visibility", ["workspace", "private"])
@pytest.mark.parametrize("actor", list(ACTORS))
@pytest.mark.parametrize("action", list(MATRIX))
def test_role_matrix(as_user, db_url, action, actor, visibility):
    ws_role, row_role, on_workspace, on_private = ACTORS[actor]
    expected = on_workspace if visibility == "workspace" else on_private
    if action == "feed" and expected == 403:
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
    add_comment(db_url, card_id, actor_id, "Own", created_at=_now() - HOUR)
    add_comment(
        db_url,
        card_id,
        actor_id,
        "Gone",
        created_at=_now() - HOUR,
        deleted_at=_now() - timedelta(seconds=5),
        deleted_by=actor_id,
    )
    snapshot = state(db_url, card_id)
    before = len(events(db_url))
    call, status, kind, about = MATRIX[action]

    response = call(client, board_id, card_id)

    if expected == "allow":
        assert response.status_code == status, response.text
        if action == "feed":
            assert [e["id"] for e in response.json()["entries"]] == [1]
        elif action == "delete":
            assert response.content == b""
        else:
            assert response.json() == expected_comment(db_url, about, editable=True)
        if kind is None:
            assert len(events(db_url)) == before
            return
        [recorded] = events(db_url)[before:]
        assert (recorded.kind, recorded.actor_id, recorded.board_id) == (kind, actor_id, board_id)
        assert (recorded.subject_type, recorded.subject_id) == ("card", str(card_id))
        assert recorded.data == {"key": "TB-1", "comment_id": about or 1}
    else:
        assert response.status_code == expected, response.text
        assert response.json() == {"detail": "forbidden" if expected == 403 else "board_not_found"}
        assert len(events(db_url)) == before
        assert state(db_url, card_id) == snapshot


# ---- posting ---------------------------------------------------------------------


def test_posting_stores_the_comment_and_answers_it(as_user, db_url):
    w = card_world(as_user, db_url)

    response = w["client"].post(curl(w["board"], w["card"], "comments"), json={"text": "  Hi  "})

    assert response.status_code == 201
    body = response.json()
    assert body == expected_comment(db_url, 1, editable=True)
    assert body["text"] == "Hi"
    assert body["edited_at"] is None
    assert body["author"]["id"] == w["ada"]
    assert [r[1:3] for r in state(db_url, w["card"])] == [(w["ada"], "Hi")]


def test_comment_text_is_stored_as_typed_and_never_cleaned(as_user, db_url):
    w = card_world(as_user, db_url)
    url = curl(w["board"], w["card"], "comments")

    first = w["client"].post(url, json={"text": "<b>hi</b> 2 < 3 & more\tx"})
    second = w["client"].post(url, json={"text": "a\r\nb\r\nc"})

    assert first.json()["text"] == "<b>hi</b> 2 < 3 & more\tx"
    assert second.json()["text"] == "a\nb\nc"
    assert [r[2] for r in state(db_url, w["card"])] == ["<b>hi</b> 2 < 3 & more\tx", "a\nb\nc"]


def test_comment_text_may_be_5000_characters_but_not_5001(as_user, db_url):
    w = card_world(as_user, db_url)
    url = curl(w["board"], w["card"], "comments")

    ok = w["client"].post(url, json={"text": "x" * 5000})
    too_long = w["client"].post(url, json={"text": "y" * 5001})

    assert ok.status_code == 201
    assert too_long.status_code == 422
    assert "yyyy" not in too_long.text
    assert len(state(db_url, w["card"])) == 1
    assert len(comment_events(db_url)) == 1


@pytest.mark.parametrize(
    "body",
    [
        {"text": ""},
        {"text": " \n\t "},
        {"text": "​​"},
        {"text": "a\x00b"},
        {"text": "a\x07b"},
        {"text": "a\rb"},
        {"text": 5},
        {"text": None},
        {},
        {"text": "ok", "author_id": 1},
    ],
)
def test_bad_comment_text_is_refused_and_writes_nothing(as_user, db_url, body):
    w = card_world(as_user, db_url)

    response = w["client"].post(curl(w["board"], w["card"], "comments"), json=body)

    assert response.status_code == 422
    assert "detail" in response.json()
    assert state(db_url, w["card"]) == []
    assert comment_events(db_url) == []


@pytest.mark.parametrize(
    "text",
    [
        "pay ‮erutangis‬ now",  # right-to-left override
        "a⁦b⁩",  # isolates
        "a‎b",  # left-to-right mark
        "a‏b",  # right-to-left mark
        "hel​lo",  # zero-width space inside text
        "hel‍lo",  # zero-width joiner
        "hel﻿o",  # byte order mark
        "a b",  # line separator
        "aㅤb",  # blank-looking letter
    ],
)
def test_comment_text_with_hidden_characters_is_refused_on_post_and_edit(as_user, db_url, text):
    w = card_world(as_user, db_url)
    url = curl(w["board"], w["card"], "comments")
    existing = add_comment(db_url, w["card"], w["ada"], "Fine")

    posted = w["client"].post(url, json={"text": text})
    edited = w["client"].patch(f"{url}/{existing}", json={"text": text})

    assert posted.status_code == 422
    assert edited.status_code == 422
    assert text not in posted.text and text not in edited.text
    assert [r[2] for r in state(db_url, w["card"])] == ["Fine"]
    assert comment_events(db_url) == []


def test_ordinary_international_text_and_emoji_are_accepted(as_user, db_url):
    w = card_world(as_user, db_url)
    url = curl(w["board"], w["card"], "comments")
    texts = [
        "Xin chào, tôi đã hoàn thành việc này rồi",
        "Café résumé naïve señor Zoë",
        "Thumbs up \U0001f44d and a party \U0001f389\nsecond line\twith a tab",
        "日本語のコメント",
    ]

    for text in texts:
        response = w["client"].post(url, json={"text": text})
        assert response.status_code == 201, text
        assert response.json()["text"] == text


def test_comment_text_with_a_lone_surrogate_is_refused_without_echo(as_user, db_url):
    w = card_world(as_user, db_url)

    response = w["client"].post(
        curl(w["board"], w["card"], "comments"),
        content=b'{"text": "bad \\ud800 surrogate"}',
        headers={"content-type": "application/json"},
    )

    assert response.status_code == 422
    assert "input" not in response.text and "surrogate" not in response.text
    assert state(db_url, w["card"]) == []
    assert comment_events(db_url) == []


def test_the_501st_live_comment_is_refused_and_deleted_ones_do_not_count(as_user, db_url):
    w = card_world(as_user, db_url)
    add_comments(db_url, w["card"], w["boss"], 499)
    add_comment(db_url, w["card"], w["boss"], "gone", deleted_at=_now(), deleted_by=w["boss"])
    url = curl(w["board"], w["card"], "comments")

    five_hundredth = w["client"].post(url, json={"text": "500th"})
    five_hundred_and_first = w["client"].post(url, json={"text": "501st"})

    assert five_hundredth.status_code == 201
    assert five_hundred_and_first.status_code == 422
    assert five_hundred_and_first.json() == {"detail": "comment_limit"}
    assert len(state(db_url, w["card"])) == 501
    assert len(comment_events(db_url)) == 1


# ---- who may edit or delete, and when --------------------------------------------

# (case id, ada's board role, ada's workspace role, who wrote it, age, status, detail)
OWNERSHIP = [
    ("author", "member", "member", "ada", HOUR, 200, None),
    ("author just inside", "member", "member", "ada", DAY - timedelta(seconds=5), 200, None),
    (
        "author past 24 h",
        "member",
        "member",
        "ada",
        DAY + timedelta(seconds=5),
        403,
        "edit_window_closed",
    ),
    ("another member", "member", "member", "cy", HOUR, 403, "forbidden"),
    ("owner is not the author", "owner", "member", "cy", HOUR, 403, "forbidden"),
    ("admin is not the author", None, "admin", "cy", HOUR, 403, "forbidden"),
    ("author demoted to observer", "observer", "member", "ada", HOUR, 403, "forbidden"),
    ("another member and past 24 h", "member", "member", "cy", DAY + HOUR, 403, "forbidden"),
    ("admin author", None, "admin", "ada", HOUR, 200, None),
]


def _ownership_case(as_user, db_url, board_role, ws_role, who, age):
    client = as_user("ada@example.com", "sub-ada", ws_role)
    ada = user_by_email(db_url, "ada@example.com").id
    boss = add_user(db_url, "boss@example.com")
    cy = add_user(db_url, "cy@example.com")
    members = {boss: "owner", cy: "member"}
    if board_role:
        members[ada] = board_role
    board_id = add_board(db_url, boss, "B", "workspace", members)
    list_id = add_list(db_url, board_id, "L", 1.0)
    card_id = add_card(db_url, board_id, list_id, "A", 1.0)
    author = {"ada": ada, "cy": cy}[who]
    comment_id = add_comment(db_url, card_id, author, "Old", created_at=_now() - age)
    return client, board_id, card_id, comment_id, ada


@pytest.mark.parametrize("case", OWNERSHIP, ids=[c[0] for c in OWNERSHIP])
def test_only_the_author_within_24_hours_may_edit(as_user, db_url, case):
    _id, board_role, ws_role, who, age, status, detail = case
    client, board_id, card_id, comment_id, ada = _ownership_case(
        as_user, db_url, board_role, ws_role, who, age
    )
    snapshot = state(db_url, card_id)

    response = client.patch(curl(board_id, card_id, "comments", comment_id), json={"text": "New"})

    assert response.status_code == status, response.text
    if status == 200:
        assert row_of(db_url, comment_id).text == "New"
        assert row_of(db_url, comment_id).edited_at is not None
        [recorded] = comment_events(db_url)
        assert (recorded.kind, recorded.actor_id) == ("comment.edited", ada)
    else:
        assert response.json() == {"detail": detail}
        assert state(db_url, card_id) == snapshot
        assert comment_events(db_url) == []


@pytest.mark.parametrize("case", OWNERSHIP, ids=[c[0] for c in OWNERSHIP])
def test_only_the_author_within_24_hours_may_delete(as_user, db_url, case):
    _id, board_role, ws_role, who, age, status, detail = case
    client, board_id, card_id, comment_id, ada = _ownership_case(
        as_user, db_url, board_role, ws_role, who, age
    )
    snapshot = state(db_url, card_id)

    response = client.delete(curl(board_id, card_id, "comments", comment_id))

    if status == 200:
        assert response.status_code == 204
        row = row_of(db_url, comment_id)
        assert row.deleted_at is not None and row.deleted_by == ada
        [recorded] = comment_events(db_url)
        assert (recorded.kind, recorded.actor_id) == ("comment.deleted", ada)
    else:
        assert response.status_code == 403, response.text
        assert response.json() == {"detail": detail}
        assert state(db_url, card_id) == snapshot
        assert comment_events(db_url) == []


def test_the_24_hour_edge_is_exact(as_user, db_url, monkeypatch):
    w = card_world(as_user, db_url)
    created = datetime(2026, 3, 1, 12, 0, 0)
    first = add_comment(db_url, w["card"], w["ada"], "Edge", created_at=created)
    second = add_comment(db_url, w["card"], w["ada"], "Edge", created_at=created)
    url = curl(w["board"], w["card"], "comments")

    monkeypatch.setattr(comments, "_now", lambda: created + DAY - timedelta(seconds=1))
    inside = w["client"].patch(f"{url}/{first}", json={"text": "Inside"})
    monkeypatch.setattr(comments, "_now", lambda: created + DAY)
    at_edge_edit = w["client"].patch(f"{url}/{second}", json={"text": "Edge now"})
    at_edge_delete = w["client"].delete(f"{url}/{second}")

    assert inside.status_code == 200
    assert inside.json()["editable_until"] == iso(created + DAY)
    assert at_edge_edit.status_code == 403
    assert at_edge_edit.json() == {"detail": "edit_window_closed"}
    assert at_edge_delete.status_code == 403
    assert at_edge_delete.json() == {"detail": "edit_window_closed"}
    assert row_of(db_url, second).deleted_at is None
    assert row_of(db_url, second).text == "Edge"
    assert len(comment_events(db_url)) == 1


@pytest.mark.parametrize("method", ["patch", "delete"])
def test_an_unknown_foreign_or_deleted_comment_is_not_found(as_user, db_url, method):
    w = card_world(as_user, db_url)
    other = add_card(db_url, w["board"], w["list"], "Other", 2.0)
    foreign = add_comment(db_url, other, w["ada"], "Elsewhere")
    gone = add_comment(db_url, w["card"], w["ada"], "Gone", deleted_at=_now(), deleted_by=w["ada"])
    snapshot = (state(db_url, w["card"]), state(db_url, other))

    for comment_id in (99999, foreign, gone):
        response = w["client"].request(
            method.upper(),
            curl(w["board"], w["card"], "comments", comment_id),
            json={"text": "New"} if method == "patch" else None,
        )
        assert response.status_code == 404, (comment_id, response.text)
        assert response.json() == {"detail": "comment_not_found"}

    assert (state(db_url, w["card"]), state(db_url, other)) == snapshot
    assert comment_events(db_url) == []


# ---- no-op edits -----------------------------------------------------------------


@pytest.mark.parametrize("sent", ["Same", "  Same  "])
def test_an_edit_to_the_same_text_answers_200_and_writes_no_event(as_user, db_url, sent):
    w = card_world(as_user, db_url)
    edited = _now() - timedelta(minutes=30)
    comment_id = add_comment(
        db_url, w["card"], w["ada"], "Same", created_at=_now() - HOUR, edited_at=edited
    )
    snapshot = state(db_url, w["card"])

    response = w["client"].patch(
        curl(w["board"], w["card"], "comments", comment_id), json={"text": sent}
    )

    assert response.status_code == 200
    assert response.json() == expected_comment(db_url, comment_id, editable=True)
    assert response.json()["edited_at"] == iso(edited)
    assert state(db_url, w["card"]) == snapshot
    assert comment_events(db_url) == []


def test_an_edit_sets_edited_at_and_keeps_created_at(as_user, db_url):
    w = card_world(as_user, db_url)
    created = _now() - HOUR
    comment_id = add_comment(db_url, w["card"], w["ada"], "Old", created_at=created)

    response = w["client"].patch(
        curl(w["board"], w["card"], "comments", comment_id), json={"text": "New"}
    )

    body = response.json()
    assert body["created_at"] == iso(created)
    assert body["edited_at"] is not None
    assert body["text"] == "New"


# ---- undo ------------------------------------------------------------------------


def _deleted(db_url, w, *, age, by, author="ada"):
    return add_comment(
        db_url,
        w["card"],
        w[author],
        "Gone",
        created_at=_now() - HOUR,
        edited_at=_now() - timedelta(minutes=30),
        deleted_at=_now() - timedelta(seconds=age),
        deleted_by=w[by],
    )


def test_undo_by_the_deleter_within_60_seconds_keeps_created_and_edited_times(as_user, db_url):
    w = card_world(as_user, db_url)
    comment_id = _deleted(db_url, w, age=5, by="ada")
    before = row_of(db_url, comment_id)

    response = w["client"].post(
        curl(w["board"], w["card"], "comments", comment_id, "restore"), json={}
    )

    assert response.status_code == 200
    body = response.json()
    assert body == expected_comment(db_url, comment_id, editable=True)
    row = row_of(db_url, comment_id)
    assert (row.created_at, row.edited_at, row.deleted_at, row.deleted_by) == (
        before.created_at,
        before.edited_at,
        None,
        None,
    )
    assert body["edited_at"] == iso(before.edited_at)
    [recorded] = comment_events(db_url)
    assert recorded.kind == "comment.restored"


def test_delete_then_undo_through_the_api_round_trips(as_user, db_url):
    w = card_world(as_user, db_url)
    comment_id = add_comment(db_url, w["card"], w["ada"], "Round", created_at=_now() - HOUR)
    base = curl(w["board"], w["card"], "comments", comment_id)

    deleted = w["client"].delete(base)
    restored = w["client"].post(base + "/restore", json={})

    assert deleted.status_code == 204
    assert restored.status_code == 200
    assert restored.json()["text"] == "Round"
    assert [e.kind for e in comment_events(db_url)] == ["comment.deleted", "comment.restored"]


@pytest.mark.parametrize(
    ("age", "by", "board_role"),
    [
        (61, "ada", "member"),
        (3600, "ada", "member"),
        (5, "cy", "member"),
        (5, "boss", "owner"),
        (3600, "cy", "owner"),
    ],
    ids=[
        "after 61 s",
        "after an hour",
        "another member deleted",
        "an owner deleted",
        "owner after an hour",
    ],
)
def test_undo_is_refused_after_60_seconds_or_for_someone_else(as_user, db_url, age, by, board_role):
    w = card_world(as_user, db_url, board_role)
    comment_id = _deleted(db_url, w, age=age, by=by)
    snapshot = state(db_url, w["card"])

    response = w["client"].post(
        curl(w["board"], w["card"], "comments", comment_id, "restore"), json={}
    )

    assert response.status_code == 403
    assert response.json() == {"detail": "forbidden"}
    assert state(db_url, w["card"]) == snapshot
    assert comment_events(db_url) == []


def test_undo_of_a_live_unknown_or_foreign_comment_is_not_found(as_user, db_url):
    w = card_world(as_user, db_url)
    other = add_card(db_url, w["board"], w["list"], "Other", 2.0)
    live = add_comment(db_url, w["card"], w["ada"], "Live")
    foreign = add_comment(db_url, other, w["ada"], "Gone", deleted_at=_now(), deleted_by=w["ada"])

    for comment_id in (live, 99999, foreign):
        response = w["client"].post(
            curl(w["board"], w["card"], "comments", comment_id, "restore"), json={}
        )
        assert response.status_code == 404
        assert response.json() == {"detail": "comment_not_found"}

    assert comment_events(db_url) == []


def test_undo_over_the_limit_is_refused(as_user, db_url):
    w = card_world(as_user, db_url)
    add_comments(db_url, w["card"], w["boss"], 500)
    comment_id = _deleted(db_url, w, age=5, by="ada")
    snapshot = state(db_url, w["card"])

    response = w["client"].post(
        curl(w["board"], w["card"], "comments", comment_id, "restore"), json={}
    )

    assert response.status_code == 422
    assert response.json() == {"detail": "comment_limit"}
    assert state(db_url, w["card"]) == snapshot
    assert comment_events(db_url) == []


# ---- hidden cards ----------------------------------------------------------------

ACTIONS = {
    "feed": lambda c, b, card, cid: c.get(curl(b, card, "feed")),
    "post": lambda c, b, card, cid: c.post(curl(b, card, "comments"), json={"text": "New"}),
    "edit": lambda c, b, card, cid: c.patch(curl(b, card, "comments", cid), json={"text": "New"}),
    "delete": lambda c, b, card, cid: c.delete(curl(b, card, "comments", cid)),
    "restore": lambda c, b, card, cid: c.post(curl(b, card, "comments", cid, "restore"), json={}),
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
    comment_id = 1
    for target in targets:
        comment_id = add_comment(db_url, target, w["ada"], "Hidden", created_at=_now() - HOUR)
    snapshot = {c: state(db_url, c) for c in targets}
    before = len(events(db_url))

    response = ACTIONS[action](w["client"], w["board"], card, comment_id)

    assert response.status_code == 404, response.text
    assert response.json() == {"detail": "card_not_found"}
    assert len(events(db_url)) == before
    assert {c: state(db_url, c) for c in snapshot} == snapshot


@pytest.mark.parametrize("action", list(ACTIONS))
def test_every_route_says_board_not_found_on_an_archived_board(as_user, db_url, action):
    w = card_world(as_user, db_url, "owner")
    comment_id = add_comment(db_url, w["card"], w["ada"], "Hidden", created_at=_now() - HOUR)
    set_board_columns(db_url, w["board"], archived_at=_now())
    snapshot = state(db_url, w["card"])

    response = ACTIONS[action](w["client"], w["board"], w["card"], comment_id)

    assert response.status_code == 404
    assert response.json() == {"detail": "board_not_found"}
    assert state(db_url, w["card"]) == snapshot
    assert comment_events(db_url) == []


# ---- concurrency and atomicity ---------------------------------------------------


@pytest.mark.parametrize("action", ["post", "edit", "delete", "restore"])
def test_a_card_archived_just_before_the_transaction_is_not_found(
    as_user, db_url, monkeypatch, action
):
    w = card_world(as_user, db_url)
    comment_id = add_comment(db_url, w["card"], w["ada"], "Mine", created_at=_now() - HOUR)

    def archive():
        query(
            db_url,
            lambda s: (
                s.execute(update(Card).where(Card.id == w["card"]).values(archived_at=_now())),
                s.commit(),
            ),
        )

    interfere(monkeypatch, archive, "comments")
    snapshot = state(db_url, w["card"])

    response = ACTIONS[action](w["client"], w["board"], w["card"], comment_id)

    assert response.status_code == 404
    assert response.json() == {"detail": "card_not_found"}
    assert state(db_url, w["card"]) == snapshot
    assert comment_events(db_url) == []


@pytest.mark.parametrize("action", ["post", "edit", "delete", "restore"])
def test_an_actor_demoted_just_before_the_transaction_cannot_write(
    as_user, db_url, monkeypatch, action
):
    w = card_world(as_user, db_url, "member")
    comment_id = add_comment(db_url, w["card"], w["ada"], "Mine", created_at=_now() - HOUR)

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

    interfere(monkeypatch, demote, "comments")
    snapshot = state(db_url, w["card"])

    response = ACTIONS[action](w["client"], w["board"], w["card"], comment_id)

    assert response.status_code == 403
    assert response.json() == {"detail": "forbidden"}
    assert state(db_url, w["card"]) == snapshot
    assert comment_events(db_url) == []


def test_a_comment_deleted_in_the_meantime_cannot_be_edited(as_user, db_url, monkeypatch):
    w = card_world(as_user, db_url)
    comment_id = add_comment(db_url, w["card"], w["ada"], "Racy", created_at=_now() - HOUR)

    def delete_it():
        query(
            db_url,
            lambda s: (
                s.execute(
                    update(Comment)
                    .where(Comment.id == comment_id)
                    .values(deleted_at=_now(), deleted_by=w["ada"])
                ),
                s.commit(),
            ),
        )

    interfere(monkeypatch, delete_it, "comments")

    response = w["client"].patch(
        curl(w["board"], w["card"], "comments", comment_id), json={"text": "New"}
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "comment_not_found"}
    assert row_of(db_url, comment_id).text == "Racy"
    assert comment_events(db_url) == []


def test_a_failing_event_insert_leaves_no_comment_and_no_event(as_user, db_url, monkeypatch):
    w = card_world(as_user, db_url)
    real = comments.record_change

    def boom(session, change, **kw):
        return real(session, lambda s: (change(s), 1 / 0)[0], **kw)

    monkeypatch.setattr(comments, "record_change", boom)
    with pytest.raises(ZeroDivisionError):
        w["client"].post(curl(w["board"], w["card"], "comments"), json={"text": "X"})

    assert state(db_url, w["card"]) == []
    assert comment_events(db_url) == []


def test_a_failing_event_insert_keeps_an_edited_comment_as_it_was(as_user, db_url, monkeypatch):
    w = card_world(as_user, db_url)
    comment_id = add_comment(db_url, w["card"], w["ada"], "Old", created_at=_now() - HOUR)
    real = comments.record_change

    def boom(session, change, **kw):
        return real(session, lambda s: (change(s), 1 / 0)[0], **kw)

    monkeypatch.setattr(comments, "record_change", boom)
    with pytest.raises(ZeroDivisionError):
        w["client"].patch(curl(w["board"], w["card"], "comments", comment_id), json={"text": "New"})

    assert row_of(db_url, comment_id).text == "Old"
    assert row_of(db_url, comment_id).edited_at is None
    assert comment_events(db_url) == []
