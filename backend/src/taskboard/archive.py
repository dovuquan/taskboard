"""The Archived view of a board: archived lists and individually archived cards, newest first.

Restoring is done by the list and card routes; this module only reads. Anyone who can read the
board can read the view; only owners (and, for a minute, the archiver) can restore from it.
"""

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from taskboard.auth import get_db
from taskboard.boards import BoardCtx, _iso, require_board_role
from taskboard.models import BoardList, Card

router = APIRouter()

_READ = Depends(require_board_role("observer"))


@router.get("/api/boards/{board_id}/archived")
def get_archived(ctx: BoardCtx = _READ, db: Session = Depends(get_db)) -> dict[str, Any]:
    board_id, prefix = ctx.board.id, ctx.board.key_prefix
    # Cards a list brings back: its own cards that are not archived on their own.
    active_cards = (
        select(func.count())
        .select_from(Card)
        .where(Card.list_id == BoardList.id, Card.archived_at.is_(None))
        .scalar_subquery()
    )
    lists = db.execute(
        select(BoardList.id, BoardList.name, active_cards, BoardList.archived_at)
        .where(BoardList.board_id == board_id, BoardList.archived_at.is_not(None))
        .order_by(BoardList.archived_at.desc(), BoardList.id.desc())
    )
    cards = db.execute(
        select(Card.id, Card.number, Card.title, Card.list_id, BoardList.name, Card.archived_at)
        .join(BoardList, BoardList.id == Card.list_id)
        .where(Card.board_id == board_id, Card.archived_at.is_not(None))
        .order_by(Card.archived_at.desc(), Card.id.desc())
    )
    return {
        "lists": [
            {"id": i, "name": name, "card_count": count, "archived_at": _iso(at)}
            for i, name, count, at in lists
        ],
        "cards": [
            {
                "id": i,
                "key": f"{prefix}-{number}",
                "title": title,
                "list_id": list_id,
                "list_name": list_name,
                "archived_at": _iso(at),
            }
            for i, number, title, list_id, list_name, at in cards
        ],
    }
