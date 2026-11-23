"""Fractional positions for ordered rows: pick a position between two neighbours."""

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from taskboard.models import BoardList


class Exhausted(Exception):
    """No float lies strictly between the neighbours; renumber and try again."""


def between(prev: float | None, next_: float | None) -> float:
    """A position after `prev` and before `next_` (None means the start or the end)."""
    if prev is None and next_ is None:
        return 1.0
    if next_ is None:
        return prev + 1
    if prev is None:
        return next_ - 1
    mid = (prev + next_) / 2
    if not prev < mid < next_:
        raise Exhausted
    return mid


def rebalance(session: Session, board_id: int) -> None:
    """Renumber all of the board's lists, archived included, 1..n in (position, id) order."""
    ids = session.scalars(
        select(BoardList.id)
        .where(BoardList.board_id == board_id)
        .order_by(BoardList.position, BoardList.id)
    ).all()
    for number, list_id in enumerate(ids, start=1):
        session.execute(
            update(BoardList).where(BoardList.id == list_id).values(position=float(number))
        )
