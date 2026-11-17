"""Google sign-in with a fake verifier: no test calls Google."""

import hashlib
import os
import time
from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from taskboard import auth
from taskboard.app import create_app
from taskboard.db import make_engine
from taskboard.models import AuthEvent, Event, User, UserSession, WorkspaceMember

SESSION_COOKIE = "tb_session"
FLOW_COOKIE = "tb_flow"


class FakeOidc:
    """Stands in for Google: returns the claims a test chose, or raises its error."""

    def __init__(self):
        self.claims: dict = {}
        self.error: Exception | None = None
        self.exchanged: list[dict] = []

    def exchange(self, code: str, code_verifier: str, redirect_uri: str) -> str:
        self.exchanged.append({"code": code, "verifier": code_verifier, "redirect": redirect_uri})
        return "fake-id-token"

    def verify(self, id_token: str) -> dict:
        if self.error:
            raise self.error
        return dict(self.claims)


def good_claims(**overrides) -> dict:
    claims = {
        "iss": "https://accounts.google.com",
        "aud": "test-client-id",
        "exp": int(time.time()) + 3600,
        "sub": "sub-1",
        "email": "ada@example.com",
        "email_verified": True,
        "hd": "example.com",
        "name": "Ada Lovelace",
        "picture": "https://img.example.test/ada.png",
    }
    claims.update(overrides)
    return {k: v for k, v in claims.items() if v is not None}


@pytest.fixture
def oidc():
    return FakeOidc()


@pytest.fixture
def app(db_url, oidc):
    app = create_app(db_url)
    app.dependency_overrides[auth.get_oidc] = lambda: oidc
    return app


@pytest.fixture
def client(app):
    with TestClient(app, base_url="http://localhost:8000") as c:
        yield c


def query(db_url, fn):
    engine = make_engine(db_url)
    try:
        with Session(engine) as s:
            return fn(s)
    finally:
        engine.dispose()


def auth_events(db_url):
    return query(db_url, lambda s: list(s.scalars(select(AuthEvent).order_by(AuthEvent.id))))


def events(db_url):
    return query(db_url, lambda s: list(s.scalars(select(Event).order_by(Event.id))))


def user_by_email(db_url, email):
    return query(db_url, lambda s: s.scalar(select(User).where(User.email == email)))


def begin(client):
    """Call /auth/login; returns (state, nonce) as Google would receive them."""
    response = client.get("/auth/login", follow_redirects=False)
    assert response.status_code == 303
    query_string = parse_qs(urlparse(response.headers["location"]).query)
    flow = auth.read_flow(client.cookies[FLOW_COOKIE], os.environ["SESSION_SECRET"])
    assert flow is not None
    return query_string["state"][0], flow["nonce"]


def sign_in(client, oidc, claims=None, *, state=None, nonce=None, **params):
    """Run login then callback with the fake; returns the callback response."""
    real_state, real_nonce = begin(client)
    oidc.claims = good_claims(nonce=nonce or real_nonce) if claims is None else claims
    if claims is not None and "nonce" not in claims:
        oidc.claims = {**claims, "nonce": real_nonce}
    query_params = {"code": "auth-code", "state": state or real_state, **params}
    return client.get("/auth/callback", params=query_params, follow_redirects=False)


def refused_with(response, reason):
    assert response.status_code == 303
    assert response.headers["location"] == f"/signin/refused?reason={reason}"
    assert SESSION_COOKIE not in response.cookies


# ---- login redirect -------------------------------------------------------------


def test_login_redirects_to_google_with_state_nonce_and_pkce(client):
    response = client.get("/auth/login", follow_redirects=False)

    assert response.status_code == 303
    url = urlparse(response.headers["location"])
    assert url.netloc == "accounts.google.com"
    q = parse_qs(url.query)
    assert q["client_id"] == ["test-client-id"]
    assert q["redirect_uri"] == ["http://localhost:8000/auth/callback"]
    assert q["response_type"] == ["code"]
    assert q["scope"] == ["openid email profile"]
    assert q["code_challenge_method"] == ["S256"]
    assert q["state"][0] and q["nonce"][0] and q["code_challenge"][0]
    assert "hd" not in q  # the login hint is never trusted, so it is not sent either
    assert "access_type" not in q  # no refresh tokens


