"""The invented content of the sample board: lists, cards, labels, people, dates, comments.

Every line below is made up. The content goes in through the same one-change-one-event steps the
routes use (`record_change`), without calling the route handlers, and every event has no actor, so
the feed shows "Taskboard".
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, time, timedelta
from typing import Any

from sqlalchemy import func, insert, select, update
from sqlalchemy.orm import Session

from taskboard.card_fields import ASSIGNABLE_ROLES
from taskboard.cards import _bump_counter, _new_number
from taskboard.events import record_change
from taskboard.models import (
    BoardList,
    BoardMember,
    Card,
    CardLabel,
    CardMember,
    ChecklistItem,
    Comment,
    Label,
    _now,
)


@dataclass(frozen=True)
class Item:
    text: str
    done: bool = False


@dataclass(frozen=True)
class Note:
    author: str  # the part of a seed person's address before "@"
    text: str


@dataclass(frozen=True)
class SampleCard:
    title: str
    labels: tuple[str, ...] = ()  # names of the fixed labels
    people: tuple[str, ...] = ()
    due_in_days: int | None = None  # relative to the day the seed runs, UTC
    description: str | None = None
    checklist: tuple[Item, ...] = ()
    comments: tuple[Note, ...] = ()


@dataclass(frozen=True)
class SampleList:
    name: str
    cards: tuple[SampleCard, ...]


@dataclass(frozen=True)
class Sample:
    lists: tuple[SampleList, ...]


SAMPLE = Sample(
    lists=(
        SampleList(
            "To do",
            (
                SampleCard(
                    "Book the moving company",
                    labels=("Ops",),
                    people=("minh.pham", "hoa.nguyen"),
                    due_in_days=14,
                    description=(
                        "Get three quotes and pick one by the end of the month. "
                        "Ask about insurance for the monitors."
                    ),
                    checklist=(
                        Item("Ask three companies for a quote", done=True),
                        Item("Compare price and insurance"),
                        Item("Pick one and confirm the date"),
                    ),
                    comments=(
                        Note(
                            "hoa.nguyen",
                            "The second company can move us on a Saturday, "
                            "so nobody loses a work day.",
                        ),
                        Note("linh.tran", "Good idea. Please ask them for the price in writing."),
                    ),
                ),
                SampleCard(
                    "Order desks and chairs",
                    labels=("Design",),
                    people=("khoa.le",),
                    due_in_days=21,
                ),
                SampleCard(
                    "Plan the seating chart",
                    labels=("Design", "Research"),
                    people=("thu.vo",),
                    description="Keep each team together and put the quiet desks near the windows.",
                ),
                SampleCard(
                    "Update the office address on the website",
                    labels=("Docs", "Marketing"),
                    people=("linh.tran",),
                    due_in_days=7,
                ),
            ),
        ),
        SampleList(
            "Doing",
            (
                SampleCard(
                    "Pack the meeting room",
                    labels=("Ops",),
                    people=("khoa.le", "thu.vo"),
                    due_in_days=1,
                    checklist=(
                        Item("Label the boxes by room", done=True),
                        Item("Wrap the whiteboards", done=True),
                        Item("Pack the cables and adapters"),
                        Item("Move the boxes to the front desk"),
                    ),
                    comments=(
                        Note("khoa.le", "The empty boxes are in the closet next to the printer."),
                    ),
                ),
                SampleCard(
                    "Fix the door badge reader",
                    labels=("Bug",),
                    people=("minh.pham",),
                    due_in_days=-2,
                    description="The reader at the front door misses one badge in three.",
                    comments=(Note("minh.pham", "A replacement reader arrives on Thursday."),),
                ),
                SampleCard(
                    "Write the first-day guide for the new office",
                    labels=("Launch", "Docs"),
                    description=(
                        "A one-page guide: where to park, how to get a badge, "
                        "and who to ask for help."
                    ),
                ),
            ),
        ),
        SampleList(
            "Done",
            (
                SampleCard("Visit three possible offices"),
                SampleCard(
                    "Sign the new lease",
                    labels=("Launch",),
                    checklist=(
                        Item("Read the lease with the lawyer", done=True),
                        Item("Agree the move-in date", done=True),
                        Item("Sign and send the lease", done=True),
                    ),
                ),
            ),
        ),
    )
)


class BoardChanged(Exception):
    """Someone else added a list to the board while the seed started; nothing more is added."""


def _event(
    session: Session,
    change: Any,
    *,
    kind: str,
    subject_type: str,
    subject_id: Any,
    board_id: int,
    data: dict[str, Any],
) -> Any:
    return record_change(
        session,
        change,
        actor_id=None,
        kind=kind,
        subject_type=subject_type,
        subject_id=subject_id,
        data=data,
        board_id=board_id,
    )


def _is_empty(session: Session, board_id: int) -> bool:
    """No list (archived ones count) and no card: a board nobody has touched."""
    lists = session.scalar(
        select(func.count()).select_from(BoardList).where(BoardList.board_id == board_id)
    )
    cards = session.scalar(select(func.count()).select_from(Card).where(Card.board_id == board_id))
    return not lists and not cards


def _member_ids(session: Session, board_id: int, people: dict[str, int]) -> dict[str, int]:
    """Seed people who are still owner or member of the board; the rest are skipped."""
    roles = dict(
        session.execute(
            select(BoardMember.user_id, BoardMember.role).where(BoardMember.board_id == board_id)
        ).all()
    )
    return {
        local: user_id
        for local, user_id in people.items()
        if roles.get(user_id) in ASSIGNABLE_ROLES
    }


def _add_list(session: Session, board_id: int, owner_id: int, name: str, first: bool) -> int:
    def change(s: Session) -> int:
        end = (
            select(func.coalesce(func.max(BoardList.position), 0.0) + 1)
            .where(BoardList.board_id == board_id)
            .scalar_subquery()
        )
        result = s.execute(
            insert(BoardList).values(
                board_id=board_id, name=name, position=end, created_by=owner_id, created_at=_now()
            )
        )
        if (
            first
            and s.scalar(
                select(func.count()).select_from(BoardList).where(BoardList.board_id == board_id)
            )
            != 1
        ):
            raise BoardChanged
        return result.inserted_primary_key[0]

    return _event(
        session,
        change,
        kind="list.created",
        subject_type="list",
        subject_id=lambda new_id: str(new_id),
        board_id=board_id,
        data={"name": name},
    )


def _add_card(
    session: Session, board_id: int, owner_id: int, list_id: int, title: str
) -> tuple[int, str]:
    data: dict[str, Any] = {}

    def change(s: Session) -> int:
        _bump_counter(s, board_id)
        prefix, number = _new_number(s, board_id)
        end = (
            select(func.coalesce(func.max(Card.position), 0.0) + 1)
            .where(Card.list_id == list_id)
            .scalar_subquery()
        )
        result = s.execute(
            insert(Card).values(
                board_id=board_id,
                list_id=list_id,
                number=number,
                title=title,
                position=end,
                created_by=owner_id,
                created_at=_now(),
            )
        )
        data.update(key=f"{prefix}-{number}", title=title, list_id=list_id)
        return result.inserted_primary_key[0]

    card_id = _event(
        session,
        change,
        kind="card.created",
        subject_type="card",
        subject_id=lambda new_id: str(new_id),
        board_id=board_id,
        data=data,
    )
    return card_id, data["key"]


def _fill_card(
    session: Session,
    board_id: int,
    owner_id: int,
    card_id: int,
    key: str,
    sample: SampleCard,
    members: dict[str, int],
    today: datetime,
) -> None:
    def card_event(change: Any, kind: str, data: dict[str, Any]) -> Any:
        # `data` may be filled by `change` (a new row's id); record_change reads it afterwards.
        data["key"] = key
        return _event(
            session,
            change,
            kind=kind,
            subject_type="card",
            subject_id=str(card_id),
            board_id=board_id,
            data=data,
        )

    for name in sample.labels:
        label = session.scalar(select(Label.id).where(Label.name == name))
        if label is None:
            continue
        card_event(
            lambda s, label=label: s.execute(
                insert(CardLabel).values(card_id=card_id, label_id=label)
            ),
            "card.label_added",
            {"label_id": label, "name": name},
        )

    assignees = [members[local] for local in sample.people if local in members]
    for user_id in assignees:
        card_event(
            lambda s, user_id=user_id: s.execute(
                insert(CardMember).values(card_id=card_id, user_id=user_id)
            ),
            "card.member_added",
            {"user_id": user_id},
        )

    if sample.due_in_days is not None:
        due = datetime.combine((today + timedelta(days=sample.due_in_days)).date(), time())
        card_event(
            lambda s: s.execute(update(Card).where(Card.id == card_id).values(due_at=due)),
            "card.due_changed",
            {"from": None, "to": due.date().isoformat()},
        )

    if sample.description:
        card_event(
            lambda s: s.execute(
                update(Card).where(Card.id == card_id).values(description=sample.description)
            ),
            "card.described",
            {"cleared": False},
        )

    item_author = assignees[0] if assignees else owner_id
    for item in sample.checklist:
        item_data: dict[str, Any] = {"text": item.text}

        def add_item(s: Session, item: Item = item, data: dict[str, Any] = item_data) -> int:
            row = ChecklistItem(
                card_id=card_id, text=item.text, created_by=item_author, created_at=_now()
            )
            s.add(row)
            s.flush()
            data["item_id"] = row.id
            return row.id

        item_id = card_event(add_item, "checklist.item_added", item_data)
        if item.done:
            card_event(
                lambda s, item_id=item_id: s.execute(
                    update(ChecklistItem).where(ChecklistItem.id == item_id).values(done=True)
                ),
                "checklist.item_checked",
                {"item_id": item_id, "text": item.text},
            )

    for note in sample.comments:
        author = members.get(note.author)
        if author is None:
            continue
        comment_data: dict[str, Any] = {}

        def add_comment(
            s: Session, note: Note = note, author: int = author, data: dict[str, Any] = comment_data
        ) -> int:
            row = Comment(card_id=card_id, author_id=author, text=note.text, created_at=_now())
            s.add(row)
            s.flush()
            data["comment_id"] = row.id
            return row.id

        card_event(add_comment, "comment.added", comment_data)


def seed_board_content(
    session: Session, board_id: int, owner_id: int, people: dict[str, int]
) -> tuple[int, int] | None:
    """Add the sample lists and cards to an untouched board; returns (lists, cards) added.

    Returns None when the board already has a list or a card: a board someone worked on is left
    alone, so a second run changes nothing. `people` maps a seed address's local part to a user id.
    """
    if not _is_empty(session, board_id):
        return None
    members = _member_ids(session, board_id, people)
    today = _now()
    lists = cards = 0
    try:
        for index, sample_list in enumerate(SAMPLE.lists):
            list_id = _add_list(session, board_id, owner_id, sample_list.name, first=index == 0)
            lists += 1
            for sample in sample_list.cards:
                card_id, key = _add_card(session, board_id, owner_id, list_id, sample.title)
                cards += 1
                _fill_card(session, board_id, owner_id, card_id, key, sample, members, today)
    except BoardChanged:
        return None
    return lists, cards


__all__: Sequence[str] = ["SAMPLE", "seed_board_content"]
