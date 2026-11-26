"""Comments on a card, and the card feed that mixes them with the card's activity.

Posting needs `member` and above. Only the author may edit or delete a comment, and only for
`EDIT_WINDOW` after posting: the server is the one judge, using its own clock. Nobody moderates
someone else's comment. A delete keeps the row; the author may Undo it within `RESTORE_WINDOW`.
Every write locks the visible card first, checks the role again inside the transaction, and records
one `events` row with the change; the event never carries the comment text. A write that changes
nothing answers 200 and records nothing.

Comment text is stored as typed. It is not run through the Markdown cleaner, which would delete
harmless text that only looks like a tag. The server refuses what titles refuse (control, bidi and
zero-width format characters, separators, private-use, surrogate and unassigned characters) except
newline and tab, turns CRLF into LF and trims the ends; the web app shows it as plain text.
"""

import unicodedata
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Path, Response
from pydantic import AfterValidator, BaseModel, ConfigDict, StrictStr
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from taskboard.auth import get_db
from taskboard.boards import (
    _BAD_CATEGORIES,
    _BLANKS,
    BoardCtx,
    _iso,
    _no_invisible,
    ensure_role,
    require_board_role,
)
from taskboard.card_fields import CardId, _lock_visible_card, _NoChange, card_detail
from taskboard.events import record_change
from taskboard.lists import RESTORE_WINDOW
from taskboard.models import Card, Comment, Event, User, _now

router = APIRouter()

EDIT_WINDOW = timedelta(hours=24)
MAX_COMMENTS = 500
FEED_MAX = 200
_TEXT_MAX = 5000
_MAX_ID = 2**63 - 1

CommentId = Annotated[int, Path(ge=1, le=_MAX_ID)]

_READ = Depends(require_board_role("observer"))
_WRITE = Depends(require_board_role("member"))

# The activity the feed shows, and for each kind the only `data` keys sent on. Comment events are
# not listed: the comment row itself is the entry.
_FEED_KINDS: dict[str, tuple[str, ...]] = {
    "card.created": ("key", "title", "list_id"),
    "card.moved": ("key", "from_list_id", "to_list_id"),
    "card.copied": ("key", "from_key"),
    "card.renamed": ("key", "from", "to"),
    "card.described": ("key", "cleared"),
    "card.due_changed": ("key", "from", "to"),
    "card.member_added": ("key", "user_id"),
    "card.member_removed": ("key", "user_id"),
    "card.label_added": ("key", "label_id", "name"),
    "card.label_removed": ("key", "label_id", "name"),
    **{
        f"checklist.{kind}": ("key", "item_id", "text")
        for kind in (
            "item_added",
            "item_checked",
            "item_unchecked",
            "item_deleted",
            "item_restored",
        )
    },
}


def _clean_comment(text: str) -> str:
    text = text.replace("\r\n", "\n").strip()
    if not 1 <= len(text) <= _TEXT_MAX:
        raise ValueError(f"text must be 1 to {_TEXT_MAX} characters")
    # The same refusals as titles and names (control, format such as bidi and zero-width, separator,
    # private-use, surrogate, unassigned, blank-looking), except that newline and tab stay.
    _no_invisible(text.replace("\n", "").replace("\t", ""))
    if not any(
        unicodedata.category(ch) not in _BAD_CATEGORIES and ch not in _BLANKS and not ch.isspace()
        for ch in text
    ):
        raise ValueError("text must show something")
    return text


CommentText = Annotated[StrictStr, AfterValidator(_clean_comment)]


