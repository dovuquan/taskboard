"""The card feed: comments mixed with the card's activity, newest first."""

from datetime import timedelta

from support import (
    add_board,
    add_card,
    add_comment,
    card_world,
    curl,
    events,
    query,
    user_by_email,
)

from taskboard.models import Event, User, _now

HOUR = timedelta(hours=1)


def iso(dt):
    return None if dt is None else dt.isoformat() + "Z"


def person(db_url, user_id):
    def read(s):
        user = s.get(User, user_id)
        return {"id": user.id, "name": user.name, "avatar_url": user.avatar_url}

    return query(db_url, read)


def add_event(
    db_url, w, kind, data, *, at, actor="ada", board=None, subject_type="card", card=None
):
    """An events row written directly; returns its id."""

    def add(s):
        row = Event(
            at=at,
            actor_id=None if actor is None else w[actor],
            kind=kind,
            subject_type=subject_type,
            subject_id=str(card or w["card"]),
            data=data,
            board_id=board or w["board"],
        )
        s.add(row)
        s.commit()
        return row.id

    return query(db_url, add)


def feed(w, client=None):
    response = (client or w["client"]).get(curl(w["board"], w["card"], "feed"))
    assert response.status_code == 200, response.text
    return response.json()


def test_an_empty_card_has_an_empty_feed(as_user, db_url):
    w = card_world(as_user, db_url)

    assert feed(w) == {"entries": [], "more": False}


def test_comments_and_activity_are_merged_newest_first(as_user, db_url):
    w = card_world(as_user, db_url)
    now = _now()
    older = add_comment(db_url, w["card"], w["boss"], "Older", created_at=now - 3 * HOUR)
    created = add_event(
        db_url,
        w,
        "card.created",
        {"key": "TB-1", "title": "A", "list_id": w["list"]},
        at=now - 4 * HOUR,
        actor="boss",
    )
    moved = add_event(
        db_url,
        w,
        "card.moved",
        {"key": "TB-1", "from_list_id": 1, "to_list_id": 2, "after_id": None},
        at=now - 2 * HOUR,
        actor="cy",
    )
    newer = add_comment(db_url, w["card"], w["cy"], "Newer", created_at=now - HOUR)

    body = feed(w)

    assert [(e["type"], e["id"]) for e in body["entries"]] == [
        ("comment", newer),
        ("event", moved),
        ("comment", older),
        ("event", created),
    ]
    assert body["more"] is False
    event_entry = body["entries"][1]
    assert event_entry == {
        "type": "event",
        "id": moved,
        "at": iso(now - 2 * HOUR),
        "actor": person(db_url, w["cy"]),
        "kind": "card.moved",
        "data": {"key": "TB-1", "from_list_id": 1, "to_list_id": 2},
    }
    comment_entry = body["entries"][0]
    assert comment_entry == {
        "type": "comment",
        "id": newer,
        "author": person(db_url, w["cy"]),
        "text": "Newer",
        "created_at": iso(now - HOUR),
        "edited_at": None,
        "editable_until": None,
    }


def test_an_event_with_no_actor_has_a_null_actor(as_user, db_url):
    w = card_world(as_user, db_url)
    add_event(
        db_url, w, "card.renamed", {"key": "TB-1", "from": "a", "to": "b"}, at=_now(), actor=None
    )

    [entry] = feed(w)["entries"]

    assert entry["actor"] is None
    assert entry["data"] == {"key": "TB-1", "from": "a", "to": "b"}


def test_event_data_is_cut_to_the_allowed_keys_and_other_kinds_are_left_out(as_user, db_url):
    w = card_world(as_user, db_url)
    now = _now()
    add_event(
        db_url,
        w,
        "card.described",
        {"key": "TB-1", "cleared": False, "secret": "text", "description": "never"},
        at=now - 3 * HOUR,
    )
    add_event(db_url, w, "card.archived", {"key": "TB-1"}, at=now - 2 * HOUR)
    add_event(db_url, w, "something.else", {"key": "TB-1"}, at=now - HOUR)

    entries = feed(w)["entries"]

    assert [(e["kind"], e["data"]) for e in entries] == [
        ("card.described", {"key": "TB-1", "cleared": False})
    ]


