"""Card fields: labels, assignees, due date and description, and the card tile every route returns.

A card is visible when it is not archived and its list is not archived. Reads need any board role;
writes need `member` and above. Each write takes SQLite's write lock with a conditional UPDATE on
the visible card, then checks the actor's role again, reads, writes, and records one `events` row
in the same transaction. A write that changes nothing answers 200 and records nothing. Last save
wins: there is no version field.
"""

import re
from collections import defaultdict
from collections.abc import Callable
from datetime import date, datetime, time
from typing import Annotated, Any, Self

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    StrictStr,
    StringConstraints,
    model_validator,
)
from sqlalchemy import and_, delete, insert, literal, select, update
from sqlalchemy.orm import Session

from taskboard.auth import get_db
from taskboard.boards import (
    BoardCtx,
    UserId,
    _no_invisible,
    _workspace_member,
    ensure_role,
    require_board_role,
)
from taskboard.events import record_change
from taskboard.markdown import clean_markdown
from taskboard.models import (
    BoardList,
    BoardMember,
    Card,
    CardLabel,
    CardMember,
    Label,
)

router = APIRouter()

_MAX_ID = 2**63 - 1
_TITLE_MAX = 200
ASSIGNABLE_ROLES = ("owner", "member")

CardId = Annotated[int, Path(ge=1, le=_MAX_ID)]
LabelId = Annotated[int, Path(ge=1, le=_MAX_ID)]
CardTitle = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=_TITLE_MAX),
    AfterValidator(_no_invisible),
]

_READ = Depends(require_board_role("observer"))
_WRITE = Depends(require_board_role("member"))
_DATE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")


def _strict_date(value: Any) -> date:
    """A `YYYY-MM-DD` string that is a real calendar date; nothing else."""
    if not isinstance(value, str) or not _DATE.fullmatch(value):
        raise ValueError("due_on must be a YYYY-MM-DD string")
    return date.fromisoformat(value)


def _clean_description(text: str) -> str | None:
    return clean_markdown(text)


Description = Annotated[StrictStr, AfterValidator(_clean_description)]
DueOn = Annotated[date, BeforeValidator(_strict_date)]


class PatchBody(BaseModel):
    """Exactly one of the three fields; null clears the description or the due date."""

    model_config = ConfigDict(extra="forbid")

    title: CardTitle | None = None
    description: Description | None = None
    due_on: DueOn | None = None

    @model_validator(mode="after")
    def _exactly_one(self) -> Self:
        sent = self.model_fields_set
        if len(sent) != 1:
            raise ValueError("send exactly one of title, description, due_on")
        if "title" in sent and self.title is None:
            raise ValueError("title cannot be cleared")
        return self


class _NoChange(Exception):
    """The card already has what the request asks for."""


# ---- the tile ---------------------------------------------------------------------

_HAS_DESCRIPTION = and_(Card.description.is_not(None), Card.description != "").label(
    "has_description"
)
_TILE_COLUMNS = (Card.id, Card.number, Card.list_id, Card.title, Card.due_at, _HAS_DESCRIPTION)


def _grouped(rows) -> dict[int, list[int]]:
    groups: dict[int, list[int]] = defaultdict(list)
    for card_id, other in rows:
        groups[card_id].append(other)
    return groups


def _tiles(s: Session, board_id: int, prefix: str, rows) -> list[dict[str, Any]]:
    """Tiles for the given card rows with two grouped queries, however many cards there are.

    Assignees are only the people on this board, so no id leaks beyond what the board shows.
    """
    rows = list(rows)
    ids = [row.id for row in rows]
    labels = _grouped(
        s.execute(
            select(CardLabel.card_id, CardLabel.label_id)
            .where(CardLabel.card_id.in_(ids))
            .order_by(CardLabel.card_id, CardLabel.label_id)
        )
    )
    people = _grouped(
        s.execute(
            select(CardMember.card_id, CardMember.user_id)
            .join(
                BoardMember,
                and_(BoardMember.user_id == CardMember.user_id, BoardMember.board_id == board_id),
            )
            .where(CardMember.card_id.in_(ids))
            .order_by(CardMember.card_id, CardMember.user_id)
        )
    )
    return [
        {
            "id": row.id,
            "key": f"{prefix}-{row.number}",
            "list_id": row.list_id,
            "title": row.title,
            "label_ids": labels.get(row.id, []),
            "member_ids": people.get(row.id, []),
            "due_on": None if row.due_at is None else row.due_at.date().isoformat(),
            "has_description": bool(row.has_description),
        }
        for row in rows
    ]


