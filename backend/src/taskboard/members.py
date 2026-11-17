"""Workspace members: the list, role changes with the last-admin guard, and the refused feed."""

from datetime import datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from taskboard import auth
from taskboard.auth import current_user, get_db, require_admin
from taskboard.events import record_change
from taskboard.models import AuthEvent, User, WorkspaceMember

router = APIRouter()


class RoleBody(BaseModel):
    role: Literal["admin", "member"]


class MemberNotFound(Exception):
    """No workspace member has this id."""


class LastAdmin(Exception):
    """The change would leave the workspace without an admin."""


class OwnRole(Exception):
    """Admins cannot change their own role."""


class NotAdmin(Exception):
    """The acting user is no longer an admin."""


class _AlreadyChanged(Exception):
    """Another request changed this role first; nothing was written."""


def _iso(dt: datetime | None) -> str | None:
    return None if dt is None else dt.isoformat() + "Z"


def _member_out(user: User, member: WorkspaceMember) -> dict[str, Any]:
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "avatar_url": user.avatar_url,
        "role": member.role,
        "joined_at": _iso(member.joined_at),
        "last_seen_at": _iso(user.last_seen_at),
        "pending": user.google_sub is None,
    }


def _admin_count(session: Session) -> int:
    stmt = select(func.count()).select_from(WorkspaceMember).where(WorkspaceMember.role == "admin")
    return session.scalar(stmt) or 0


def change_role(
    session: Session, *, actor_id: int | None, user_id: int, role: str
) -> WorkspaceMember:
    """Set a member's role and record `member.role_changed` in the same transaction."""
    member = session.get(WorkspaceMember, user_id)
    if member is None:
        raise MemberNotFound
    if member.role == "admin" and role == "member" and _admin_count(session) == 1:
        raise LastAdmin
    if user_id == actor_id:
        raise OwnRole
    if member.role == role:
        return member
    old = member.role

    def change(s: Session) -> None:
        # The conditional UPDATE takes SQLite's write lock, so what follows sees committed state.
        result = s.execute(
            update(WorkspaceMember)
            .where(WorkspaceMember.user_id == user_id, WorkspaceMember.role == old)
            .values(role=role)
        )
        if result.rowcount == 0:
            raise _AlreadyChanged
        if actor_id is not None:
            actor_role = s.scalar(
                select(WorkspaceMember.role).where(WorkspaceMember.user_id == actor_id)
            )
            if actor_role != "admin":
                raise NotAdmin
        if _admin_count(s) == 0:
            raise LastAdmin

    try:
        record_change(
            session,
            change,
            actor_id=actor_id,
            kind="member.role_changed",
            subject_type="user",
            subject_id=str(user_id),
            data={"from": old, "to": role},
        )
    except _AlreadyChanged:
        pass  # rolled back, no event; answer with the current state
    session.refresh(member)
    return member


@router.get("/api/members")
def list_members(_user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.execute(
        select(User, WorkspaceMember)
        .join(WorkspaceMember, WorkspaceMember.user_id == User.id)
        .order_by(User.email)
    ).all()
    return [_member_out(user, member) for user, member in rows]


@router.patch("/api/members/{user_id}")
def set_member_role(
    user_id: Annotated[int, Path(ge=1, le=2**63 - 1)],
    body: RoleBody,
    actor: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    try:
        member = change_role(db, actor_id=actor.id, user_id=user_id, role=body.role)
    except MemberNotFound:
        raise HTTPException(404, "member_not_found") from None
    except LastAdmin:
        raise HTTPException(409, "last_admin") from None
    except OwnRole:
        raise HTTPException(409, "own_role") from None
    except NotAdmin:
        raise HTTPException(403, "forbidden") from None
    return _member_out(db.get(User, user_id), member)


@router.get("/api/auth-events/refused")
def refused_sign_ins(_admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    since = auth._now() - timedelta(days=7)
    rows = db.scalars(
        select(AuthEvent)
        .where(AuthEvent.outcome == "refused", AuthEvent.at >= since)
        .order_by(AuthEvent.at.desc(), AuthEvent.id.desc())
    ).all()
    return [{"at": _iso(row.at), "email": row.email, "reason": row.reason} for row in rows]