class _Body(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TextBody(_Body):
    text: CommentText


class RestoreBody(_Body):
    pass


def _person(user: User | None) -> dict[str, Any] | None:
    if user is None:
        return None
    return {"id": user.id, "name": user.name, "avatar_url": user.avatar_url}


def _out(row: Comment, author: User, viewer_id: int, role: str) -> dict[str, Any]:
    """The wire shape; `editable_until` only for the author, at `member` or above, while open."""
    closes = row.created_at + EDIT_WINDOW
    editable = row.author_id == viewer_id and role != "observer" and _now() < closes
    return {
        "id": row.id,
        "author": _person(author),
        "text": row.text,
        "created_at": _iso(row.created_at),
        "edited_at": _iso(row.edited_at),
        "editable_until": _iso(closes) if editable else None,
    }


def _live_count(s: Session, card_id: int) -> int:
    stmt = (
        select(func.count())
        .select_from(Comment)
        .where(Comment.card_id == card_id, Comment.deleted_at.is_(None))
    )
    return s.scalar(stmt) or 0


def _comment(s: Session, card_id: int, comment_id: int, *, deleted: bool) -> Comment:
    """The comment of this card in the wanted state, or 404 `comment_not_found`."""
    row = s.scalar(select(Comment).where(Comment.id == comment_id, Comment.card_id == card_id))
    if row is None or (row.deleted_at is not None) != deleted:
        raise HTTPException(404, "comment_not_found")
    return row


def _own_and_open(row: Comment, actor_id: int) -> None:
    """Only the author, and only inside the window; judged after the lock and the role check."""
    if row.author_id != actor_id:
        raise HTTPException(403, "forbidden")
    if _now() >= row.created_at + EDIT_WINDOW:
        raise HTTPException(403, "edit_window_closed")


def _write(
    db: Session,
    ctx: BoardCtx,
    card_id: int,
    kind: str,
    apply: Callable[[Session, str, dict[str, Any], dict[str, Any]], None],
) -> dict[str, Any]:
    """Lock, re-check the actor, let `apply` write and fill the event data and the answer."""
    board_id, actor_id, prefix = ctx.board.id, ctx.user.id, ctx.board.key_prefix
    data: dict[str, Any] = {}  # filled inside the transaction; record_change reads it afterwards
    answer: dict[str, Any] = {}

    def change(s: Session) -> None:
        _lock_visible_card(s, board_id, card_id)
        role = ensure_role(s, ctx.user, board_id, "member")
        data["key"] = f"{prefix}-{s.scalar(select(Card.number).where(Card.id == card_id))}"
        apply(s, role, data, answer)

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
        pass  # rolled back, no event; `answer` holds the current comment
    return answer


@router.post("/api/boards/{board_id}/cards/{card_id}/comments", status_code=201)
def post_comment(
    card_id: CardId, body: TextBody, ctx: BoardCtx = _WRITE, db: Session = Depends(get_db)
):
    actor_id = ctx.user.id

    def apply(s: Session, role: str, data: dict[str, Any], answer: dict[str, Any]) -> None:
        row = Comment(card_id=card_id, author_id=actor_id, text=body.text, created_at=_now())
        s.add(row)
        s.flush()
        # Insert first, then count: the lock is held, so the count is exact.
        if _live_count(s, card_id) > MAX_COMMENTS:
            raise HTTPException(422, "comment_limit")
        data["comment_id"] = row.id
        answer.update(_out(row, s.get(User, actor_id), actor_id, role))

    return _write(db, ctx, card_id, "comment.added", apply)


@router.patch("/api/boards/{board_id}/cards/{card_id}/comments/{comment_id}")
def edit_comment(
    card_id: CardId,
    comment_id: CommentId,
    body: TextBody,
    ctx: BoardCtx = _WRITE,
    db: Session = Depends(get_db),
):
    actor_id = ctx.user.id

    def apply(s: Session, role: str, data: dict[str, Any], answer: dict[str, Any]) -> None:
        row = _comment(s, card_id, comment_id, deleted=False)
        _own_and_open(row, actor_id)
        data["comment_id"] = row.id
        if row.text != body.text:
            row.text = body.text
            row.edited_at = _now()
            s.flush()
            answer.update(_out(row, s.get(User, actor_id), actor_id, role))
            return
        answer.update(_out(row, s.get(User, actor_id), actor_id, role))
        raise _NoChange

    return _write(db, ctx, card_id, "comment.edited", apply)


@router.delete("/api/boards/{board_id}/cards/{card_id}/comments/{comment_id}", status_code=204)
def delete_comment(
    card_id: CardId, comment_id: CommentId, ctx: BoardCtx = _WRITE, db: Session = Depends(get_db)
):
    actor_id = ctx.user.id

    def apply(s: Session, role: str, data: dict[str, Any], answer: dict[str, Any]) -> None:
        row = _comment(s, card_id, comment_id, deleted=False)
        _own_and_open(row, actor_id)
        data["comment_id"] = row.id
        row.deleted_at = _now()
        row.deleted_by = actor_id

    _write(db, ctx, card_id, "comment.deleted", apply)
    return Response(status_code=204)


@router.post("/api/boards/{board_id}/cards/{card_id}/comments/{comment_id}/restore")
def restore_comment(
    card_id: CardId,
    comment_id: CommentId,
    _body: RestoreBody,
    ctx: BoardCtx = _WRITE,
    db: Session = Depends(get_db),
):
    actor_id = ctx.user.id

    def apply(s: Session, role: str, data: dict[str, Any], answer: dict[str, Any]) -> None:
        row = _comment(s, card_id, comment_id, deleted=True)
        # Judged under the lock: only the deleter, and only within the window.
        if row.deleted_by != actor_id or _now() - row.deleted_at > RESTORE_WINDOW:
            raise HTTPException(403, "forbidden")
        data["comment_id"] = row.id
        row.deleted_at = None
        row.deleted_by = None
        s.flush()
        if _live_count(s, card_id) > MAX_COMMENTS:
            raise HTTPException(422, "comment_limit")
        answer.update(_out(row, s.get(User, row.author_id), actor_id, role))

    return _write(db, ctx, card_id, "comment.restored", apply)


# ---- the feed ---------------------------------------------------------------------


def _event_entry(row: Event, actor: User | None) -> dict[str, Any]:
    keep = _FEED_KINDS[row.kind]
    return {
        "type": "event",
        "id": row.id,
        "at": _iso(row.at),
        "actor": _person(actor),
        "kind": row.kind,
        "data": {k: v for k, v in (row.data or {}).items() if k in keep},
    }


@router.get("/api/boards/{board_id}/cards/{card_id}/feed")
def get_feed(card_id: CardId, ctx: BoardCtx = _READ, db: Session = Depends(get_db)):
    board_id = ctx.board.id
    card_detail(db, board_id, ctx.board.key_prefix, card_id)  # 404 `card_not_found` if hidden
    viewer_id = ctx.user.id
    comment_rows = db.execute(
        select(Comment, User)
        .join(User, User.id == Comment.author_id)
        .where(Comment.card_id == card_id, Comment.deleted_at.is_(None))
        .order_by(Comment.created_at.desc(), Comment.id.desc())
        .limit(FEED_MAX + 1)
    ).all()
    event_rows = db.execute(
        select(Event, User)
        .outerjoin(User, User.id == Event.actor_id)
        .where(
            Event.subject_type == "card",
            Event.subject_id == str(card_id),
            Event.board_id == board_id,
            Event.kind.in_(_FEED_KINDS),
        )
        .order_by(Event.at.desc(), Event.id.desc())
        .limit(FEED_MAX + 1)
    ).all()
    merged: list[tuple[tuple[datetime, int, int], dict[str, Any]]] = [
        ((row.created_at, 1, row.id), {"type": "comment", **_out(row, author, viewer_id, ctx.role)})
        for row, author in comment_rows
    ] + [((row.at, 0, row.id), _event_entry(row, actor)) for row, actor in event_rows]
    merged.sort(key=lambda pair: pair[0], reverse=True)
    return {"entries": [e for _k, e in merged[:FEED_MAX]], "more": len(merged) > FEED_MAX}


__all__ = ["EDIT_WINDOW", "MAX_COMMENTS", "router"]
