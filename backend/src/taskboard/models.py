"""SQLAlchemy models for the M1 tables and the boards."""

from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    google_sub: Mapped[str | None] = mapped_column(String, unique=True)
    email: Mapped[str] = mapped_column(String, unique=True)
    name: Mapped[str | None] = mapped_column(String)
    avatar_url: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime)


class WorkspaceMember(Base):
    __tablename__ = "workspace_members"
    __table_args__ = (CheckConstraint("role IN ('admin', 'member')", name="ck_member_role"),)

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    role: Mapped[str] = mapped_column(String)
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class UserSession(Base):
    __tablename__ = "sessions"

    id_hash: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime)


class AuthEvent(Base):
    __tablename__ = "auth_events"
    __table_args__ = (
        CheckConstraint("outcome IN ('accepted', 'refused')", name="ck_auth_outcome"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    email: Mapped[str | None] = mapped_column(String)
    outcome: Mapped[str] = mapped_column(String)
    reason: Mapped[str | None] = mapped_column(String)


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    kind: Mapped[str] = mapped_column(String)
    subject_type: Mapped[str] = mapped_column(String)
    subject_id: Mapped[str] = mapped_column(String)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    # Set for events that belong to a board; a plain number, not a key, so the log outlives it.
    board_id: Mapped[int | None] = mapped_column(Integer, index=True)


class Board(Base):
    __tablename__ = "boards"
    __table_args__ = (
        CheckConstraint("visibility IN ('workspace', 'private')", name="ck_board_visibility"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    visibility: Mapped[str] = mapped_column(String)
    key_prefix: Mapped[str] = mapped_column(String, default="TB", server_default="TB")
    next_card_number: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime)


class BoardMember(Base):
    __tablename__ = "board_members"
    __table_args__ = (
        CheckConstraint("role IN ('owner', 'member', 'observer')", name="ck_board_member_role"),
    )

    board_id: Mapped[int] = mapped_column(ForeignKey("boards.id"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    role: Mapped[str] = mapped_column(String)
    added_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class BoardList(Base):
    __tablename__ = "lists"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    board_id: Mapped[int] = mapped_column(ForeignKey("boards.id"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    # Order on the board; read by (position, id) and never sent to clients.
    position: Mapped[float] = mapped_column(Float)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime)
    archived_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))


class Card(Base):
    __tablename__ = "cards"
    __table_args__ = (UniqueConstraint("board_id", "number", name="uq_cards_board_number"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    board_id: Mapped[int] = mapped_column(ForeignKey("boards.id"), index=True)
    list_id: Mapped[int] = mapped_column(ForeignKey("lists.id"), index=True)
    # The board's own running number; the key `TB-<number>` is built, never stored.
    number: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    due_at: Mapped[datetime | None] = mapped_column(DateTime)
    # Order within the list; read by (position, id) and never sent to clients.
    position: Mapped[float] = mapped_column(Float)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime)


class Label(Base):
    """One of the workspace's fixed labels; `color` is the suffix of the `--l-<color>` token."""

    __tablename__ = "labels"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, unique=True)
    color: Mapped[str] = mapped_column(String)


class CardMember(Base):
    """A person assigned to a card."""

    __tablename__ = "card_members"

    card_id: Mapped[int] = mapped_column(ForeignKey("cards.id"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True, index=True)


class CardLabel(Base):
    """A label put on a card."""

    __tablename__ = "card_labels"

    card_id: Mapped[int] = mapped_column(ForeignKey("cards.id"), primary_key=True)
    label_id: Mapped[int] = mapped_column(ForeignKey("labels.id"), primary_key=True, index=True)
