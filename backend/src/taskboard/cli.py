"""The `taskboard` command line: set up the database and the first admin."""

import argparse
import re
import sqlite3
import sys
from pathlib import Path

from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, func, make_url, select, text
from sqlalchemy.exc import DatabaseError, IntegrityError
from sqlalchemy.orm import Session

from taskboard.db import _MIGRATIONS, database_url, make_engine, run_migrations
from taskboard.events import record_change
from taskboard.models import Board, BoardMember, User, WorkspaceMember
from taskboard.seed import seed_board_content
from taskboard.settings import allowed_hd

SEED_BOARD = "Office move"

SEED_PEOPLE = [
    ("Linh Tran", "linh.tran"),
    ("Minh Pham", "minh.pham"),
    ("Hoa Nguyen", "hoa.nguyen"),
    ("Khoa Le", "khoa.le"),
    ("Thu Vo", "thu.vo"),
]


# A simple safe set for the part before "@"; anything else cannot be a workspace account.
_LOCAL_PART = re.compile(r"[a-z0-9._%+-]+")


def _valid_email(raw: str, domain_name: str) -> str | None:
    email = raw.strip().lower()
    local, _, domain = email.partition("@")
    if _LOCAL_PART.fullmatch(local) and domain == domain_name:
        return email
    return None


def _require_domain() -> str | None:
    domain = allowed_hd()
    if domain is None:
        print("error: ALLOWED_HD is not set (see .env.example)", file=sys.stderr)
    return domain


def _concurrent_change() -> int:
    """Another writer took the same id or email first; record_change already rolled back."""
    print("error: concurrent change, run again", file=sys.stderr)
    return 1


def _next_user_id(session: Session) -> int:
    return (session.scalar(select(func.max(User.id))) or 0) + 1


def _add_member(session: Session, email: str, role: str, name: str | None = None) -> int:
    """Create a user and its workspace role in one recorded change; returns the user id."""
    user_id = _next_user_id(session)

    def change(s: Session) -> None:
        s.add(User(id=user_id, email=email, name=name))
        s.flush()
        s.add(WorkspaceMember(user_id=user_id, role=role))

    record_change(
        session,
        change,
        actor_id=None,
        kind="member.added",
        subject_type="user",
        subject_id=str(user_id),
        data={"role": role, "pending": True},
    )
    return user_id


def _seed_board(session: Session, domain: str) -> bool:
    """Add the invented Workspace board once: first seed person owns it, the rest are members."""
    if session.scalar(select(Board.id).where(Board.name == SEED_BOARD)) is not None:
        return False
    ids = [
        session.scalar(select(User.id).where(User.email == f"{local}@{domain}"))
        for _, local in SEED_PEOPLE
    ]
    owner_id, member_ids = ids[0], ids[1:]

    def create(s: Session) -> int:
        board = Board(name=SEED_BOARD, visibility="workspace", created_by=owner_id)
        s.add(board)
        s.flush()
        s.add(BoardMember(board_id=board.id, user_id=owner_id, role="owner"))
        return board.id

    board_id = record_change(
        session,
        create,
        actor_id=None,
        kind="board.created",
        subject_type="board",
        subject_id=lambda new_id: str(new_id),
        data={"name": SEED_BOARD, "visibility": "workspace"},
        board_id=lambda new_id: new_id,
    )
    for member_id in member_ids:
        record_change(
            session,
            lambda s, member_id=member_id: s.add(
                BoardMember(board_id=board_id, user_id=member_id, role="member")
            ),
            actor_id=None,
            kind="board_member.added",
            subject_type="board",
            subject_id=str(board_id),
            data={"user_id": member_id, "role": "member"},
            board_id=board_id,
        )
    return True


def _seed_content(session: Session, domain: str) -> tuple[int, int] | None:
    """Fill the seed board with its sample lists and cards, if it is still untouched."""
    people = {
        local: user_id
        for _, local in SEED_PEOPLE
        if (user_id := session.scalar(select(User.id).where(User.email == f"{local}@{domain}")))
        is not None
    }
    owner_id = people.get(SEED_PEOPLE[0][1])
    if owner_id is None:
        return None
    board_id = session.scalar(
        select(Board.id)
        .where(Board.name == SEED_BOARD, Board.archived_at.is_(None), Board.created_by == owner_id)
        .order_by(Board.id)
    )
    if board_id is None:
        return None
    return seed_board_content(session, board_id, owner_id, people)


