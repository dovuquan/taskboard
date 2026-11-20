"""Boards: the list, visibility, board roles, members, and ownerless boards.

Effective board role: the person's own row, or `owner` for a workspace admin. On a Workspace
board anyone else is an `observer`; a Private board is a 404 for anyone not on it, admins too.
A workspace admin acting as owner is not an owner row, so the last-owner rules ignore them.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import case, delete, exists, func, insert, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from taskboard.auth import current_user, get_db, require_admin
from taskboard.events import record_change
from taskboard.models import Board, BoardMember, Event, User, WorkspaceMember

router = APIRouter()

TILE_MEMBERS = 4
_RANK = {"observer": 0, "member": 1, "owner": 2}
_MAX_ID = 2**63 - 1

BoardId = Annotated[int, Path(ge=1, le=_MAX_ID)]
UserId = Annotated[int, Path(ge=1, le=_MAX_ID)]
BoardName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
Visibility = Literal["workspace", "private"]
BoardRole = Literal["owner", "member", "observer"]


class _Body(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CreateBody(_Body):
    name: BoardName
    visibility: Visibility = "workspace"


class PatchBody(_Body):
    name: BoardName | None = None
    visibility: Visibility | None = None


class AddMemberBody(_Body):
    user_id: int = Field(ge=1, le=_MAX_ID)


class RoleBody(_Body):
    role: BoardRole


class LastOwner(Exception):
    """The change would leave the board without an owner."""


class HasOwner(Exception):
    """The board already has an owner."""


class NotOwner(Exception):
    """The acting user is no longer an owner (or admin) of the board."""


class _AlreadyChanged(Exception):
    """Another request changed this row first; nothing was written."""


@dataclass
class BoardCtx:
    board: Board
    user: User
    role: str


def _iso(dt: datetime | None) -> str | None:
    return None if dt is None else dt.isoformat() + "Z"


def _workspace_role(db: Session, user: User) -> str:
    member = db.get(WorkspaceMember, user.id)
    if member is None:
        raise HTTPException(403, "forbidden")
    return member.role


def board_access(db: Session, user: User, board_id: int) -> str:
    """The person's effective role on the board, or a 404 `board_not_found`."""
    board = db.get(Board, board_id)
    if board is None or board.archived_at is not None:
        raise HTTPException(404, "board_not_found")
    is_admin = _workspace_role(db, user) == "admin"
    row_role = _row_role(db, board_id, user.id)
    if row_role is not None:
        return "owner" if is_admin else row_role
    if board.visibility == "workspace":
        return "owner" if is_admin else "observer"
    raise HTTPException(404, "board_not_found")


def require_board_role(min_role: str):
    """A dependency: the board and caller role; 404, or 403 `forbidden` below `min_role`."""

    def dependency(
        board_id: BoardId, user: User = Depends(current_user), db: Session = Depends(get_db)
    ) -> BoardCtx:
        role = board_access(db, user, board_id)
        if _RANK[role] < _RANK[min_role]:
            raise HTTPException(403, "forbidden")
        return BoardCtx(db.get(Board, board_id), user, role)

    return dependency


_OWNER = Depends(require_board_role("owner"))


def _row_role(db: Session, board_id: int, user_id: int) -> str | None:
    return db.scalar(
        select(BoardMember.role).where(
            BoardMember.board_id == board_id, BoardMember.user_id == user_id
        )
    )


def _owner_count(db: Session, board_id: int) -> int:
    stmt = (
        select(func.count())
        .select_from(BoardMember)
        .where(BoardMember.board_id == board_id, BoardMember.role == "owner")
    )
    return db.scalar(stmt) or 0


def _ensure_acting_owner(
    s: Session, actor_id: int, board_id: int, own_row_was: str | None = None
) -> None:
    """Inside the transaction, after the write lock is taken: the actor may still act as owner.

    `own_row_was` is set when the change just rewrote the actor's own row: its conditional
    UPDATE or DELETE matched, so that was the actor's role a moment ago.
    """
    if own_row_was == "owner" or _row_role(s, board_id, actor_id) == "owner":
        return
    ws = s.scalar(select(WorkspaceMember.role).where(WorkspaceMember.user_id == actor_id))
    if ws != "admin":
        raise NotOwner