def test_comment_events_are_not_entries_and_other_cards_and_boards_are_left_out(as_user, db_url):
    w = card_world(as_user, db_url)
    now = _now()
    mine = add_comment(db_url, w["card"], w["ada"], "Mine", created_at=now - HOUR)
    other_card = add_card(db_url, w["board"], w["list"], "Other", 2.0)
    other_board = add_board(db_url, w["boss"], "O", "workspace", {w["boss"]: "owner"})
    add_event(db_url, w, "comment.added", {"key": "TB-1", "comment_id": mine}, at=now - HOUR)
    add_event(db_url, w, "comment.edited", {"key": "TB-1", "comment_id": mine}, at=now - HOUR)
    add_event(
        db_url, w, "card.renamed", {"key": "TB-2", "from": "a", "to": "b"}, at=now, card=other_card
    )
    add_event(
        db_url,
        w,
        "card.renamed",
        {"key": "TB-1", "from": "x", "to": "y"},
        at=now,
        board=other_board,
    )
    add_event(db_url, w, "list.renamed", {"name": "n"}, at=now, subject_type="list")

    entries = feed(w)["entries"]

    assert [(e["type"], e["id"]) for e in entries] == [("comment", mine)]


def test_deleted_comments_are_not_in_the_feed(as_user, db_url):
    w = card_world(as_user, db_url)
    add_comment(db_url, w["card"], w["ada"], "Gone", deleted_at=_now(), deleted_by=w["ada"])
    kept = add_comment(db_url, w["card"], w["ada"], "Kept")

    assert [e["id"] for e in feed(w)["entries"]] == [kept]


def test_each_checklist_event_shows_in_the_feed(as_user, db_url):
    w = card_world(as_user, db_url)
    base = curl(w["board"], w["card"], "checklist")
    client = w["client"]

    item = client.post(base, json={"text": "Step"}).json()["checklist"][0]["id"]
    client.patch(f"{base}/{item}", json={"done": True})
    client.patch(f"{base}/{item}", json={"done": False})
    client.delete(f"{base}/{item}")
    client.post(f"{base}/{item}/restore", json={})

    entries = feed(w)["entries"]

    assert [e["kind"] for e in entries] == [
        "checklist.item_restored",
        "checklist.item_deleted",
        "checklist.item_unchecked",
        "checklist.item_checked",
        "checklist.item_added",
    ]
    assert all(e["type"] == "event" for e in entries)
    assert all(e["data"] == {"key": "TB-1", "item_id": item, "text": "Step"} for e in entries)
    assert all(e["actor"] == person(db_url, w["ada"]) for e in entries)


def test_activity_from_other_routes_shows_with_its_own_data(as_user, db_url):
    w = card_world(as_user, db_url)
    client = w["client"]

    client.patch(curl(w["board"], w["card"]), json={"title": "Renamed"})
    client.put(curl(w["board"], w["card"], "labels", 2))
    client.put(curl(w["board"], w["card"], "members", w["cy"]))
    client.patch(curl(w["board"], w["card"]), json={"due_on": "2026-03-09"})
    client.patch(curl(w["board"], w["card"]), json={"description": "Words"})

    entries = feed(w)["entries"]

    assert [(e["kind"], e["data"]) for e in entries] == [
        ("card.described", {"key": "TB-1", "cleared": False}),
        ("card.due_changed", {"key": "TB-1", "from": None, "to": "2026-03-09"}),
        ("card.member_added", {"key": "TB-1", "user_id": w["cy"]}),
        ("card.label_added", {"key": "TB-1", "label_id": 2, "name": "Bug"}),
        ("card.renamed", {"key": "TB-1", "from": "A", "to": "Renamed"}),
    ]