def test_login_sets_a_signed_short_lived_flow_cookie(client):
    response = client.get("/auth/login", follow_redirects=False)

    set_cookie = response.headers["set-cookie"].lower()
    assert "httponly" in set_cookie and "samesite=lax" in set_cookie
    assert "secure" not in set_cookie  # localhost
    value = client.cookies[FLOW_COOKIE]
    assert auth.read_flow(value, os.environ["SESSION_SECRET"]) is not None
    assert auth.read_flow(value, "another-secret-entirely") is None
    assert auth.read_flow(value + "x", os.environ["SESSION_SECRET"]) is None


def test_login_is_unavailable_without_allowed_hd(client, monkeypatch):
    monkeypatch.delenv("ALLOWED_HD")
    assert client.get("/auth/login", follow_redirects=False).status_code == 503


# ---- accepted sign-in -----------------------------------------------------------


def test_valid_token_signs_in_creates_a_member_and_redirects_to_boards(client, oidc, db_url):
    response = sign_in(client, oidc)

    assert response.status_code == 303
    assert response.headers["location"] == "/boards"
    assert oidc.exchanged[0]["redirect"] == "http://localhost:8000/auth/callback"
    assert oidc.exchanged[0]["code"] == "auth-code"
    user = user_by_email(db_url, "ada@example.com")
    assert user.google_sub == "sub-1"
    assert user.name == "Ada Lovelace"
    assert user.avatar_url == "https://img.example.test/ada.png"
    role = query(db_url, lambda s: s.get(WorkspaceMember, user.id).role)
    assert role == "member"
    [event] = auth_events(db_url)
    assert (event.outcome, event.reason, event.email) == ("accepted", None, "ada@example.com")


def test_me_returns_the_signed_in_person(client, oidc):
    sign_in(client, oidc)

    me = client.get("/api/me")

    assert me.status_code == 200
    body = me.json()
    assert body["email"] == "ada@example.com"
    assert body["name"] == "Ada Lovelace"
    assert body["role"] == "member"
    assert isinstance(body["id"], int)


def test_signing_in_creates_the_user_with_one_event(client, oidc, db_url):
    sign_in(client, oidc)

    [event] = events(db_url)
    user = user_by_email(db_url, "ada@example.com")
    assert event.kind == "member.added"
    assert event.subject_type == "user" and event.subject_id == str(user.id)
    assert event.data == {"role": "member", "pending": False}


def test_the_domain_gate_uses_hd_not_the_email_suffix(client, oidc, db_url):
    claims = good_claims(email="mallory@example.com", hd="evil.test")

    response = sign_in(client, oidc, claims)

    refused_with(response, "wrong_domain")
    assert user_by_email(db_url, "mallory@example.com") is None


def test_the_domain_comes_from_allowed_hd(client, oidc, monkeypatch):
    monkeypatch.setenv("ALLOWED_HD", "other.test")
    refused_with(sign_in(client, oidc, good_claims(hd="example.com")), "wrong_domain")
    response = sign_in(client, oidc, good_claims(hd="other.test", email="x@other.test"))
    assert response.headers["location"] == "/boards"


# ---- the refusal cases ----------------------------------------------------------


@pytest.mark.parametrize(
    ("reason", "claims", "extra"),
    [
        ("wrong_domain", good_claims(hd="evil.test"), {}),
        ("missing_hd", good_claims(hd=None, email="me@gmail.com"), {}),
        ("email_unverified", good_claims(email_verified=False), {}),
        ("wrong_aud", good_claims(aud="someone-elses-client"), {}),
        ("expired_token", good_claims(exp=int(time.time()) - 10), {}),
        ("nonce_mismatch", good_claims(nonce="not-the-nonce"), {}),
    ],
)
def test_each_refusal_shows_the_refused_page_and_logs_it(
    client, oidc, db_url, reason, claims, extra
):
    response = sign_in(client, oidc, claims, **extra)

    refused_with(response, reason)
    [event] = auth_events(db_url)
    assert event.outcome == "refused"
    assert event.reason == reason
    assert event.email == claims.get("email")
    assert query(db_url, lambda s: s.scalars(select(UserSession)).first()) is None
    assert query(db_url, lambda s: s.scalars(select(User)).first()) is None