def cmd_migrate(_args: argparse.Namespace) -> int:
    run_migrations()
    print("migrated to head")
    return 0


def cmd_admin(args: argparse.Namespace) -> int:
    domain = _require_domain()
    if domain is None:
        return 2
    email = _valid_email(args.email, domain)
    if email is None:
        print(f"error: email must be an address @{domain}", file=sys.stderr)
        return 2
    engine = make_engine()
    try:
        with Session(engine) as session:
            user = session.scalar(select(User).where(User.email == email))
            if user is None:
                _add_member(session, email, "admin")
                print(f"{email} is now an admin (pending: has not signed in yet)")
                return 0
            member = session.get(WorkspaceMember, user.id)
            if member is not None and member.role == "admin":
                print(f"{email} is already an admin")
                return 0
            user_id = user.id
            old_role = member.role if member else None

            def change(s: Session) -> None:
                row = s.get(WorkspaceMember, user_id)
                if row is None:
                    s.add(WorkspaceMember(user_id=user_id, role="admin"))
                else:
                    row.role = "admin"

            record_change(
                session,
                change,
                actor_id=None,
                kind="member.role_changed",
                subject_type="user",
                subject_id=str(user_id),
                data={"from": old_role, "to": "admin"},
            )
            print(f"{email} is now an admin")
            return 0
    except IntegrityError:
        return _concurrent_change()
    finally:
        engine.dispose()


def cmd_seed(_args: argparse.Namespace) -> int:
    domain = _require_domain()
    if domain is None:
        return 2
    engine = make_engine()
    added = 0
    try:
        with Session(engine) as session:
            for name, local in SEED_PEOPLE:
                email = f"{local}@{domain}"
                if session.scalar(select(User.id).where(User.email == email)) is None:
                    _add_member(session, email, "member", name)
                    added += 1
            board_added = _seed_board(session, domain)
            content = _seed_content(session, domain)
    except IntegrityError:
        return _concurrent_change()
    finally:
        engine.dispose()
    print(f"seeded {added} new member(s)")
    if board_added:
        print(f"seeded the board {SEED_BOARD!r}")
    if content is not None and content[0]:
        print(f"seeded {content[0]} lists and {content[1]} cards on {SEED_BOARD!r}")
    return 0


def cmd_check(_args: argparse.Namespace) -> int:
    config = Config()
    config.set_main_option("script_location", str(_MIGRATIONS))
    head = ScriptDirectory.from_config(config).get_current_head()
    path = Path(make_url(database_url()).database or "")
    if not path.is_file():
        print("integrity: database file not found")
        return 1
    # Read-only and without make_engine's pragmas, so the check never creates or changes a file.
    uri = f"{path.resolve().as_uri()}?mode=ro"
    engine = create_engine("sqlite://", creator=lambda: sqlite3.connect(uri, uri=True))
    try:
        with engine.connect() as conn:
            problems = [r[0] for r in conn.execute(text("PRAGMA integrity_check"))]
            problems = [p for p in problems if p != "ok"]
            problems += [
                f"foreign key violation in {r[0]}"
                for r in conn.execute(text("PRAGMA foreign_key_check"))
            ]
            current = MigrationContext.configure(conn).get_current_revision()
    except DatabaseError as error:
        print(f"integrity: {error.orig}")
        return 1
    finally:
        engine.dispose()
    for problem in problems:
        print(f"integrity: {problem}")
    if not problems:
        print("integrity: ok")
    if current is None:
        print("schema: none")
    elif current == head:
        print(f"schema: {current} (head)")
    else:
        print(f"schema: {current} (head is {head})")
    return 0 if not problems and current == head else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="taskboard", description="Taskboard admin commands.")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("migrate", help="apply database migrations").set_defaults(func=cmd_migrate)
    admin = sub.add_parser("admin", help="make a person a workspace admin")
    admin.add_argument("--email", required=True)
    admin.set_defaults(func=cmd_admin)
    sub.add_parser("seed", help="add five invented members and the sample board").set_defaults(
        func=cmd_seed
    )
    sub.add_parser("check", help="integrity check and schema head").set_defaults(func=cmd_check)
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