def visible_tiles(s: Session, board_id: int, prefix: str) -> list[dict[str, Any]]:
    """Every visible card of the board, lists in order and cards in order within them."""
    stmt = (
        select(*_TILE_COLUMNS)
        .join(BoardList, BoardList.id == Card.list_id)
        .where(
            Card.board_id == board_id,
            Card.archived_at.is_(None),
            BoardList.archived_at.is_(None),
        )
        .order_by(BoardList.position, BoardList.id, Card.position, Card.id)
    )
    return _tiles(s, board_id, prefix, s.execute(stmt))


def tile_of(s: Session, board_id: int, prefix: str, card_id: int) -> dict[str, Any]:
    """The tile of a card that exists on the board (visible or not)."""
    stmt = select(*_TILE_COLUMNS).where(Card.id == card_id, Card.board_id == board_id)
    return _tiles(s, board_id, prefix, s.execute(stmt))[0]


def card_detail(s: Session, board_id: int, prefix: str, card_id: int) -> dict[str, Any]:
    """The tile plus the description, for a visible card; else 404 `card_not_found`."""
    stmt = (
        select(*_TILE_COLUMNS, Card.description)
        .join(BoardList, BoardList.id == Card.list_id)
        .where(
            Card.id == card_id,
            Card.board_id == board_id,
            Card.archived_at.is_(None),
            BoardList.archived_at.is_(None),
        )
    )
    row = s.execute(stmt).first()
    if row is None:
        raise HTTPException(404, "card_not_found")
    return {**_tiles(s, board_id, prefix, [row])[0], "description": row.description or None}


def copy_links(s: Session, board_id: int, source_id: int, new_id: int) -> None:
    """Give a copy the source's labels and those assignees who can still be assigned."""
    s.execute(
        insert(CardLabel).from_select(
            ["card_id", "label_id"],
            select(literal(new_id), CardLabel.label_id).where(CardLabel.card_id == source_id),
        )
    )
    s.execute(
        insert(CardMember).from_select(
            ["card_id", "user_id"],
            select(literal(new_id), CardMember.user_id)
            .join(
                BoardMember,
                and_(BoardMember.user_id == CardMember.user_id, BoardMember.board_id == board_id),
            )
            .where(CardMember.card_id == source_id, BoardMember.role.in_(ASSIGNABLE_ROLES)),
        )
    )


# ---- reads ------------------------------------------------------------------------


@router.get("/api/labels")
def list_labels(_role: str = Depends(_workspace_member), db: Session = Depends(get_db)):
    rows = db.execute(select(Label.id, Label.name, Label.color).order_by(Label.id))
    return [{"id": i, "name": name, "color": color} for i, name, color in rows]


@router.get("/api/boards/{board_id}/cards/{card_id}")
def get_card(card_id: CardId, ctx: BoardCtx = _READ, db: Session = Depends(get_db)):
    return card_detail(db, ctx.board.id, ctx.board.key_prefix, card_id)


# ---- writes -----------------------------------------------------------------------


def _lock_visible_card(s: Session, board_id: int, card_id: int) -> None:
    """The first statement of a write: it takes the write lock and proves the card is visible."""
    live_lists = select(BoardList.id).where(BoardList.archived_at.is_(None))
    result = s.execute(
        update(Card)
        .where(
            Card.id == card_id,
            Card.board_id == board_id,
            Card.archived_at.is_(None),
            Card.list_id.in_(live_lists),
        )
        .values(id=card_id)
    )
    if result.rowcount == 0:
        raise HTTPException(404, "card_not_found")


def _write(
    db: Session,
    ctx: BoardCtx,
    card_id: int,
    kind: str,
    apply: Callable[[Session, Card, dict[str, Any]], None],
) -> dict[str, Any]:
    """Lock, re-check the actor, let `apply` write and fill the event data, answer the card.

    The answer is read inside the same transaction, after `apply`, so it shows exactly what this
    request saw and wrote even if the card is archived right after the commit.
    """
    board_id, actor_id, prefix = ctx.board.id, ctx.user.id, ctx.board.key_prefix
    data: dict[str, Any] = {}  # filled inside the transaction; record_change reads it afterwards
    answer: dict[str, Any] = {}

    def change(s: Session) -> None:
        _lock_visible_card(s, board_id, card_id)
        ensure_role(s, ctx.user, board_id, "member")
        card = s.get(Card, card_id)
        data["key"] = f"{prefix}-{card.number}"
        try:
            apply(s, card, data)
        except _NoChange:
            answer.update(card_detail(s, board_id, prefix, card_id))
            raise  # still rolled back with no event; the answer was read under the same lock
        answer.update(card_detail(s, board_id, prefix, card_id))

    try:
        record_change(
            db,
            change,
            actor_id=actor_id,
            kind=kind,
            subject_type="card",
            subject_id=str(card_id),
            data=data,
            board_id=board_id,
        )
    except _NoChange:
        pass  # rolled back, no event; `answer` holds the current card
    return answer


