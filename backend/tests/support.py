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
    CardLabel,
    CardMember,
    ChecklistItem,
    Comment,
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


def add_card_member(db_url, card_id, user_id):
    """An assignment written directly (no event)."""

    def add(s):
        s.add(CardMember(card_id=card_id, user_id=user_id))
        s.commit()

    query(db_url, add)


def add_card_label(db_url, card_id, label_id):
    """A label put on a card directly (no event)."""

    def add(s):
        s.add(CardLabel(card_id=card_id, label_id=label_id))
        s.commit()

    query(db_url, add)


def card_member_ids(db_url, card_id):
    stmt = select(CardMember.user_id).where(CardMember.card_id == card_id)
    return query(db_url, lambda s: sorted(s.scalars(stmt)))


def card_label_ids(db_url, card_id):
    stmt = select(CardLabel.label_id).where(CardLabel.card_id == card_id)
    return query(db_url, lambda s: sorted(s.scalars(stmt)))


def add_checklist_item(
    db_url, card_id, text, *, done=False, deleted_at=None, deleted_by=None, created_by=None
):
    """A checklist item written directly (no event); returns its id."""

    def add(s):
        row = ChecklistItem(
            card_id=card_id,
            text=text,
            done=done,
            created_by=created_by or s.scalar(select(User.id).order_by(User.id)),
            deleted_at=deleted_at,
            deleted_by=deleted_by,
        )
        s.add(row)
        s.commit()
        return row.id

    return query(db_url, add)


def checklist_rows(db_url, card_id):
    """Every item of the card, deleted ones too, as plain tuples in id order."""
    stmt = (
        select(
            ChecklistItem.id,
            ChecklistItem.text,
            ChecklistItem.done,
            ChecklistItem.deleted_at,
            ChecklistItem.deleted_by,
        )
        .where(ChecklistItem.card_id == card_id)
        .order_by(ChecklistItem.id)
    )
    return query(db_url, lambda s: [tuple(r) for r in s.execute(stmt)])


def add_comment(
    db_url,
    card_id,
    author_id,
    text,
    *,
    created_at=None,
    edited_at=None,
    deleted_at=None,
    deleted_by=None,
):
    """A comment written directly (no event); returns its id."""

    def add(s):
        row = Comment(
            card_id=card_id,
            author_id=author_id,
            text=text,
            edited_at=edited_at,
            deleted_at=deleted_at,
            deleted_by=deleted_by,
        )
        if created_at is not None:
            row.created_at = created_at
        s.add(row)
        s.commit()
        return row.id

    return query(db_url, add)


def comment_rows(db_url, card_id):
    """Every comment of the card, deleted ones too, as plain tuples in id order."""
    stmt = (
        select(
            Comment.id,
            Comment.author_id,
            Comment.text,
            Comment.created_at,
            Comment.edited_at,
            Comment.deleted_at,
            Comment.deleted_by,
        )
        .where(Comment.card_id == card_id)
        .order_by(Comment.id)
    )
    return query(db_url, lambda s: [tuple(r) for r in s.execute(stmt)])


def add_checklist_items(db_url, card_id, n, *, deleted=0):
    """`n` live checklist items and `deleted` deleted ones, bulk-inserted."""

    def add(s):
        user = s.scalar(select(User.id).order_by(User.id))
        now = datetime.now(UTC).replace(tzinfo=None)
        rows = [
            {
                "card_id": card_id,
                "text": f"Item {i}",
                "done": False,
                "created_by": user,
                "created_at": now,
                "deleted_at": now if i >= n else None,
                "deleted_by": user if i >= n else None,
            }
            for i in range(n + deleted)
        ]
        s.execute(insert(ChecklistItem), rows)
        s.commit()

    query(db_url, add)


def add_comments(db_url, card_id, author_id, n):
    """`n` live comments by one author, bulk-inserted."""

    def add(s):
        now = datetime.now(UTC).replace(tzinfo=None)
        rows = [
            {"card_id": card_id, "author_id": author_id, "text": f"Note {i}", "created_at": now}
            for i in range(n)
        ]
        s.execute(insert(Comment), rows)
        s.commit()

    query(db_url, add)


def curl(board_id, card_id, *rest):
    """The URL of a card (or of something under it)."""
    return "/".join(["/api/boards", str(board_id), "cards", str(card_id), *map(str, rest)])


def card_world(as_user, db_url, role="member", visibility="workspace"):
    """The actor (ada, with board role `role`), a board with one list and card TB-1, two teammates.

    Returns a dict: client, ada, boss (owner), cy (member), board, list, card.
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