def test_state_mismatch_is_refused_and_logged(client, oidc, db_url):
    response = sign_in(client, oidc, state="forged-state")

    refused_with(response, "state_mismatch")
    [event] = auth_events(db_url)
    assert (event.outcome, event.reason) == ("refused", "state_mismatch")
    assert oidc.exchanged == []  # the code is never exchanged on a bad state


def test_a_callback_without_a_flow_cookie_is_a_state_mismatch(client, oidc, db_url):
    response = client.get(
        "/auth/callback", params={"code": "c", "state": "s"}, follow_redirects=False
    )

    refused_with(response, "state_mismatch")
    assert [e.reason for e in auth_events(db_url)] == ["state_mismatch"]


def test_a_token_that_fails_verification_is_refused_as_bad_token(client, oidc, db_url):
    oidc.error = auth.TokenError("bad signature")

    response = sign_in(client, oidc)

    refused_with(response, "bad_token")
    assert [e.reason for e in auth_events(db_url)] == ["bad_token"]


def test_a_wrong_issuer_is_refused_as_bad_token(client, oidc, db_url):
    refused_with(sign_in(client, oidc, good_claims(iss="https://evil.test")), "bad_token")


def test_google_returning_an_error_is_refused_as_oauth_error(client, oidc, db_url):
    begin(client)

    response = client.get(
        "/auth/callback", params={"error": "access_denied"}, follow_redirects=False
    )

    refused_with(response, "oauth_error")
    assert [e.reason for e in auth_events(db_url)] == ["oauth_error"]


def test_the_callback_clears_the_flow_cookie(client, oidc, db_url):
    state, nonce = begin(client)
    oidc.claims = good_claims(nonce=nonce)
    ok = client.get("/auth/callback", params={"code": "c", "state": state}, follow_redirects=False)
    assert ok.headers["location"] == "/boards"

    again = client.get(
        "/auth/callback", params={"code": "c", "state": state}, follow_redirects=False
    )

    refused_with(again, "state_mismatch")


def test_an_email_owned_by_another_google_account_is_refused(client, oidc, db_url):
    sign_in(client, oidc, good_claims(sub="sub-1", email="ada@example.com"))
    client.cookies.clear()

    response = sign_in(client, oidc, good_claims(sub="sub-2", email="ada@example.com"))

    refused_with(response, "email_conflict")


# ---- returning and pending users ------------------------------------------------


def test_same_sub_with_a_changed_email_reaches_the_same_user_and_updates_it(client, oidc, db_url):
    sign_in(client, oidc, good_claims(sub="sub-1", email="ada@example.com"))
    first = user_by_email(db_url, "ada@example.com")
    client.cookies.clear()

    response = sign_in(client, oidc, good_claims(sub="sub-1", email="ada.l@example.com"))

    assert response.headers["location"] == "/boards"
    assert user_by_email(db_url, "ada@example.com") is None
    assert user_by_email(db_url, "ada.l@example.com").id == first.id
    kinds = [e.kind for e in events(db_url)]
    assert kinds == ["member.added", "member.email_changed"]
    assert events(db_url)[-1].data == {"from": "ada@example.com", "to": "ada.l@example.com"}


def test_a_pending_user_is_matched_by_email_and_keeps_the_admin_role(
    client, oidc, db_url, monkeypatch
):
    from taskboard import cli

    monkeypatch.setenv("TASKBOARD_DATABASE_URL", db_url)

    assert cli.main(["migrate"]) == 0
    assert cli.main(["admin", "--email", "Ada@example.com"]) == 0
    pending = user_by_email(db_url, "ada@example.com")
    assert pending.google_sub is None

    response = sign_in(client, oidc, good_claims(sub="sub-9", email="ada@example.com"))

    assert response.headers["location"] == "/boards"
    user = user_by_email(db_url, "ada@example.com")
    assert user.id == pending.id and user.google_sub == "sub-9"
    assert query(db_url, lambda s: s.get(WorkspaceMember, user.id).role) == "admin"
    assert client.get("/api/me").json()["role"] == "admin"
    assert [e.kind for e in events(db_url)] == ["member.added", "member.signed_up"]
    assert query(db_url, lambda s: len(list(s.scalars(select(User))))) == 1