@router.patch("/api/boards/{board_id}/cards/{card_id}")
def patch_card(
    card_id: CardId, body: PatchBody, ctx: BoardCtx = _WRITE, db: Session = Depends(get_db)
):
    [field] = body.model_fields_set

    def apply(s: Session, card: Card, data: dict[str, Any]) -> None:
        if field == "title":
            if body.title == card.title:
                raise _NoChange
            data.update({"from": card.title, "to": body.title})
            values: dict[str, Any] = {"title": body.title}
        elif field == "description":
            if body.description == (card.description or None):
                raise _NoChange
            data["cleared"] = body.description is None
            values = {"description": body.description}
        else:
            old = None if card.due_at is None else card.due_at.date()
            if body.due_on == old:
                raise _NoChange
            data.update(
                {
                    "from": None if old is None else old.isoformat(),
                    "to": None if body.due_on is None else body.due_on.isoformat(),
                }
            )
            values = {
                "due_at": None if body.due_on is None else datetime.combine(body.due_on, time())
            }
        s.execute(update(Card).where(Card.id == card.id).values(**values))

    kind = {
        "title": "card.renamed",
        "description": "card.described",
        "due_on": "card.due_changed",
    }[field]
    return _write(db, ctx, card_id, kind, apply)


@router.put("/api/boards/{board_id}/cards/{card_id}/members/{user_id}")
def assign_member(
    card_id: CardId, user_id: UserId, ctx: BoardCtx = _WRITE, db: Session = Depends(get_db)
):
    board_id = ctx.board.id

    def apply(s: Session, card: Card, data: dict[str, Any]) -> None:
        # The target's role is read after the lock, so a demotion that just committed counts.
        role = s.scalar(
            select(BoardMember.role).where(
                BoardMember.board_id == board_id, BoardMember.user_id == user_id
            )
        )
        if role not in ASSIGNABLE_ROLES:
            raise HTTPException(422, "not_assignable")
        if s.get(CardMember, (card.id, user_id)) is not None:
            raise _NoChange
        s.execute(insert(CardMember).values(card_id=card.id, user_id=user_id))
        data["user_id"] = user_id

    return _write(db, ctx, card_id, "card.member_added", apply)


@router.delete("/api/boards/{board_id}/cards/{card_id}/members/{user_id}")
def unassign_member(
    card_id: CardId, user_id: UserId, ctx: BoardCtx = _WRITE, db: Session = Depends(get_db)
):
    def apply(s: Session, card: Card, data: dict[str, Any]) -> None:
        result = s.execute(
            delete(CardMember).where(CardMember.card_id == card.id, CardMember.user_id == user_id)
        )
        if result.rowcount == 0:
            raise _NoChange
        data["user_id"] = user_id

    return _write(db, ctx, card_id, "card.member_removed", apply)


def _known_label(s: Session, label_id: int) -> Label:
    label = s.get(Label, label_id)
    if label is None:
        raise HTTPException(404, "label_not_found")
    return label


@router.put("/api/boards/{board_id}/cards/{card_id}/labels/{label_id}")
def add_label(
    card_id: CardId, label_id: LabelId, ctx: BoardCtx = _WRITE, db: Session = Depends(get_db)
):
    def apply(s: Session, card: Card, data: dict[str, Any]) -> None:
        label = _known_label(s, label_id)
        if s.get(CardLabel, (card.id, label_id)) is not None:
            raise _NoChange
        s.execute(insert(CardLabel).values(card_id=card.id, label_id=label_id))
        data.update(label_id=label_id, name=label.name)

    return _write(db, ctx, card_id, "card.label_added", apply)


@router.delete("/api/boards/{board_id}/cards/{card_id}/labels/{label_id}")
def remove_label(
    card_id: CardId, label_id: LabelId, ctx: BoardCtx = _WRITE, db: Session = Depends(get_db)
):
    def apply(s: Session, card: Card, data: dict[str, Any]) -> None:
        label = _known_label(s, label_id)
        result = s.execute(
            delete(CardLabel).where(CardLabel.card_id == card.id, CardLabel.label_id == label_id)
        )
        if result.rowcount == 0:
            raise _NoChange
        data.update(label_id=label_id, name=label.name)

    return _write(db, ctx, card_id, "card.label_removed", apply)


__all__ = ["router"]
