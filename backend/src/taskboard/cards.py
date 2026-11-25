"""Cards: the items in a board's lists.

A card is visible when it is not archived and its list is not archived; archiving a list hides its
cards and restoring the list brings them back. Order is a float `position` read by (position, id);
clients only ever see the order. The key (`TB-12`) is built from the board's prefix and the card's
number, never stored. Every write is one transaction with its `events` row, and takes SQLite's
write lock with its first statement; a write that finds the world changed writes nothing.
"""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StrictInt
from sqlalchemy import func, insert, select, update
from sqlalchemy.orm import Session

from taskboard.auth import get_db
from taskboard.boards import BoardCtx, ensure_role, require_board_role
from taskboard.card_fields import (
    _TITLE_MAX,
    CardId,
    CardTitle,
    copy_links,
    tile_of,
    visible_tiles,
)
from taskboard.events import record_change
from taskboard.models import Board, BoardList, Card, Event, User, _now
from taskboard.ordering import Exhausted, between, rebalance

router = APIRouter()

MAX_CARDS = 1000
_MAX_ID = 2**63 - 1
_COPY_SUFFIX = " (copy)"

_Id = Annotated[StrictInt, Field(ge=1, le=_MAX_ID)]

_READ = Depends(require_board_role("observer"))
_WRITE = Depends(require_board_role("member"))