def test_a_comment_posted_through_the_api_is_one_entry_and_its_event_is_not(as_user, db_url):
    w = card_world(as_user, db_url)

    posted = (
        w["client"].post(curl(w["board"], w["card"], "comments"), json={"text": "Hello"}).json()
    )
    entries = feed(w)["entries"]

    assert entries == [{"type": "comment", **posted}]
    assert [e.kind for e in events(db_url) if e.subject_type == "card"] == ["comment.added"]


def test_the_feed_is_capped_at_200_and_says_when_there_is_more(as_user, db_url):
    w = card_world(as_user, db_url)
    base = _now() - timedelta(days=10)
    for i in range(150):
        add_comment(db_url, w["card"], w["boss"], f"c{i}", created_at=base + timedelta(minutes=i))
    for i in range(50):
        add_event(
            db_url,
            w,
            "card.renamed",
            {"key": "TB-1", "from": "a", "to": "b"},
            at=base + timedelta(minutes=200 + i),
        )

    exact = feed(w)
    add_event(
        db_url,
        w,
        "card.renamed",
        {"key": "TB-1", "from": "a", "to": "b"},
        at=base + timedelta(days=1),
    )
    over = feed(w)

    assert len(exact["entries"]) == 200 and exact["more"] is False
    assert len(over["entries"]) == 200 and over["more"] is True
    stamps = [e["at"] if e["type"] == "event" else e["created_at"] for e in over["entries"]]
    assert stamps == sorted(stamps, reverse=True)
    assert over["entries"][0]["at"] == iso(base + timedelta(days=1))
    # The oldest comment fell off the end.
    assert "c0" not in [e.get("text") for e in over["entries"]]


def test_editable_until_is_set_only_for_the_callers_own_recent_comment(as_user, db_url):
    w = card_world(as_user, db_url)
    now = _now()
    own = add_comment(db_url, w["card"], w["ada"], "Own", created_at=now - HOUR)
    old = add_comment(db_url, w["card"], w["ada"], "Old", created_at=now - timedelta(hours=25))
    theirs = add_comment(db_url, w["card"], w["cy"], "Theirs", created_at=now - HOUR)

    entries = {e["id"]: e for e in feed(w)["entries"]}

    assert entries[own]["editable_until"] == iso(now - HOUR + timedelta(hours=24))
    assert entries[old]["editable_until"] is None
    assert entries[theirs]["editable_until"] is None


def test_observers_read_the_feed_but_get_no_editable_until(as_user, db_url):
    w = card_world(as_user, db_url, "observer")
    add_comment(db_url, w["card"], w["ada"], "Own", created_at=_now() - HOUR)
    add_comment(db_url, w["card"], w["cy"], "Theirs", created_at=_now() - HOUR)

    entries = feed(w)["entries"]

    assert [e["text"] for e in entries] == ["Theirs", "Own"]
    assert [e["editable_until"] for e in entries] == [None, None]


def test_a_workspace_member_off_the_board_reads_a_workspace_board_feed_as_an_observer(
    as_user, db_url
):
    w = card_world(as_user, db_url, None)
    add_comment(db_url, w["card"], w["cy"], "Hi", created_at=_now() - HOUR)

    entries = feed(w)["entries"]

    assert [e["text"] for e in entries] == ["Hi"]
    assert entries[0]["editable_until"] is None


def test_a_workspace_admin_gets_editable_until_on_their_own_comment_only(as_user, db_url):
    w = card_world(as_user, db_url, None)
    admin = as_user("root@example.com", "sub-root", "admin")
    root = user_by_email(db_url, "root@example.com").id
    own = add_comment(db_url, w["card"], root, "Mine", created_at=_now() - HOUR)
    theirs = add_comment(db_url, w["card"], w["cy"], "Theirs", created_at=_now() - HOUR)

    entries = {e["id"]: e for e in feed(w, admin)["entries"]}

    assert entries[own]["editable_until"] is not None
    assert entries[theirs]["editable_until"] is None
