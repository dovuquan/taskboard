"""The one place a state change and its `events` row are written together."""

from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session

from taskboard.models import Event


def record_change[T](
    session: Session,
    change: Callable[[Session], T],
    *,
    actor_id: int | None,
    kind: str,
    subject_type: str,
    subject_id: str,
    data: dict[str, Any] | None = None,
) -> T:
    """Run `change`, insert its event, and commit both in one transaction.

    Any failure, in the change or in the event insert, rolls both back and is
    re-raised. The session must have no uncommitted work, so the commit never
    carries changes that did not go through this helper.
    """
    if session.new or session.dirty or session.deleted:
        raise RuntimeError("record_change needs a session with no pending changes")
    try:
        result = change(session)
        session.add(
            Event(
                actor_id=actor_id,
                kind=kind,
                subject_type=subject_type,
                subject_id=subject_id,
                data=data or {},
            )
        )
        session.flush()
        session.commit()
    except BaseException:
        session.rollback()
        raise
    return result