class _Body(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CreateBody(_Body):
    list_id: _Id
    title: CardTitle


class MoveBody(_Body):
    list_id: _Id
    after_id: _Id | None
    from_list_id: _Id
    from_after_id: _Id | None


class CopyBody(_Body):
    pass


class _NoChange(Exception):
    """The card is already where the request wants it."""


class _Moved(Exception):
    """The card is not where the client last saw it; carries the 409 body."""

    def __init__(self, body: dict[str, Any]):
        self.body = body


def visible_card_count(s: Session, board_id: int) -> int:
    """Cards on the board that are not archived and whose list is not archived."""
    stmt = (
        select(func.count())
        .select_from(Card)
        .join(BoardList, BoardList.id == Card.list_id)
        .where(
            Card.board_id == board_id,
            Card.archived_at.is_(None),
            BoardList.archived_at.is_(None),
        )
    )
    return s.scalar(stmt) or 0


def _bump_counter(s: Session, board_id: int) -> None:
    """The first statement of a create or copy: it takes the write lock and a card number."""
    result = s.execute(
        update(Board)
        .where(Board.id == board_id, Board.archived_at.is_(None))
        .values(next_card_number=Board.next_card_number + 1)
    )
    if result.rowcount == 0:
        raise HTTPException(404, "board_not_found")


def _new_number(s: Session, board_id: int) -> tuple[str, int]:
    """The board's key prefix and the number the counter bump just reserved."""
    prefix, next_number = s.execute(
        select(Board.key_prefix, Board.next_card_number).where(Board.id == board_id)
    ).one()
    return prefix, next_number - 1


def _active_list(s: Session, board_id: int, list_id: int) -> BoardList:
    row = s.get(BoardList, list_id)
    if row is None or row.board_id != board_id or row.archived_at is not None:
        raise HTTPException(404, "list_not_found")
    return row


def _visible_in_list(s: Session, list_id: int) -> list[tuple[int, float]]:
    stmt = (
        select(Card.id, Card.position)
        .where(Card.list_id == list_id, Card.archived_at.is_(None))
        .order_by(Card.position, Card.id)
    )
    return [(row_id, position) for row_id, position in s.execute(stmt)]


def _position_after(s: Session, list_id: int, after_id: int | None, skip: int | None) -> float:
    """A position just after `after_id` (None: the top) among the list's visible cards."""
    for _attempt in range(2):
        rows = [(i, p) for i, p in _visible_in_list(s, list_id) if i != skip]
        if after_id is None:
            prev, nxt = None, rows[0][1] if rows else None
        else:
            at = [i for i, _ in rows].index(after_id)
            prev = rows[at][1]
            nxt = rows[at + 1][1] if at + 1 < len(rows) else None
        try:
            return between(prev, nxt)
        except Exhausted:
            rebalance(s, Card, Card.list_id == list_id)
    raise RuntimeError("renumbering left no room between two cards")


def _check_limit(s: Session, board_id: int) -> None:
    # Insert first, count after: the earlier write holds the lock, so of two requests racing for
    # the last slot the second sees 1001 and rolls back everything, counter included.
    if visible_card_count(s, board_id) > MAX_CARDS:
        raise HTTPException(422, "card_limit")


def _moved_by(s: Session, card_id: int, list_id: int, after_id: int | None) -> str | None:
    """Who moved the card, only if their latest move describes where the card is now."""
    row = s.execute(
        select(Event.actor_id, Event.data)
        .where(
            Event.kind == "card.moved",
            Event.subject_type == "card",
            Event.subject_id == str(card_id),
        )
        .order_by(Event.id.desc())
        .limit(1)
    ).first()
    if row is None:
        return None
    actor_id, data = row
    if not isinstance(data, dict):
        return None
    if data.get("to_list_id") != list_id or data.get("after_id") != after_id:
        return None
    return s.scalar(select(User.name).where(User.id == actor_id))


@router.get("/api/boards/{board_id}/cards")
def get_cards(ctx: BoardCtx = _READ, db: Session = Depends(get_db)):
    return visible_tiles(db, ctx.board.id, ctx.board.key_prefix)


@router.post("/api/boards/{board_id}/cards", status_code=201)
def create_card(body: CreateBody, ctx: BoardCtx = _WRITE, db: Session = Depends(get_db)):
    board_id, actor_id = ctx.board.id, ctx.user.id
    out: dict[str, Any] = {}
    data: dict[str, Any] = {}  # filled inside the transaction; record_change reads it afterwards

    def change(s: Session) -> int:
        _bump_counter(s, board_id)
        ensure_role(s, ctx.user, board_id, "member")
        _active_list(s, board_id, body.list_id)
        prefix, number = _new_number(s, board_id)
        end = (
            select(func.coalesce(func.max(Card.position), 0.0) + 1)
            .where(Card.list_id == body.list_id)
            .scalar_subquery()
        )
        result = s.execute(
            insert(Card).values(
                board_id=board_id,
                list_id=body.list_id,
                number=number,
                title=body.title,
                position=end,
                created_by=actor_id,
                created_at=_now(),
            )
        )
        _check_limit(s, board_id)
        card_id = result.inserted_primary_key[0]
        out.update(tile_of(s, board_id, prefix, card_id))
        data.update(key=out["key"], title=body.title, list_id=body.list_id)
        return card_id

    record_change(
        db,
        change,
        actor_id=actor_id,
        kind="card.created",
        subject_type="card",
        subject_id=lambda new_id: str(new_id),
        data=data,
        board_id=board_id,
    )
    return out


@router.post("/api/boards/{board_id}/cards/{card_id}/move")
def move_card(
    card_id: CardId, body: MoveBody, ctx: BoardCtx = _WRITE, db: Session = Depends(get_db)
):
    board_id, actor_id, prefix = ctx.board.id, ctx.user.id, ctx.board.key_prefix
    list_id, after_id = body.list_id, body.after_id
    if after_id == card_id:
        raise HTTPException(422, "invalid_anchor")
    out: dict[str, Any] = {}
    data: dict[str, Any] = {}

    def change(s: Session) -> None:
        lock = s.execute(
            update(Card)
            .where(Card.id == card_id, Card.board_id == board_id, Card.archived_at.is_(None))
            .values(id=card_id)
        )
        if lock.rowcount == 0:
            raise HTTPException(404, "card_not_found")
        ensure_role(s, ctx.user, board_id, "member")
        # Everything below reads the state the lock made current.
        card = s.get(Card, card_id)
        here = s.get(BoardList, card.list_id)
        if here.archived_at is not None:
            raise HTTPException(404, "card_not_found")
        _active_list(s, board_id, list_id)
        ids = [i for i, _ in _visible_in_list(s, card.list_id)]
        at = ids.index(card_id)
        current = (card.list_id, ids[at - 1] if at else None)
        out.update(tile_of(s, board_id, prefix, card_id))
        if current == (list_id, after_id):
            raise _NoChange
        if current != (body.from_list_id, body.from_after_id):
            raise _Moved(
                {
                    "detail": "card_moved",
                    "card": dict(out),
                    "after_id": current[1],
                    "moved_by": _moved_by(s, card_id, *current),
                }
            )
        others = [i for i, _ in _visible_in_list(s, list_id) if i != card_id]
        if after_id is not None and after_id not in others:
            raise HTTPException(409, "conflict")
        position = _position_after(s, list_id, after_id, card_id)
        s.execute(update(Card).where(Card.id == card_id).values(list_id=list_id, position=position))
        out["list_id"] = list_id
        data.update(key=out["key"], from_list_id=current[0], to_list_id=list_id, after_id=after_id)

    try:
        record_change(
            db,
            change,
            actor_id=actor_id,
            kind="card.moved",
            subject_type="card",
            subject_id=str(card_id),
            data=data,
            board_id=board_id,
        )
    except _NoChange:
        pass
    except _Moved as moved:
        return JSONResponse(status_code=409, content=moved.body)
    return out


@router.post("/api/boards/{board_id}/cards/{card_id}/copy", status_code=201)
def copy_card(
    card_id: CardId, _body: CopyBody, ctx: BoardCtx = _WRITE, db: Session = Depends(get_db)
):
    board_id, actor_id = ctx.board.id, ctx.user.id
    out: dict[str, Any] = {}
    data: dict[str, Any] = {}

    def change(s: Session) -> int:
        _bump_counter(s, board_id)
        ensure_role(s, ctx.user, board_id, "member")
        source = s.scalar(
            select(Card)
            .join(BoardList, BoardList.id == Card.list_id)
            .where(
                Card.id == card_id,
                Card.board_id == board_id,
                Card.archived_at.is_(None),
                BoardList.archived_at.is_(None),
            )
        )
        if source is None:
            raise HTTPException(404, "card_not_found")
        prefix, number = _new_number(s, board_id)
        title = source.title
        if len(title) + len(_COPY_SUFFIX) > _TITLE_MAX:
            title = title[: _TITLE_MAX - len(_COPY_SUFFIX)].rstrip()
        title += _COPY_SUFFIX
        position = _position_after(s, source.list_id, source.id, None)
        result = s.execute(
            insert(Card).values(
                board_id=board_id,
                list_id=source.list_id,
                number=number,
                title=title,
                description=source.description,
                due_at=source.due_at,
                position=position,
                created_by=actor_id,
                created_at=_now(),
            )
        )
        new_id = result.inserted_primary_key[0]
        copy_links(s, board_id, source.id, new_id)
        _check_limit(s, board_id)
        out.update(tile_of(s, board_id, prefix, new_id))
        data.update(key=out["key"], from_key=f"{prefix}-{source.number}")
        return new_id

    record_change(
        db,
        change,
        actor_id=actor_id,
        kind="card.copied",
        subject_type="card",
        subject_id=lambda new_id: str(new_id),
        data=data,
        board_id=board_id,
    )
    return out


__all__ = ["MAX_CARDS", "router", "visible_card_count"]