_ORDER = (
    case((BoardMember.role == "owner", 0), (BoardMember.role == "member", 1), else_=2),
    User.email,
)


def _person(user: User) -> dict[str, Any]:
    return {"id": user.id, "name": user.name, "email": user.email, "avatar_url": user.avatar_url}


def _member_out(user: User, member: BoardMember) -> dict[str, Any]:
    return {
        **_person(user),
        "role": member.role,
        "added_at": _iso(member.added_at),
        "pending": user.google_sub is None,
    }


def _tile(db: Session, board: Board, my_role: str | None) -> dict[str, Any]:
    people = db.scalars(
        select(User)
        .join(BoardMember, BoardMember.user_id == User.id)
        .where(BoardMember.board_id == board.id)
        .order_by(*_ORDER)
        .limit(TILE_MEMBERS)
    ).all()
    count = db.scalar(
        select(func.count()).select_from(BoardMember).where(BoardMember.board_id == board.id)
    )
    latest = db.scalar(select(func.max(Event.at)).where(Event.board_id == board.id))
    return {
        "id": board.id,
        "name": board.name,
        "visibility": board.visibility,
        "my_role": my_role,
        "member_count": count or 0,
        "members": [_person(p) for p in people],
        "updated_at": _iso(latest or board.created_at),
    }


def _detail(db: Session, board_id: int, my_role: str) -> dict[str, Any]:
    """The board as the caller saw it when the request began (a change may hide it from them)."""
    board = db.get(Board, board_id)
    db.refresh(board)
    return {**_tile(db, board, my_role), "created_at": _iso(board.created_at)}


def _members(db: Session, board_id: int) -> list[dict[str, Any]]:
    rows = db.execute(
        select(User, BoardMember)
        .join(BoardMember, BoardMember.user_id == User.id)
        .where(BoardMember.board_id == board_id)
        .order_by(*_ORDER)
    ).all()
    return [_member_out(user, member) for user, member in rows]


def _one_member(db: Session, board_id: int, user_id: int) -> dict[str, Any]:
    user = db.get(User, user_id)
    member = db.get(BoardMember, (board_id, user_id))
    db.refresh(member)
    return _member_out(user, member)


def _workspace_member(user: User = Depends(current_user), db: Session = Depends(get_db)) -> str:
    return _workspace_role(db, user)


# ---- list, ownerless, create, detail ----------------------------------------------


@router.get("/api/boards")
def list_boards(
    user: User = Depends(current_user),
    ws_role: str = Depends(_workspace_member),
    db: Session = Depends(get_db),
):
    mine = select(BoardMember.board_id).where(BoardMember.user_id == user.id)
    boards = db.scalars(
        select(Board)
        .where(
            Board.archived_at.is_(None),
            or_(Board.visibility == "workspace", Board.id.in_(mine)),
        )
        .order_by(Board.id)
    ).all()
    tiles = []
    for board in boards:
        row_role = _row_role(db, board.id, user.id)
        role = "owner" if ws_role == "admin" else row_role or "observer"
        tiles.append(_tile(db, board, role))
    return tiles


