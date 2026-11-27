"""Lists: the ordered columns of a board.

Order is a float `position` read by (position, id); clients only ever see the order, never the
number. Every write is one transaction with its `events` row; a write that lost a race to another
request changes nothing and writes no event.

Cards belong to a later ticket. Archiving a list does not touch cards: they will be hidden by a
join on the list's `archived_at`, so restoring the list brings them back.
"""

from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, ConfigDict, Field, StrictInt
from sqlalchemy import func, insert, select, update
from sqlalchemy.orm import Session

from taskboard.auth import get_db
from taskboard.boards import BoardCtx, BoardName, ensure_role, require_board_role
from taskboard.cards import MAX_CARDS, visible_card_count
from taskboard.events import record_change
from taskboard.models import BoardList, _now
from taskboard.ordering import Exhausted, between, rebalance

router = APIRouter()

MAX_LISTS = 50
RESTORE_WINDOW = timedelta(seconds=60)
_MAX_ID = 2**63 - 1

ListId = Annotated[int, Path(ge=1, le=_MAX_ID)]

_READ = Depends(require_board_role("observer"))
_WRITE = Depends(require_board_role("member"))


class _Body(BaseModel):
    model_config = ConfigDict(extra="forbid")


class NameBody(_Body):
    name: BoardName


class MoveBody(_Body):
    after_id: StrictInt | None = Field(ge=1, le=_MAX_ID)


class ListLimit(Exception):
    """The board would have more than MAX_LISTS active lists."""


class ListGone(Exception):
    """The list is missing, on another board, or in the wrong archive state."""


class BadAnchor(Exception):
    """The list to move after is missing, archived, or on another board."""


class _NoChange(Exception):
    """Nothing to write: another request got there first, or the list is already in place."""


def _out(row_id: int, name: str) -> dict[str, int | str]:
    return {"id": row_id, "name": name}


def _active_count(s: Session, board_id: int) -> int:
    stmt = (
        select(func.count())
        .select_from(BoardList)
        .where(BoardList.board_id == board_id, BoardList.archived_at.is_(None))
    )
    return s.scalar(stmt) or 0


def _get(db: Session, board_id: int, list_id: int, *, archived: bool = False) -> BoardList:
    """The list on this board in the wanted archive state, or a 404 `list_not_found`."""
    row = db.get(BoardList, list_id)
    if row is None or row.board_id != board_id or (row.archived_at is not None) != archived:
        raise HTTPException(404, "list_not_found")
    return row


def _active(s: Session, board_id: int) -> list[tuple[int, float]]:
    stmt = (
        select(BoardList.id, BoardList.position)
        .where(BoardList.board_id == board_id, BoardList.archived_at.is_(None))
        .order_by(BoardList.position, BoardList.id)
    )
    return [(row_id, position) for row_id, position in s.execute(stmt)]


def _lock_active_list(s: Session, board_id: int, list_id: int, **values: object) -> None:
    """A conditional UPDATE: it takes the write lock and proves the list is still active."""
    result = s.execute(
        update(BoardList)
        .where(
            BoardList.id == list_id,
            BoardList.board_id == board_id,
            BoardList.archived_at.is_(None),
            *[getattr(BoardList, key) == old for key, old in values.items()],
        )
        .values(id=list_id)
    )
    if result.rowcount == 0:
        raise ListGone


@router.get("/api/boards/{board_id}/lists")
def get_lists(ctx: BoardCtx = _READ, db: Session = Depends(get_db)):
    return [_out(row_id, name) for row_id, name in _names(db, ctx.board.id)]


def _names(db: Session, board_id: int) -> list[tuple[int, str]]:
    stmt = (
        select(BoardList.id, BoardList.name)
        .where(BoardList.board_id == board_id, BoardList.archived_at.is_(None))
        .order_by(BoardList.position, BoardList.id)
    )
    return [(row_id, name) for row_id, name in db.execute(stmt)]


@router.post("/api/boards/{board_id}/lists", status_code=201)
def create_list(body: NameBody, ctx: BoardCtx = _WRITE, db: Session = Depends(get_db)):
    board_id, actor_id, name = ctx.board.id, ctx.user.id, body.name

    def change(s: Session) -> int:
        # Insert first, count after: the insert takes the write lock, so of two creates racing
        # for the last slot the second sees 51 and rolls back.
        end = (
            select(func.coalesce(func.max(BoardList.position), 0.0) + 1)
            .where(BoardList.board_id == board_id)
            .scalar_subquery()
        )
        result = s.execute(
            insert(BoardList).values(
                board_id=board_id,
                name=name,
                position=end,
                created_by=actor_id,
                created_at=_now(),
            )
        )
        ensure_role(s, ctx.user, board_id, "member")
        if _active_count(s, board_id) > MAX_LISTS:
            raise ListLimit
        return result.inserted_primary_key[0]

    try:
        list_id = record_change(
            db,
            change,
            actor_id=actor_id,
            kind="list.created",
            subject_type="list",
            subject_id=lambda new_id: str(new_id),
            data={"name": name},
            board_id=board_id,
        )
    except ListLimit:
        raise HTTPException(422, "list_limit") from None
    return _out(list_id, name)


