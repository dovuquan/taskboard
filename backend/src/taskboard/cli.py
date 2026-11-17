"""The `taskboard` command line: set up the database and the first admin."""

import argparse
import sys

from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from taskboard.db import _MIGRATIONS, make_engine, run_migrations
from taskboard.events import record_change
from taskboard.models import User, WorkspaceMember
from taskboard.settings import allowed_hd

SEED_PEOPLE = [
    ("Linh Tran", "linh.tran"),
    ("Minh Pham", "minh.pham"),
    ("Hoa Nguyen", "hoa.nguyen"),
    ("Khoa Le", "khoa.le"),
    ("Thu Vo", "thu.vo"),
]


def _valid_email(raw: str, domain_name: str) -> str | None:
    email = raw.strip().lower()
    local, _, domain = email.partition("@")
    if local and domain == domain_name:
        return email
    return None


def _require_domain() -> str | None:
    domain = allowed_hd()
    if domain is None:
        print("error: ALLOWED_HD is not set (see .env.example)", file=sys.stderr)
    return domain


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
    finally:
        engine.dispose()
    print(f"seeded {added} new member(s)")
    return 0


def cmd_check(_args: argparse.Namespace) -> int:
    config = Config()
    config.set_main_option("script_location", str(_MIGRATIONS))
    head = ScriptDirectory.from_config(config).get_current_head()
    engine = make_engine()
    try:
        with engine.connect() as conn:
            problems = [r[0] for r in conn.execute(text("PRAGMA integrity_check"))]
            problems = [p for p in problems if p != "ok"]
            problems += [
                f"foreign key violation in {r[0]}"
                for r in conn.execute(text("PRAGMA foreign_key_check"))
            ]
            current = MigrationContext.configure(conn).get_current_revision()
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
    sub.add_parser("seed", help="add five invented members").set_defaults(func=cmd_seed)
    sub.add_parser("check", help="integrity check and schema head").set_defaults(func=cmd_check)
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