@router.get("/api/boards/ownerless")
def ownerless_boards(_admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    has_owner = exists().where(BoardMember.board_id == Board.id, BoardMember.role == "owner")
    boards = db.scalars(
        select(Board)
        .where(Board.visibility == "private", Board.archived_at.is_(None), ~has_owner)
        .order_by(Board.id)
    ).all()
    return [_tile(db, board, None) for board in boards]


@router.post("/api/boards", status_code=201)
def create_board(
    body: CreateBody,
    user: User = Depends(current_user),
    _ws_role: str = Depends(_workspace_member),
    db: Session = Depends(get_db),
):
    actor_id = user.id

    def change(s: Session) -> int:
        board = Board(name=body.name, visibility=body.visibility, created_by=actor_id)
        s.add(board)
        s.flush()
        s.add(BoardMember(board_id=board.id, user_id=actor_id, role="owner"))
        return board.id

    board_id = record_change(
        db,
        change,
        actor_id=actor_id,
        kind="board.created",
        subject_type="board",
        subject_id=lambda new_id: str(new_id),
        data={"name": body.name, "visibility": body.visibility},
        board_id=lambda new_id: new_id,
    )
    return _detail(db, board_id, "owner")


@router.get("/api/boards/{board_id}")
def get_board(board_id: BoardId, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _detail(db, board_id, board_access(db, user, board_id))


# ---- rename and visibility --------------------------------------------------------


def _update_board(
    db: Session, ctx: BoardCtx, *, column: str, old: str, new: str, kind: str
) -> None:
    board_id, actor_id = ctx.board.id, ctx.user.id

    def change(s: Session) -> None:
        s.execute(update(Board).where(Board.id == board_id).values({column: new}))
        _ensure_acting_owner(s, actor_id, board_id)

    record_change(
        db,
        change,
        actor_id=actor_id,
        kind=kind,
        subject_type="board",
        subject_id=str(board_id),
        data={"from": old, "to": new},
        board_id=board_id,
    )


@router.patch("/api/boards/{board_id}")
def patch_board(
    body: PatchBody,
    ctx: BoardCtx = _OWNER,
    db: Session = Depends(get_db),
):
    board_id = ctx.board.id
    old_name, old_visibility = ctx.board.name, ctx.board.visibility
    try:
        if body.name is not None and body.name != old_name:
            _update_board(db, ctx, column="name", old=old_name, new=body.name, kind="board.renamed")
        if body.visibility is not None and body.visibility != old_visibility:
            _update_board(
                db,
                ctx,
                column="visibility",
                old=old_visibility,
                new=body.visibility,
                kind="board.visibility_changed",
            )
    except NotOwner:
        raise HTTPException(403, "forbidden") from None
    return _detail(db, board_id, ctx.role)


# ---- members ----------------------------------------------------------------------


@router.get("/api/boards/{board_id}/members")
def list_board_members(
    board_id: BoardId, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    board_access(db, user, board_id)
    return _members(db, board_id)


@router.post("/api/boards/{board_id}/members", status_code=201)
def add_board_member(
    body: AddMemberBody,
    ctx: BoardCtx = _OWNER,
    db: Session = Depends(get_db),
):
    board_id, actor_id, target_id = ctx.board.id, ctx.user.id, body.user_id
    if db.get(WorkspaceMember, target_id) is None:
        raise HTTPException(404, "member_not_found")
    if _row_role(db, board_id, target_id) is not None:
        raise HTTPException(409, "already_member")

    def change(s: Session) -> None:
        s.add(BoardMember(board_id=board_id, user_id=target_id, role="member"))
        s.flush()
        _ensure_acting_owner(s, actor_id, board_id)

    try:
        record_change(
            db,
            change,
            actor_id=actor_id,
            kind="board_member.added",
            subject_type="board",
            subject_id=str(board_id),
            data={"user_id": target_id, "role": "member"},
            board_id=board_id,
        )
    except IntegrityError:
        raise HTTPException(409, "already_member") from None
    except NotOwner:
        raise HTTPException(403, "forbidden") from None
    return _one_member(db, board_id, target_id)


@router.patch("/api/boards/{board_id}/members/{user_id}")
def change_board_role(
    user_id: UserId,
    body: RoleBody,
    ctx: BoardCtx = _OWNER,
    db: Session = Depends(get_db),
):
    board_id, actor_id, role = ctx.board.id, ctx.user.id, body.role
    old = _row_role(db, board_id, user_id)
    if old is None:
        raise HTTPException(404, "member_not_found")
    if old == role:
        return _one_member(db, board_id, user_id)
    if old == "owner" and _owner_count(db, board_id) == 1:
        raise HTTPException(409, "last_owner")

    def change(s: Session) -> None:
        # The conditional UPDATE takes SQLite's write lock, so what follows sees committed state.
        result = s.execute(
            update(BoardMember)
            .where(
                BoardMember.board_id == board_id,
                BoardMember.user_id == user_id,
                BoardMember.role == old,
            )
            .values(role=role)
        )
        if result.rowcount == 0:
            raise _AlreadyChanged
        _ensure_acting_owner(
            s, actor_id, board_id, own_row_was=old if actor_id == user_id else None
        )
        if _owner_count(s, board_id) == 0:
            raise LastOwner

    try:
        record_change(
            db,
            change,
            actor_id=actor_id,
            kind="board_member.role_changed",
            subject_type="board",
            subject_id=str(board_id),
            data={"user_id": user_id, "from": old, "to": role},
            board_id=board_id,
        )
    except _AlreadyChanged:
        pass  # rolled back, no event; answer with the current state
    except LastOwner:
        raise HTTPException(409, "last_owner") from None
    except NotOwner:
        raise HTTPException(403, "forbidden") from None
    if _row_role(db, board_id, user_id) is None:
        raise HTTPException(404, "member_not_found")
    return _one_member(db, board_id, user_id)


@router.delete("/api/boards/{board_id}/members/{user_id}", status_code=204)
def remove_board_member(
    user_id: UserId,
    ctx: BoardCtx = _OWNER,
    db: Session = Depends(get_db),
):
    board_id, actor_id = ctx.board.id, ctx.user.id
    for _attempt in range(3):
        old = _row_role(db, board_id, user_id)
        if old is None:
            raise HTTPException(404, "member_not_found")
        if old == "owner" and _owner_count(db, board_id) == 1:
            raise HTTPException(409, "last_owner")

        def change(s: Session, old: str = old) -> None:
            result = s.execute(
                delete(BoardMember).where(
                    BoardMember.board_id == board_id,
                    BoardMember.user_id == user_id,
                    BoardMember.role == old,
                )
            )
            if result.rowcount == 0:
                raise _AlreadyChanged
            _ensure_acting_owner(
                s, actor_id, board_id, own_row_was=old if actor_id == user_id else None
            )
            if _owner_count(s, board_id) == 0:
                raise LastOwner

        try:
            record_change(
                db,
                change,
                actor_id=actor_id,
                kind="board_member.removed",
                subject_type="board",
                subject_id=str(board_id),
                data={"user_id": user_id, "role": old},
                board_id=board_id,
            )
        except _AlreadyChanged:
            continue  # the row changed under us; read it again
        except LastOwner:
            raise HTTPException(409, "last_owner") from None
        except NotOwner:
            raise HTTPException(403, "forbidden") from None
        return Response(status_code=204)
    raise HTTPException(409, "conflict")


# ---- take ownership ---------------------------------------------------------------


@router.post("/api/boards/{board_id}/take-ownership")
def take_ownership(
    board_id: BoardId, admin: User = Depends(require_admin), db: Session = Depends(get_db)
):
    board = db.get(Board, board_id)
    if board is None or board.archived_at is not None:
        raise HTTPException(404, "board_not_found")
    if board.visibility != "private" or _owner_count(db, board_id) > 0:
        raise HTTPException(409, "has_owner")
    admin_id = admin.id
    old = _row_role(db, board_id, admin_id)

    def change(s: Session) -> None:
        if old is None:
            s.execute(insert(BoardMember).values(board_id=board_id, user_id=admin_id, role="owner"))
        else:
            result = s.execute(
                update(BoardMember)
                .where(
                    BoardMember.board_id == board_id,
                    BoardMember.user_id == admin_id,
                    BoardMember.role == old,
                )
                .values(role="owner")
            )
            if result.rowcount == 0:
                raise HasOwner
        # The write above took the lock; now nobody else may be an owner.
        if _owner_count(s, board_id) != 1:
            raise HasOwner

    try:
        record_change(
            db,
            change,
            actor_id=admin_id,
            kind="board.ownership_taken",
            subject_type="board",
            subject_id=str(board_id),
            data={"user_id": admin_id, "from": old},
            board_id=board_id,
        )
    except (HasOwner, IntegrityError):
        raise HTTPException(409, "has_owner") from None
    return _detail(db, board_id, "owner")