@router.patch("/api/boards/{board_id}/lists/{list_id}")
def rename_list(
    list_id: ListId, body: NameBody, ctx: BoardCtx = _WRITE, db: Session = Depends(get_db)
):
    board_id, actor_id, new = ctx.board.id, ctx.user.id, body.name
    old = _get(db, board_id, list_id).name
    if old == new:
        return _out(list_id, old)

    def change(s: Session) -> None:
        _lock_active_list(s, board_id, list_id, name=old)
        ensure_role(s, ctx.user, board_id, "member")
        s.execute(update(BoardList).where(BoardList.id == list_id).values(name=new))

    try:
        record_change(
            db,
            change,
            actor_id=actor_id,
            kind="list.renamed",
            subject_type="list",
            subject_id=str(list_id),
            data={"from": old, "to": new},
            board_id=board_id,
        )
    except ListGone:
        # Renamed by someone else, or archived: answer with what is there now.
        return _out(list_id, _get(db, board_id, list_id).name)
    return _out(list_id, new)


@router.post("/api/boards/{board_id}/lists/{list_id}/move")
def move_list(
    list_id: ListId, body: MoveBody, ctx: BoardCtx = _WRITE, db: Session = Depends(get_db)
):
    board_id, actor_id, after_id = ctx.board.id, ctx.user.id, body.after_id
    if after_id == list_id:
        raise HTTPException(422, "invalid_anchor")
    _get(db, board_id, list_id)

    def change(s: Session) -> None:
        _lock_active_list(s, board_id, list_id)
        ensure_role(s, ctx.user, board_id, "member")
        # Everything below reads the state the lock made current.
        order = _active(s, board_id)
        ids = [row_id for row_id, _ in order]
        if after_id is not None and after_id not in ids:
            raise BadAnchor
        here = ids.index(list_id)
        if (ids[here - 1] if here else None) == after_id:
            raise _NoChange
        position = _position_after(s, board_id, list_id, after_id)
        s.execute(update(BoardList).where(BoardList.id == list_id).values(position=position))

    try:
        record_change(
            db,
            change,
            actor_id=actor_id,
            kind="list.moved",
            subject_type="list",
            subject_id=str(list_id),
            data={"after_id": after_id},
            board_id=board_id,
        )
    except _NoChange:
        pass
    except ListGone:
        raise HTTPException(404, "list_not_found") from None
    except BadAnchor:
        raise HTTPException(409, "conflict") from None
    return _out(list_id, _get(db, board_id, list_id).name)


def _position_after(s: Session, board_id: int, list_id: int, after_id: int | None) -> float:
    for _attempt in range(2):
        others = [(i, p) for i, p in _active(s, board_id) if i != list_id]
        if after_id is None:
            prev, nxt = None, others[0][1] if others else None
        else:
            at = [i for i, _ in others].index(after_id)
            prev = others[at][1]
            nxt = others[at + 1][1] if at + 1 < len(others) else None
        try:
            return between(prev, nxt)
        except Exhausted:
            rebalance(s, BoardList, BoardList.board_id == board_id)
    raise RuntimeError("renumbering left no room between two lists")


@router.post("/api/boards/{board_id}/lists/{list_id}/archive")
def archive_list(list_id: ListId, ctx: BoardCtx = _WRITE, db: Session = Depends(get_db)):
    board_id, actor_id = ctx.board.id, ctx.user.id
    _get(db, board_id, list_id)
    data: dict[str, str] = {}  # filled inside the transaction; record_change reads it afterwards

    def change(s: Session) -> str:
        _lock_active_list(s, board_id, list_id)
        ensure_role(s, ctx.user, board_id, "member")
        # The name as of the lock, not as of the earlier read: a rename may have committed since.
        name = s.scalar(select(BoardList.name).where(BoardList.id == list_id))
        s.execute(
            update(BoardList)
            .where(BoardList.id == list_id)
            .values(archived_at=_now(), archived_by=actor_id)
        )
        data["name"] = name
        return name

    try:
        name = record_change(
            db,
            change,
            actor_id=actor_id,
            kind="list.archived",
            subject_type="list",
            subject_id=str(list_id),
            data=data,
            board_id=board_id,
        )
    except ListGone:
        raise HTTPException(404, "list_not_found") from None
    return _out(list_id, name)


@router.post("/api/boards/{board_id}/lists/{list_id}/restore")
def restore_list(list_id: ListId, ctx: BoardCtx = _WRITE, db: Session = Depends(get_db)):
    board_id, actor_id = ctx.board.id, ctx.user.id
    row = _get(db, board_id, list_id, archived=True)
    name, archived_at, archived_by = row.name, row.archived_at, row.archived_by
    if ctx.role != "owner":
        recent = _now() - archived_at <= RESTORE_WINDOW
        if archived_by != actor_id or not recent:
            raise HTTPException(403, "forbidden")

    def change(s: Session) -> None:
        result = s.execute(
            update(BoardList)
            .where(
                BoardList.id == list_id,
                BoardList.board_id == board_id,
                BoardList.archived_at == archived_at,
            )
            .values(archived_at=None, archived_by=None)
        )
        if result.rowcount == 0:
            raise ListGone
        # The role may have changed since the dependency ran; the window applies to non-owners.
        role = ensure_role(s, ctx.user, board_id, "member")
        if role != "owner" and (archived_by != actor_id or _now() - archived_at > RESTORE_WINDOW):
            raise HTTPException(403, "forbidden")
        if _active_count(s, board_id) > MAX_LISTS:
            raise ListLimit
        # The restored list brings its cards back: the board's visible total must still fit.
        if visible_card_count(s, board_id) > MAX_CARDS:
            raise HTTPException(422, "card_limit")

    try:
        record_change(
            db,
            change,
            actor_id=actor_id,
            kind="list.restored",
            subject_type="list",
            subject_id=str(list_id),
            data={"name": name},
            board_id=board_id,
        )
    except ListGone:
        raise HTTPException(404, "list_not_found") from None
    except ListLimit:
        raise HTTPException(422, "list_limit") from None
    return _out(list_id, name)
