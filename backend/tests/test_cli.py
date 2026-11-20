import os
import sqlite3
import subprocess
from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from taskboard import cli
from taskboard.db import make_engine
from taskboard.models import Event, User, WorkspaceMember


@pytest.fixture(autouse=True)
def _url(db_url, monkeypatch):
    monkeypatch.setenv("TASKBOARD_DATABASE_URL", db_url)


@pytest.fixture
def migrated(db_url):
    assert cli.main(["migrate"]) == 0
    return db_url


def query(db_url, fn):
    engine = make_engine(db_url)
    try:
        with Session(engine) as s:
            return fn(s)
    finally:
        engine.dispose()


def user_by_email(db_url, email):
    return query(db_url, lambda s: s.scalar(select(User).where(User.email == email)))


def role_of(db_url, email):
    def f(s):
        return s.scalar(select(WorkspaceMember.role).join(User).where(User.email == email))

    return query(db_url, f)


def events(db_url):
    return query(db_url, lambda s: list(s.scalars(select(Event).order_by(Event.id))))


def test_migrate_creates_tables_and_is_repeatable(db_url):
    assert cli.main(["migrate"]) == 0
    assert cli.main(["migrate"]) == 0
    assert query(db_url, lambda s: s.scalar(select(func.count()).select_from(User))) == 0


def test_admin_creates_a_pending_admin_with_one_event(migrated):
    assert cli.main(["admin", "--email", "New.Person@example.com"]) == 0
    user = user_by_email(migrated, "new.person@example.com")
    assert user.google_sub is None
    assert role_of(migrated, "new.person@example.com") == "admin"
    [event] = events(migrated)
    assert event.kind == "member.added"
    assert event.actor_id is None
    assert event.subject_type == "user"
    assert event.subject_id == str(user.id)
    assert event.data == {"role": "admin", "pending": True}


def test_admin_promotes_an_existing_member(migrated):
    def add(s):
        s.add(User(id=7, email="bob@example.com", google_sub="sub-7"))
        s.flush()
        s.add(WorkspaceMember(user_id=7, role="member"))
        s.commit()

    query(migrated, add)
    assert cli.main(["admin", "--email", "bob@example.com"]) == 0
    assert role_of(migrated, "bob@example.com") == "admin"
    [event] = events(migrated)
    assert event.kind == "member.role_changed"
    assert event.subject_id == "7"
    assert event.data == {"from": "member", "to": "admin"}


def test_admin_adds_the_member_row_for_a_user_without_one(migrated, capsys):
    def add(s):
        s.add(User(id=9, email="nomember@example.com", google_sub="sub-9"))
        s.commit()

    query(migrated, add)

    assert cli.main(["admin", "--email", "nomember@example.com"]) == 0
    assert capsys.readouterr().out == "nomember@example.com is now an admin\n"
    assert role_of(migrated, "nomember@example.com") == "admin"
    [event] = events(migrated)
    assert (event.kind, event.actor_id, event.subject_type, event.subject_id) == (
        "member.role_changed",
        None,
        "user",
        "9",
    )
    assert event.data == {"from": None, "to": "admin"}


def test_admin_again_changes_nothing(migrated, capsys):
    cli.main(["admin", "--email", "x@example.com"])
    capsys.readouterr()
    assert cli.main(["admin", "--email", "x@example.com"]) == 0
    assert "already an admin" in capsys.readouterr().out
    assert len(events(migrated)) == 1


def test_admin_works_after_the_person_signs_in(migrated):
    cli.main(["admin", "--email", "x@example.com"])
    before = user_by_email(migrated, "x@example.com").id

    def sign_in(s):
        u = s.scalar(select(User).where(User.email == "x@example.com"))
        u.google_sub = "sub-x"
        u.name = "X"
        s.commit()

    query(migrated, sign_in)

    def demote(s):
        s.get(WorkspaceMember, before).role = "member"
        s.commit()

    query(migrated, demote)
    assert cli.main(["admin", "--email", "x@example.com"]) == 0
    assert user_by_email(migrated, "x@example.com").id == before
    assert role_of(migrated, "x@example.com") == "admin"
    assert events(migrated)[-1].kind == "member.role_changed"


@pytest.mark.parametrize(
    "email",
    [
        "x@gmail.com",
        "nobody",
        "x@example.com.evil.com",
        "",
        "a b@example.com",
        "a\tb@example.com",
        "a@b@example.com",
        "<x>@example.com",
        'x"y@example.com',
    ],
)
def test_admin_refuses_an_email_outside_the_workspace(migrated, email):
    assert cli.main(["admin", "--email", email]) == 2
    assert events(migrated) == []
    assert query(migrated, lambda s: s.scalar(select(func.count()).select_from(User))) == 0


def test_admin_exits_2_when_allowed_hd_is_not_set(migrated, monkeypatch, capsys):
    monkeypatch.delenv("ALLOWED_HD")
    assert cli.main(["admin", "--email", "x@example.com"]) == 2
    assert "ALLOWED_HD" in capsys.readouterr().err
    assert events(migrated) == []


