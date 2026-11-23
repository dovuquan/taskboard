"""Fractional positions for ordered rows: pick a position between two neighbours."""

from typing import Any

from sqlalchemy import ColumnElement, select, update
from sqlalchemy.orm import Session


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


def rebalance(session: Session, model: Any, *where: ColumnElement[bool]) -> None:
    """Renumber the `model` rows matching `where`, archived included, 1..n by (position, id).

    For lists pass `BoardList.board_id == board_id`; for cards `Card.list_id == list_id`.
    """
    ids = session.scalars(select(model.id).where(*where).order_by(model.position, model.id)).all()
    for number, row_id in enumerate(ids, start=1):
        session.execute(update(model).where(model.id == row_id).values(position=float(number)))
