import threading

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from taskboard.app import create_app
from taskboard.db import make_engine, run_migrations

COLUMNS = {
    "users": {"id", "google_sub", "email", "name", "avatar_url", "created_at", "last_seen_at"},
    "workspace_members": {"user_id", "role", "joined_at"},
    "sessions": {"id_hash", "user_id", "created_at", "expires_at"},
    "auth_events": {"id", "at", "email", "outcome", "reason"},
    "events": {"id", "at", "actor_id", "kind", "subject_type", "subject_id", "data"},
}


def test_every_connection_gets_the_pragmas(db_url):
    engine = make_engine(db_url)
    conns = [engine.connect() for _ in range(3)]
    try:
        for conn in conns:
            assert conn.execute(text("PRAGMA journal_mode")).scalar() == "wal"
            assert conn.execute(text("PRAGMA foreign_keys")).scalar() == 1
            assert conn.execute(text("PRAGMA busy_timeout")).scalar() == 5000
    finally:
        for conn in conns:
            conn.close()


def test_migration_creates_the_five_tables(db_url):
    run_migrations(db_url)

    inspector = inspect(create_engine(db_url))
    for table, columns in COLUMNS.items():
        assert {c["name"] for c in inspector.get_columns(table)} == columns
    users = {c["name"]: c for c in inspector.get_columns("users")}
    assert users["google_sub"]["nullable"] is True
    unique = {tuple(u["column_names"]) for u in inspector.get_unique_constraints("users")}
    unique |= {tuple(i["column_names"]) for i in inspector.get_indexes("users") if i["unique"]}
    assert {("google_sub",), ("email",)} <= unique


def test_migration_is_repeatable(db_url):
    run_migrations(db_url)
    run_migrations(db_url)


def test_foreign_keys_are_enforced(db_url):
    run_migrations(db_url)
    engine = make_engine(db_url)

    with pytest.raises(IntegrityError), engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO workspace_members (user_id, role, joined_at) "
                "VALUES (999, 'member', '2026-01-01 00:00:00')"
            )
        )


def test_startup_runs_migrations(db_url):
    with TestClient(create_app(db_url)):
        pass

    assert set(COLUMNS) <= set(inspect(create_engine(db_url)).get_table_names())


def test_app_without_a_url_uses_the_temp_default(tmp_path):
    app = create_app()

    assert app.state.engine.url.database == str(tmp_path / "default.db")


def test_two_writers_never_see_database_is_locked(db_url):
    run_migrations(db_url)
    engine = make_engine(db_url)
    errors = []

    def writer(name):
        try:
            for i in range(200):
                with engine.begin() as conn:
                    conn.execute(
                        text(
                            "INSERT INTO events (at, kind, subject_type, subject_id, data) "
                            "VALUES ('2026-01-01 00:00:00', 'test.write', 'test', :s, '{}')"
                        ),
                        {"s": f"{name}-{i}"},
                    )
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=writer, args=(n,)) for n in ("a", "b")]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert errors == []
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM events")).scalar() == 400
