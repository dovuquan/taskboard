"""Shared test helpers: a fake Google, sign-in, and direct database reads."""

import os
import time
from urllib.parse import parse_qs, urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from taskboard import auth
from taskboard.db import make_engine
from taskboard.models import AuthEvent, Event, User

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