def test_a_plain_repeat_sign_in_changes_nothing_but_the_session(client, oidc, db_url):
    sign_in(client, oidc)
    client.cookies.clear()

    sign_in(client, oidc)

    assert len(events(db_url)) == 1
    assert [e.outcome for e in auth_events(db_url)] == ["accepted", "accepted"]
    assert query(db_url, lambda s: len(list(s.scalars(select(UserSession))))) == 2


# ---- the session cookie ---------------------------------------------------------


def test_session_cookie_is_httponly_samesite_lax_and_only_its_hash_is_stored(client, oidc, db_url):
    response = sign_in(client, oidc)

    cookie_header = next(
        v for k, v in response.headers.multi_items() if k == "set-cookie" and SESSION_COOKIE in v
    ).lower()
    assert "httponly" in cookie_header
    assert "samesite=lax" in cookie_header
    assert "secure" not in cookie_header  # localhost
    value = client.cookies[SESSION_COOKIE]
    rows = query(db_url, lambda s: list(s.scalars(select(UserSession))))
    assert [r.id_hash for r in rows] == [hashlib.sha256(value.encode()).hexdigest()]
    assert value not in [r.id_hash for r in rows]
    assert abs(rows[0].expires_at - rows[0].created_at - timedelta(days=14)) < timedelta(seconds=5)


def test_session_cookie_is_secure_when_the_host_is_not_localhost(app, oidc):
    with TestClient(app, base_url="https://taskboard.example.test") as client:
        response = sign_in(client, oidc)

    cookie_header = next(
        v for k, v in response.headers.multi_items() if k == "set-cookie" and SESSION_COOKIE in v
    ).lower()
    assert "secure" in cookie_header


def test_logout_deletes_the_session_and_clears_the_cookie(client, oidc, db_url):
    sign_in(client, oidc)
    assert client.get("/api/me").status_code == 200

    response = client.post("/auth/logout")

    assert response.status_code == 204
    assert query(db_url, lambda s: s.scalars(select(UserSession)).first()) is None
    assert SESSION_COOKIE not in client.cookies
    assert client.get("/api/me").status_code == 401


def test_logout_without_a_session_is_harmless(client):
    assert client.post("/auth/logout").status_code == 204


def test_me_without_a_cookie_is_not_signed_in(client):
    response = client.get("/api/me")

    assert response.status_code == 401
    assert response.json() == {"detail": "not_signed_in"}


def test_me_with_an_unknown_cookie_is_not_signed_in(client):
    client.cookies.set(SESSION_COOKIE, "made-up")

    assert client.get("/api/me").json() == {"detail": "not_signed_in"}


def test_an_expired_session_is_reported_and_deleted(client, oidc, db_url):
    sign_in(client, oidc)

    def expire(s):
        row = s.scalars(select(UserSession)).one()
        row.expires_at = row.created_at - timedelta(seconds=1)
        s.commit()

    query(db_url, expire)

    response = client.get("/api/me")

    assert response.status_code == 401
    assert response.json() == {"detail": "session_expired"}
    assert query(db_url, lambda s: s.scalars(select(UserSession)).first()) is None
    assert client.get("/api/me").json() == {"detail": "not_signed_in"}


def test_a_token_endpoint_answering_with_a_non_object_is_an_oauth_error(monkeypatch):
    class Response:
        status_code = 200

        def json(self):
            return ["not", "an", "object"]

    monkeypatch.setattr(auth.httpx, "post", lambda *a, **k: Response())

    with pytest.raises(auth.TokenError):
        auth.GoogleOidc().exchange("code", "verifier", "http://localhost:8000/auth/callback")
