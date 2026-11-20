import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from taskboard.db import make_engine, run_migrations
from taskboard.events import record_change
from taskboard.models import Board, Event, User, WorkspaceMember


@pytest.fixture
def session(db_url):
    run_migrations(db_url)
    engine = make_engine(db_url)
    with Session(engine) as s:
        s.add_all([User(id=1, email="admin@example.com"), User(id=2, email="bob@example.com")])
        s.flush()
        s.add_all(
            [WorkspaceMember(user_id=1, role="admin"), WorkspaceMember(user_id=2, role="member")]
        )
        s.commit()
        yield s
    engine.dispose()


def set_role(user_id: int, role: str):
    def change(s: Session):
        s.get(WorkspaceMember, user_id).role = role

    return change


def role_of(db_url, user_id: int) -> str:
    with Session(make_engine(db_url)) as fresh:
        return fresh.get(WorkspaceMember, user_id).role


def event_count(db_url) -> int:
    with Session(make_engine(db_url)) as fresh:
        return fresh.scalar(select(func.count()).select_from(Event))


def test_success_writes_the_change_and_exactly_one_event(session, db_url):
    result = record_change(
        session,
        set_role(2, "admin"),
        actor_id=1,
        kind="member.role_changed",
        subject_type="user",
        subject_id="2",
        data={"from": "member", "to": "admin"},
    )

    assert result is None
    assert role_of(db_url, 2) == "admin"
    with Session(make_engine(db_url)) as fresh:
        events = fresh.scalars(select(Event)).all()
        assert len(events) == 1
        e = events[0]
        assert (e.actor_id, e.kind, e.subject_type, e.subject_id) == (
            1,
            "member.role_changed",
            "user",
            "2",
        )
        assert e.data == {"from": "member", "to": "admin"}


def test_change_forced_to_fail_after_update_leaves_neither(session, db_url):
    def failing(s: Session):
        set_role(2, "admin")(s)
        s.flush()  # the UPDATE is really sent to the database
        raise RuntimeError("boom")

    with pytest.raises(RuntimeError, match="boom"):
        record_change(
            session,
            failing,
            actor_id=1,
            kind="member.role_changed",
            subject_type="user",
            subject_id="2",
        )

    assert role_of(db_url, 2) == "member"
    assert event_count(db_url) == 0


def test_failing_event_insert_rolls_back_the_change(session, db_url):
    with pytest.raises(IntegrityError):  # foreign key violation on actor_id
        record_change(
            session,
            set_role(2, "admin"),
            actor_id=999,
            kind="member.role_changed",
            subject_type="user",
            subject_id="2",
        )

    assert role_of(db_url, 2) == "member"
    assert event_count(db_url) == 0


def test_two_changes_write_two_events(session, db_url):
    for uid, role in ((2, "admin"), (1, "member")):
        record_change(
            session,
            set_role(uid, role),
            actor_id=1,
            kind="member.role_changed",
            subject_type="user",
            subject_id=str(uid),
        )

    with Session(make_engine(db_url)) as fresh:
        assert [e.subject_id for e in fresh.scalars(select(Event).order_by(Event.id))] == ["2", "1"]


def test_data_defaults_to_empty(session, db_url):
    record_change(
        session, lambda s: None, actor_id=None, kind="x.y", subject_type="t", subject_id="1"
    )
    with Session(make_engine(db_url)) as fresh:
        assert fresh.scalar(select(Event.data)) == {}


def test_callable_subject_id_and_board_id_receive_the_changes_result(session, db_url):
    def create(s: Session) -> int:
        board = Board(name="Roadmap", visibility="workspace", created_by=1)
        s.add(board)
        s.flush()
        return board.id

    board_id = record_change(
        session,
        create,
        actor_id=1,
        kind="board.created",
        subject_type="board",
        subject_id=lambda new_id: str(new_id),
        board_id=lambda new_id: new_id,
    )

    with Session(make_engine(db_url)) as fresh:
        [e] = fresh.scalars(select(Event)).all()
        assert (e.subject_id, e.board_id) == (str(board_id), board_id)


def test_board_id_may_be_a_plain_int_and_defaults_to_none(session, db_url):
    record_change(
        session,
        lambda s: None,
        actor_id=1,
        kind="x.y",
        subject_type="t",
        subject_id="1",
        board_id=7,
    )
    record_change(session, lambda s: None, actor_id=1, kind="x.z", subject_type="t", subject_id="1")

    with Session(make_engine(db_url)) as fresh:
        assert fresh.scalars(select(Event.board_id).order_by(Event.id)).all() == [7, None]


def test_a_failing_callable_rolls_the_change_back(session, db_url):
    def boom(_result):
        raise RuntimeError("no id")

    with pytest.raises(RuntimeError, match="no id"):
        record_change(
            session,
            set_role(2, "admin"),
            actor_id=1,
            kind="x.y",
            subject_type="t",
            subject_id=boom,
        )

    assert role_of(db_url, 2) == "member"
    assert event_count(db_url) == 0


def _add(s: Session) -> None:
    s.add(User(id=50, email="carol@example.com"))


def _modify(s: Session) -> None:
    s.get(WorkspaceMember, 2).role = "admin"


def _delete(s: Session) -> None:
    s.delete(s.get(WorkspaceMember, 2))


def snapshot(db_url) -> tuple:
    with Session(make_engine(db_url)) as fresh:
        return (
            fresh.scalar(select(func.count()).select_from(User)),
            fresh.scalars(select(WorkspaceMember.role).order_by(WorkspaceMember.user_id)).all(),
            fresh.scalar(select(func.count()).select_from(Event)),
        )


@pytest.mark.parametrize("pending", [_add, _modify, _delete], ids=["add", "modify", "delete"])
@pytest.mark.parametrize("flushed", [False, True], ids=["unflushed", "flushed"])
def test_uncommitted_work_is_refused_and_nothing_is_committed(session, db_url, pending, flushed):
    before = snapshot(db_url)
    pending(session)  # uncommitted work that did not go through record_change
    if flushed:
        session.flush()

    with pytest.raises(RuntimeError, match="no pending changes"):
        record_change(
            session, lambda s: None, actor_id=1, kind="x.y", subject_type="t", subject_id="2"
        )

    session.rollback()
    assert snapshot(db_url) == before


def test_session_is_usable_again_after_a_rollback_or_a_commit(session, db_url):
    _add(session)
    session.flush()
    session.rollback()
    record_change(session, _modify, actor_id=1, kind="x.y", subject_type="t", subject_id="2")

    _add(session)
    session.flush()
    session.commit()
    record_change(session, _delete, actor_id=1, kind="x.z", subject_type="t", subject_id="2")

    with Session(make_engine(db_url)) as fresh:
        assert [e.kind for e in fresh.scalars(select(Event).order_by(Event.id))] == ["x.y", "x.z"]
