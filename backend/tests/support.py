"""Shared test helpers: a fake Google, sign-in, and direct database reads."""

import importlib
import os
import time
from datetime import UTC, datetime
from urllib.parse import parse_qs, urlparse

from sqlalchemy import insert, select, update
from sqlalchemy.orm import Session

from taskboard import auth
from taskboard.db import make_engine
from taskboard.models import (
    AuthEvent,
    Board,
    BoardList,
    BoardMember,
    Card,
    Event,
    User,
    WorkspaceMember,
)

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


def board_row(db_url, board_id):
    return query(db_url, lambda s: s.get(Board, board_id))


def set_board_columns(db_url, board_id, **values):
    def write(s):
        s.execute(update(Board).where(Board.id == board_id).values(**values))
        s.commit()

    query(db_url, write)


def add_list(db_url, board_id, name, position, *, archived_by=None, archived_at=None):
    """A list written directly (no event); returns its id."""

    def add(s):
        row = BoardList(
            board_id=board_id,
            name=name,
            position=position,
            created_by=archived_by or s.scalar(select(User.id).order_by(User.id)),
            archived_at=archived_at,
            archived_by=archived_by,
        )
        s.add(row)
        s.commit()
        return row.id

    return query(db_url, add)


def add_card(
    db_url,
    board_id,
    list_id,
    title,
    position,
    *,
    archived_at=None,
    description=None,
    due_at=None,
):
    """A card written directly (no event) that takes the board's next number; returns its id."""

    def add(s):
        board = s.get(Board, board_id)
        row = Card(
            board_id=board_id,
            list_id=list_id,
            number=board.next_card_number,
            title=title,
            description=description,
            due_at=due_at,
            position=position,
            created_by=board.created_by,
            archived_at=archived_at,
        )
        board.next_card_number += 1
        s.add(row)
        s.commit()
        return row.id

    return query(db_url, add)


def add_cards(db_url, board_id, list_id, n):
    """`n` cards bulk-inserted at the end of a list; the board's counter moves past them."""

    def add(s):
        board = s.get(Board, board_id)
        start = board.next_card_number
        now = datetime.now(UTC).replace(tzinfo=None)
        s.execute(
            insert(Card),
            [
                {
                    "board_id": board_id,
                    "list_id": list_id,
                    "number": start + i,
                    "title": f"Card {start + i}",
                    "position": float(start + i),
                    "created_by": board.created_by,
                    "created_at": now,
                }
                for i in range(n)
            ],
        )
        board.next_card_number = start + n
        s.commit()

    query(db_url, add)


def interfere(monkeypatch, action, module="boards"):
    """Run `action` (a direct database write) just before the request's transaction starts."""
    mod = importlib.import_module(f"taskboard.{module}")
    real = mod.record_change

    def hooked(session, change, **kw):
        action()
        return real(session, change, **kw)

    monkeypatch.setattr(mod, "record_change", hooked)


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
