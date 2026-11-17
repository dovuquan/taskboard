"""Members API: list, role changes, the last-admin guard and the refused sign-in feed."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from support import auth_events, events, good_claims, query, sign_in, user_by_email

from taskboard.db import make_engine
from taskboard.models import AuthEvent, User, UserSession, WorkspaceMember


@pytest.fixture
def as_user(app, oidc, db_url):
    """Factory: a new client signed in as `email`, with its workspace role set directly."""
    clients: list[TestClient] = []

    def make(email: str, sub: str, role: str = "member") -> TestClient:
        c = TestClient(app, base_url="http://localhost:8000")
        c.__enter__()
        clients.append(c)
        claims = good_claims(email=email, sub=sub, name=email.split("@")[0].title())
        assert sign_in(c, oidc, claims).headers["location"] == "/boards"

        def set_role(s: Session) -> None:
            user = s.scalars(select(User).where(User.email == email)).one()
            s.get(WorkspaceMember, user.id).role = role
            s.commit()

        query(db_url, set_role)
        return c

    yield make
    for c in clients:
        c.__exit__(None, None, None)


def user_id(db_url, email):
    return user_by_email(db_url, email).id


def role_of(db_url, uid):
    return query(db_url, lambda s: s.get(WorkspaceMember, uid).role)


def iso(dt):
    return None if dt is None else dt.isoformat() + "Z"


def member_json(db_url, email):
    def read(s):
        user = s.scalars(select(User).where(User.email == email)).one()
        member = s.get(WorkspaceMember, user.id)
        return {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "avatar_url": user.avatar_url,
            "role": member.role,
            "joined_at": iso(member.joined_at),
            "last_seen_at": iso(user.last_seen_at),
            "pending": user.google_sub is None,
        }

    return query(db_url, read)


def add_pending(db_url, email):
    def add(s):
        user = User(email=email, google_sub=None, name=None, avatar_url=None)
        s.add(user)
        s.flush()
        s.add(WorkspaceMember(user_id=user.id, role="member"))
        s.commit()

    query(db_url, add)


# ---- not signed in --------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("GET", "/api/members", None),
        ("PATCH", "/api/members/1", {"role": "admin"}),
        ("GET", "/api/auth-events/refused", None),
    ],
)
def test_members_endpoints_need_a_session(client, method, path, body):
    response = client.request(method, path, json=body)

    assert response.status_code == 401
    assert response.json() == {"detail": "not_signed_in"}


# ---- expired session and no membership ------------------------------------------


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("GET", "/api/members", None),
        ("PATCH", "/api/members/1", {"role": "admin"}),
        ("GET", "/api/auth-events/refused", None),
    ],
)
def test_members_endpoints_refuse_an_expired_session(as_user, db_url, method, path, body):
    admin = as_user("root@example.com", "sub-root", "admin")

    def expire(s):
        row = s.scalars(select(UserSession)).one()
        row.expires_at = row.created_at - timedelta(seconds=1)
        s.commit()

    query(db_url, expire)

    response = admin.request(method, path, json=body)

    assert response.status_code == 401
    assert response.json() == {"detail": "session_expired"}


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("PATCH", "/api/members/1", {"role": "admin"}),
        ("GET", "/api/auth-events/refused", None),
    ],
)
def test_a_user_without_a_workspace_membership_is_forbidden(as_user, db_url, method, path, body):
    ghost = as_user("ghost@example.com", "sub-ghost", "admin")
    ghost_id = user_id(db_url, "ghost@example.com")

    def drop(s):
        s.delete(s.get(WorkspaceMember, ghost_id))
        s.commit()

    query(db_url, drop)
    before = len(events(db_url))

    response = ghost.request(method, path, json=body)

    assert response.status_code == 403
    assert response.json() == {"detail": "forbidden"}
    assert len(events(db_url)) == before


# ---- list -----------------------------------------------------------------------


@pytest.mark.parametrize("caller_role", ["member", "admin"])
def test_any_member_lists_everyone_by_email_including_pending_users(as_user, db_url, caller_role):
    ada = as_user("ada@example.com", "sub-ada", caller_role)
    as_user("bob@example.com", "sub-bob", "admin")
    add_pending(db_url, "aaron@example.com")

    response = ada.get("/api/members")

    assert response.status_code == 200
    assert response.json() == [
        member_json(db_url, "aaron@example.com"),
        member_json(db_url, "ada@example.com"),
        member_json(db_url, "bob@example.com"),
    ]
    body = response.json()
    assert [m["pending"] for m in body] == [True, False, False]
    assert [m["role"] for m in body] == ["member", caller_role, "admin"]
    assert body[0]["joined_at"].endswith("Z") and body[0]["last_seen_at"] is None
    assert body[0]["name"] is None and body[0]["avatar_url"] is None


# ---- change role ----------------------------------------------------------------


def test_a_member_cannot_change_roles(as_user, db_url):
    ada = as_user("ada@example.com", "sub-ada")
    as_user("bob@example.com", "sub-bob")
    bob_id = user_id(db_url, "bob@example.com")
    before = len(events(db_url))

    response = ada.patch(f"/api/members/{bob_id}", json={"role": "admin"})

    assert response.status_code == 403
    assert response.json() == {"detail": "forbidden"}
    assert role_of(db_url, bob_id) == "member"
    assert len(events(db_url)) == before


def test_an_admin_promotes_a_member_and_one_event_is_written(as_user, db_url):
    admin = as_user("root@example.com", "sub-root", "admin")
    as_user("bob@example.com", "sub-bob")
    bob_id = user_id(db_url, "bob@example.com")
    admin_id = user_id(db_url, "root@example.com")
    before = len(events(db_url))

    response = admin.patch(f"/api/members/{bob_id}", json={"role": "admin"})

    assert response.status_code == 200
    assert response.json() == member_json(db_url, "bob@example.com")
    assert response.json()["role"] == "admin"
    [event] = events(db_url)[before:]
    assert event.actor_id == admin_id
    assert event.kind == "member.role_changed"
    assert event.subject_type == "user" and event.subject_id == str(bob_id)
    assert event.data == {"from": "member", "to": "admin"}


def test_an_admin_demotes_another_admin(as_user, db_url):
    admin = as_user("root@example.com", "sub-root", "admin")
    as_user("bob@example.com", "sub-bob", "admin")
    bob_id = user_id(db_url, "bob@example.com")
    admin_id = user_id(db_url, "root@example.com")
    before = len(events(db_url))

    response = admin.patch(f"/api/members/{bob_id}", json={"role": "member"})

    assert response.status_code == 200
    assert response.json() == member_json(db_url, "bob@example.com")
    assert response.json()["role"] == "member"
    [event] = events(db_url)[before:]
    assert (event.actor_id, event.kind) == (admin_id, "member.role_changed")
    assert event.subject_type == "user" and event.subject_id == str(bob_id)
    assert event.data == {"from": "admin", "to": "member"}


@pytest.mark.parametrize("role", ["member", "admin"])
def test_an_admin_cannot_change_their_own_role_even_with_a_second_admin(as_user, db_url, role):
    admin = as_user("root@example.com", "sub-root", "admin")
    as_user("bob@example.com", "sub-bob", "admin")
    admin_id = user_id(db_url, "root@example.com")
    before = len(events(db_url))

    response = admin.patch(f"/api/members/{admin_id}", json={"role": role})

    assert response.status_code == 409
    assert response.json() == {"detail": "own_role"}
    assert role_of(db_url, admin_id) == "admin"
    assert len(events(db_url)) == before


def test_the_sole_admin_cannot_demote_themselves(as_user, db_url):
    admin = as_user("root@example.com", "sub-root", "admin")
    admin_id = user_id(db_url, "root@example.com")
    before = len(events(db_url))

    response = admin.patch(f"/api/members/{admin_id}", json={"role": "member"})

    assert response.status_code == 409
    assert response.json() == {"detail": "last_admin"}
    assert role_of(db_url, admin_id) == "admin"
    assert len(events(db_url)) == before


def test_change_role_refuses_to_remove_the_last_admin(as_user, db_url):
    from taskboard.members import LastAdmin, change_role

    as_user("root@example.com", "sub-root", "admin")
    admin_id = user_id(db_url, "root@example.com")
    before = len(events(db_url))
    engine = make_engine(db_url)
    try:
        with Session(engine) as session, pytest.raises(LastAdmin):
            change_role(session, actor_id=None, user_id=admin_id, role="member")
    finally:
        engine.dispose()

    assert role_of(db_url, admin_id) == "admin"
    assert len(events(db_url)) == before


def test_the_in_transaction_recheck_refuses_to_remove_the_last_admin(as_user, db_url, monkeypatch):
    """Get past the pre-check (it sees two admins) so only the re-check can stop the change."""
    from taskboard import members
    from taskboard.members import LastAdmin, change_role

    as_user("root@example.com", "sub-root", "admin")
    admin_id = user_id(db_url, "root@example.com")
    before = len(events(db_url))
    real = members._admin_count
    calls: list[int] = []

    def fake(session):
        calls.append(1)
        return 2 if len(calls) == 1 else real(session)

    monkeypatch.setattr(members, "_admin_count", fake)
    engine = make_engine(db_url)
    try:
        with Session(engine) as session, pytest.raises(LastAdmin):
            change_role(session, actor_id=None, user_id=admin_id, role="member")
    finally:
        engine.dispose()

    assert len(calls) == 2
    assert role_of(db_url, admin_id) == "admin"
    assert len(events(db_url)) == before


def test_a_stale_cached_role_writes_no_phantom_event(as_user, db_url):
    from taskboard.members import change_role

    as_user("a@example.com", "sub-a", "admin")
    as_user("b@example.com", "sub-b", "admin")
    as_user("c@example.com", "sub-c", "admin")
    a_id, c_id = user_id(db_url, "a@example.com"), user_id(db_url, "c@example.com")
    c_before = member_json(db_url, "c@example.com")
    engine = make_engine(db_url)
    try:
        with Session(engine) as session:
            cached = session.get(WorkspaceMember, c_id)  # keep a reference: the map is weak
            assert cached.role == "admin"  # cached, now stale

            def demote(s):
                s.get(WorkspaceMember, c_id).role = "member"
                s.commit()

            query(db_url, demote)
            before = len(events(db_url))

            member = change_role(session, actor_id=a_id, user_id=c_id, role="member")

            assert member.role == "member"
    finally:
        engine.dispose()

    assert member_json(db_url, "c@example.com") == {**c_before, "role": "member"}
    assert len(events(db_url)) == before
    assert query(db_url, lambda s: s.query(WorkspaceMember).filter_by(role="admin").count()) == 2


def test_an_actor_demoted_mid_request_cannot_change_roles(as_user, db_url):
    from taskboard.members import NotAdmin, change_role

    for name in ("a", "b", "d"):
        as_user(f"{name}@example.com", f"sub-{name}", "admin")
    as_user("c@example.com", "sub-c")
    b_id, c_id = user_id(db_url, "b@example.com"), user_id(db_url, "c@example.com")
    engine = make_engine(db_url)
    try:
        with Session(engine) as session:

            def demote(s):
                # require_admin would have seen b as admin; now b is demoted
                s.get(WorkspaceMember, b_id).role = "member"
                s.commit()

            query(db_url, demote)
            before = len(events(db_url))

            with pytest.raises(NotAdmin):
                change_role(session, actor_id=b_id, user_id=c_id, role="admin")
    finally:
        engine.dispose()

    assert role_of(db_url, c_id) == "member"
    assert len(events(db_url)) == before


@pytest.mark.parametrize("bad_id", [2**70, 0])
def test_an_out_of_range_user_id_is_a_validation_error(as_user, db_url, bad_id):
    admin = as_user("root@example.com", "sub-root", "admin")
    before = len(events(db_url))

    response = admin.patch(f"/api/members/{bad_id}", json={"role": "admin"})

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert len(detail) == 1
    assert detail[0]["loc"] == ["path", "user_id"]
    assert detail[0]["type"] == ("greater_than_equal" if bad_id == 0 else "less_than_equal")
    assert len(events(db_url)) == before


def test_an_unknown_user_is_not_found(as_user, db_url):
    admin = as_user("root@example.com", "sub-root", "admin")
    before = len(events(db_url))

    response = admin.patch("/api/members/99999", json={"role": "admin"})

    assert response.status_code == 404
    assert response.json() == {"detail": "member_not_found"}
    assert len(events(db_url)) == before


def test_a_user_without_a_workspace_membership_is_not_found(as_user, db_url):
    admin = as_user("root@example.com", "sub-root", "admin")

    def add(s):
        user = User(email="ghost@example.com", google_sub="sub-ghost")
        s.add(user)
        s.commit()
        return user.id

    ghost_id = query(db_url, add)
    before = len(events(db_url))

    response = admin.patch(f"/api/members/{ghost_id}", json={"role": "admin"})

    assert response.status_code == 404
    assert response.json() == {"detail": "member_not_found"}
    assert len(events(db_url)) == before


@pytest.mark.parametrize("body", [{"role": "owner"}, {}])
def test_a_bad_role_body_is_a_validation_error(as_user, db_url, body):
    admin = as_user("root@example.com", "sub-root", "admin")
    as_user("bob@example.com", "sub-bob")
    bob_id = user_id(db_url, "bob@example.com")
    before = len(events(db_url))

    response = admin.patch(f"/api/members/{bob_id}", json=body)

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert len(detail) == 1
    assert detail[0]["loc"] == ["body", "role"]
    assert detail[0]["type"] == ("literal_error" if body else "missing")
    assert role_of(db_url, bob_id) == "member"
    assert len(events(db_url)) == before


def test_an_unchanged_role_on_another_user_succeeds_without_an_event(as_user, db_url):
    admin = as_user("root@example.com", "sub-root", "admin")
    as_user("bob@example.com", "sub-bob")
    bob_id = user_id(db_url, "bob@example.com")
    before = len(events(db_url))

    response = admin.patch(f"/api/members/{bob_id}", json={"role": "member"})

    assert response.status_code == 200
    assert response.json() == member_json(db_url, "bob@example.com")
    assert len(events(db_url)) == before


# ---- refused sign-ins -----------------------------------------------------------


def test_a_member_cannot_read_the_refused_sign_ins(as_user):
    ada = as_user("ada@example.com", "sub-ada")

    response = ada.get("/api/auth-events/refused")

    assert response.status_code == 403
    assert response.json() == {"detail": "forbidden"}


def test_an_admin_sees_refused_sign_ins_of_the_last_seven_days_newest_first(as_user, db_url):
    admin = as_user("root@example.com", "sub-root", "admin")
    now = datetime.now(UTC).replace(tzinfo=None)

    def add(s):
        s.add_all(
            [
                AuthEvent(
                    at=now - timedelta(hours=1),
                    email="a@gmail.com",
                    outcome="refused",
                    reason="missing_hd",
                ),
                AuthEvent(
                    at=now - timedelta(days=6, hours=23),
                    email="b@evil.test",
                    outcome="refused",
                    reason="wrong_domain",
                ),
                AuthEvent(
                    at=now - timedelta(days=7, minutes=1),
                    email="old@evil.test",
                    outcome="refused",
                    reason="wrong_domain",
                ),
                AuthEvent(
                    at=now - timedelta(hours=1),
                    email="ok@example.com",
                    outcome="accepted",
                    reason=None,
                ),
                AuthEvent(
                    at=now - timedelta(hours=1),
                    email=None,
                    outcome="refused",
                    reason="state_mismatch",
                ),
            ]
        )
        s.commit()

    query(db_url, add)
    assert [e.outcome for e in auth_events(db_url)].count("accepted") == 2  # sign_in's own + ours
    rows = {r.reason: r for r in auth_events(db_url) if r.email != "old@evil.test"}

    response = admin.get("/api/auth-events/refused")

    assert response.status_code == 200
    # Same `at` for the two rows at now-1h: the later id comes first.
    assert response.json() == [
        {"at": iso(rows["state_mismatch"].at), "email": None, "reason": "state_mismatch"},
        {"at": iso(rows["missing_hd"].at), "email": "a@gmail.com", "reason": "missing_hd"},
        {"at": iso(rows["wrong_domain"].at), "email": "b@evil.test", "reason": "wrong_domain"},
    ]
