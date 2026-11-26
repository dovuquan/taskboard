"""Checklist items on a card: add, check, delete, and Undo for a delete.

Every write follows the card-field pattern: the visible card is locked first, the actor's role is
checked again inside the transaction, and one `events` row is written with the change. A write that
changes nothing answers 200 and records nothing. A delete keeps the row; only the person who
deleted it may bring it back, within `RESTORE_WINDOW`. Items are read in id order, so a restored
item keeps its place. There is no reorder and no rename.
"""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, ConfigDict, StrictBool
from sqlalchemy import func, insert, select, update
from sqlalchemy.orm import Session

from taskboard.auth import get_db
from taskboard.boards import BoardCtx, require_board_role
from taskboard.card_fields import CardId, CardTitle, _NoChange, _write
from taskboard.events import record_change
from taskboard.lists import RESTORE_WINDOW
from taskboard.models import Card, ChecklistItem, _now

router = APIRouter()

MAX_ITEMS = 100
_MAX_ID = 2**63 - 1

ItemId = Annotated[int, Path(ge=1, le=_MAX_ID)]

_WRITE = Depends(require_board_role("member"))


class _Body(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AddBody(_Body):
    text: CardTitle  # one line, 1-200 characters, no control or invisible characters


class DoneBody(_Body):
    done: StrictBool


class RestoreBody(_Body):
    pass


def _live_count(s: Session, card_id: int) -> int:
    stmt = (
        select(func.count())
        .select_from(ChecklistItem)
        .where(ChecklistItem.card_id == card_id, ChecklistItem.deleted_at.is_(None))
    )
    return s.scalar(stmt) or 0


def _item(s: Session, card: Card, item_id: int, *, deleted: bool) -> ChecklistItem:
    """The item of this card in the wanted state, or 404 `item_not_found`."""
    item = s.scalar(
        select(ChecklistItem).where(ChecklistItem.id == item_id, ChecklistItem.card_id == card.id)
    )
    if item is None or (item.deleted_at is not None) != deleted:
        raise HTTPException(404, "item_not_found")
    return item


def _data(data: dict[str, Any], item: ChecklistItem) -> None:
    data.update(item_id=item.id, text=item.text)


@router.post("/api/boards/{board_id}/cards/{card_id}/checklist", status_code=201)
def add_item(card_id: CardId, body: AddBody, ctx: BoardCtx = _WRITE, db: Session = Depends(get_db)):
    def apply(s: Session, card: Card, data: dict[str, Any]) -> None:
        result = s.execute(
            insert(ChecklistItem).values(
                card_id=card.id, text=body.text, created_by=ctx.user.id, created_at=_now()
            )
        )
        # Insert first, then count: the lock is held, so the count is exact.
        if _live_count(s, card.id) > MAX_ITEMS:
            raise HTTPException(422, "checklist_limit")
        data.update(item_id=result.inserted_primary_key[0], text=body.text)

    return _write(db, ctx, card_id, "checklist.item_added", apply, record_change)


@router.patch("/api/boards/{board_id}/cards/{card_id}/checklist/{item_id}")
def set_done(
    card_id: CardId,
    item_id: ItemId,
    body: DoneBody,
    ctx: BoardCtx = _WRITE,
    db: Session = Depends(get_db),
):
    def apply(s: Session, card: Card, data: dict[str, Any]) -> None:
        item = _item(s, card, item_id, deleted=False)
        _data(data, item)
        if item.done == body.done:
            raise _NoChange
        s.execute(update(ChecklistItem).where(ChecklistItem.id == item.id).values(done=body.done))

    kind = "checklist.item_checked" if body.done else "checklist.item_unchecked"
    return _write(db, ctx, card_id, kind, apply, record_change)


@router.delete("/api/boards/{board_id}/cards/{card_id}/checklist/{item_id}")
def delete_item(
    card_id: CardId, item_id: ItemId, ctx: BoardCtx = _WRITE, db: Session = Depends(get_db)
):
    def apply(s: Session, card: Card, data: dict[str, Any]) -> None:
        item = _item(s, card, item_id, deleted=False)
        _data(data, item)
        s.execute(
            update(ChecklistItem)
            .where(ChecklistItem.id == item.id)
            .values(deleted_at=_now(), deleted_by=ctx.user.id)
        )

    return _write(db, ctx, card_id, "checklist.item_deleted", apply, record_change)


@router.post("/api/boards/{board_id}/cards/{card_id}/checklist/{item_id}/restore")
def restore_item(
    card_id: CardId,
    item_id: ItemId,
    _body: RestoreBody,
    ctx: BoardCtx = _WRITE,
    db: Session = Depends(get_db),
):
    def apply(s: Session, card: Card, data: dict[str, Any]) -> None:
        item = _item(s, card, item_id, deleted=True)
        # Judged under the lock: only the deleter, and only within the window.
        if item.deleted_by != ctx.user.id or _now() - item.deleted_at > RESTORE_WINDOW:
            raise HTTPException(403, "forbidden")
        _data(data, item)
        s.execute(
            update(ChecklistItem)
            .where(ChecklistItem.id == item.id)
            .values(deleted_at=None, deleted_by=None)
        )
        if _live_count(s, card.id) > MAX_ITEMS:
            raise HTTPException(422, "checklist_limit")

    return _write(db, ctx, card_id, "checklist.item_restored", apply, record_change)


__all__ = ["MAX_ITEMS", "router"]