def test_admin_follows_allowed_hd(migrated, monkeypatch):
    monkeypatch.setenv("ALLOWED_HD", "other.test")
    assert cli.main(["admin", "--email", "x@example.com"]) == 2
    assert cli.main(["admin", "--email", "x@other.test"]) == 0


def test_seed_adds_five_members_once(migrated):
    assert cli.main(["seed"]) == 0
    assert cli.main(["seed"]) == 0
    users = query(migrated, lambda s: list(s.scalars(select(User))))
    assert len(users) == 5
    assert all(u.email.endswith("@example.com") and u.google_sub is None for u in users)
    assert all(role_of(migrated, u.email) == "member" for u in users)
    assert [e.kind for e in events(migrated)] == ["member.added"] * 5


@pytest.mark.parametrize(
    "argv", [["admin", "--email", "new@example.com"], ["seed"]], ids=["admin", "seed"]
)
def test_a_clashing_user_id_is_reported_without_a_traceback(migrated, monkeypatch, capsys, argv):
    # Someone else took the id between the read of max(id) and the write.
    assert cli.main(["admin", "--email", "first@example.com"]) == 0
    taken = user_by_email(migrated, "first@example.com").id
    monkeypatch.setattr(cli, "_next_user_id", lambda _session: taken)
    capsys.readouterr()

    assert cli.main(argv) == 1
    out = capsys.readouterr()
    assert out.out == ""
    assert out.err == "error: concurrent change, run again\n"
    assert [u.email for u in query(migrated, lambda s: list(s.scalars(select(User))))] == [
        "first@example.com"
    ]
    assert len(events(migrated)) == 1


def test_check_prints_integrity_and_schema_head(migrated, capsys):
    capsys.readouterr()
    assert cli.main(["check"]) == 0
    assert capsys.readouterr().out == "integrity: ok\nschema: 0001 (head)\n"


def default_db_path() -> Path:
    return Path(os.environ["TASKBOARD_DATABASE_URL"].removeprefix("sqlite:///"))


def test_check_on_an_unmigrated_database_fails(capsys):
    sqlite3.connect(default_db_path()).close()  # an empty SQLite database

    assert cli.main(["check"]) == 1
    assert capsys.readouterr().out == "integrity: ok\nschema: none\n"


def test_check_on_a_missing_database_fails_without_creating_it(capsys):
    path = default_db_path()

    assert cli.main(["check"]) == 1
    out = capsys.readouterr()
    assert out.out == "integrity: database file not found\n"
    assert out.err == ""
    assert sorted(p.name for p in path.parent.iterdir() if p.name.startswith(path.name)) == []


def test_check_on_a_file_that_is_not_a_database_reports_it(capsys):
    path = default_db_path()
    path.write_bytes(b"not a database, just some text that is long enough\n" * 4)
    before = path.read_bytes()

    assert cli.main(["check"]) == 1
    out = capsys.readouterr()
    assert out.out == "integrity: file is not a database\n"
    assert out.err == ""
    assert path.read_bytes() == before
    assert sorted(p.name for p in path.parent.iterdir() if p.name.startswith(path.name)) == [
        path.name
    ]


def test_check_leaves_a_migrated_database_unchanged(migrated, capsys):
    path = Path(migrated.removeprefix("sqlite:///"))
    before = path.read_bytes()

    assert cli.main(["check"]) == 0
    assert path.read_bytes() == before


def raw_sqlite(db_url, sql):
    """Run SQL without the engine's pragmas, so foreign keys stay off."""
    conn = sqlite3.connect(db_url.removeprefix("sqlite:///"))
    try:
        conn.execute(sql)
        conn.commit()
    finally:
        conn.close()


def test_check_reports_a_foreign_key_violation(migrated, capsys):
    raw_sqlite(
        migrated,
        "INSERT INTO workspace_members (user_id, role, joined_at) "
        "VALUES (999, 'member', '2026-01-01 00:00:00')",
    )
    capsys.readouterr()

    assert cli.main(["check"]) == 1
    assert capsys.readouterr().out == (
        "integrity: foreign key violation in workspace_members\nschema: 0001 (head)\n"
    )


def test_check_reports_a_schema_behind_head(migrated, capsys):
    raw_sqlite(migrated, "UPDATE alembic_version SET version_num = '0000'")
    capsys.readouterr()

    assert cli.main(["check"]) == 1
    assert capsys.readouterr().out == "integrity: ok\nschema: 0000 (head is 0001)\n"


def test_a_failing_write_leaves_neither_change_nor_event(migrated, monkeypatch):
    real = cli.record_change

    def boom(session, change, **kw):
        return real(session, lambda s: (change(s), 1 / 0)[0], **kw)

    monkeypatch.setattr(cli, "record_change", boom)
    with pytest.raises(ZeroDivisionError):
        cli.main(["admin", "--email", "x@example.com"])
    assert user_by_email(migrated, "x@example.com") is None
    assert events(migrated) == []


def test_entry_point_runs_check(migrated):
    result = subprocess.run(
        ["uv", "run", "taskboard", "check"],
        capture_output=True,
        text=True,
        env={**os.environ, "TASKBOARD_DATABASE_URL": migrated},
        cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout == "integrity: ok\nschema: 0001 (head)\n"
