import threading

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from taskboard.app import create_app
from taskboard.db import _MIGRATIONS as MIGRATIONS
from taskboard.db import make_engine, run_migrations

COLUMNS = {
    "users": {"id", "google_sub", "email", "name", "avatar_url", "created_at", "last_seen_at"},
    "workspace_members": {"user_id", "role", "joined_at"},
    "sessions": {"id_hash", "user_id", "created_at", "expires_at"},
    "auth_events": {"id", "at", "email", "outcome", "reason"},
    "events": {"id", "at", "actor_id", "kind", "subject_type", "subject_id", "data", "board_id"},
    "boards": {
        "id",
        "name",
        "visibility",
        "key_prefix",
        "next_card_number",
        "created_by",
        "created_at",
        "archived_at",
    },
    "board_members": {"board_id", "user_id", "role", "added_at"},
    "lists": {
        "id",
        "board_id",
        "name",
        "position",
        "created_by",
        "created_at",
        "archived_at",
        "archived_by",
    },
    "cards": {
        "id",
        "board_id",
        "list_id",
        "number",
        "title",
        "description",
        "due_at",
        "position",
        "created_by",
        "created_at",
        "archived_at",
        "archived_by",
    },
    "labels": {"id", "name", "color"},
    "card_members": {"card_id", "user_id"},
    "card_labels": {"card_id", "label_id"},
    "checklist_items": {
        "id",
        "card_id",
        "text",
        "done",
        "created_by",
        "created_at",
        "deleted_at",
        "deleted_by",
    },
    "comments": {
        "id",
        "card_id",
        "author_id",
        "text",
        "created_at",
        "edited_at",
        "deleted_at",
        "deleted_by",
    },
}

LABELS = ["Launch", "Bug", "Docs", "Ops", "Marketing", "Research", "Design"]


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


def test_migration_creates_the_tables(db_url):
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

    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS))
    head = ScriptDirectory.from_config(config).get_current_head()
    engine = create_engine(db_url)
    with engine.connect() as conn:
        versions = conn.execute(text("SELECT version_num FROM alembic_version")).scalars().all()
    engine.dispose()
    assert versions == [head]
    assert set(COLUMNS) <= set(inspect(create_engine(db_url)).get_table_names())


def _labels(db_url):
    engine = create_engine(db_url)
    try:
        with engine.connect() as conn:
            return [tuple(r) for r in conn.execute(text("SELECT id, name, color FROM labels"))]
    finally:
        engine.dispose()


def test_migration_seeds_the_seven_labels_once(db_url):
    run_migrations(db_url)
    run_migrations(db_url)

    assert _labels(db_url) == [(i, n, n.lower()) for i, n in enumerate(LABELS, start=1)]


def test_card_link_tables_have_composite_keys_foreign_keys_and_indexes(db_url):
    run_migrations(db_url)

    inspector = inspect(create_engine(db_url))
    for table, key, other, target in (
        ("card_members", ["card_id", "user_id"], "user_id", "users"),
        ("card_labels", ["card_id", "label_id"], "label_id", "labels"),
    ):
        assert inspector.get_pk_constraint(table)["constrained_columns"] == key
        targets = {fk["referred_table"] for fk in inspector.get_foreign_keys(table)}
        assert targets == {"cards", target}
        assert [other] in [i["column_names"] for i in inspector.get_indexes(table)]
    unique = [tuple(i["column_names"]) for i in inspector.get_indexes("labels") if i["unique"]]
    unique += [tuple(u["column_names"]) for u in inspector.get_unique_constraints("labels")]
    assert ("name",) in unique


def test_checklist_and_comment_tables_have_foreign_keys_and_indexes(db_url):
    run_migrations(db_url)

    inspector = inspect(create_engine(db_url))
    for table, targets in (
        ("checklist_items", {"cards", "users"}),
        ("comments", {"cards", "users"}),
    ):
        assert inspector.get_pk_constraint(table)["constrained_columns"] == ["id"]
        assert {fk["referred_table"] for fk in inspector.get_foreign_keys(table)} == targets
        assert ["card_id"] in [i["column_names"] for i in inspector.get_indexes(table)]
    subject = [i for i in inspector.get_indexes("events") if i["name"] == "ix_events_subject"]
    assert [i["column_names"] for i in subject] == [["subject_type", "subject_id"]]


def test_downgrade_removes_the_new_tables_and_upgrade_restores_them(db_url):
    run_migrations(db_url)
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS))
    config.set_main_option("sqlalchemy.url", db_url)

    command.downgrade(config, "0004")
    names = set(inspect(create_engine(db_url)).get_table_names())
    assert not {"labels", "card_members", "card_labels"} & names
    assert "cards" in names

    command.upgrade(config, "head")
    assert [name for _id, name, _c in _labels(db_url)] == LABELS


def test_downgrade_to_0005_drops_the_checklist_and_comment_tables(db_url):
    run_migrations(db_url)
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS))
    config.set_main_option("sqlalchemy.url", db_url)

    command.downgrade(config, "0005")
    inspector = inspect(create_engine(db_url))
    assert not {"checklist_items", "comments"} & set(inspector.get_table_names())
    assert "ix_events_subject" not in [i["name"] for i in inspector.get_indexes("events")]
    assert "card_labels" in inspector.get_table_names()

    command.upgrade(config, "head")
    assert {"checklist_items", "comments"} <= set(inspect(create_engine(db_url)).get_table_names())


def test_cards_archived_by_is_a_nullable_foreign_key_to_users(db_url):
    run_migrations(db_url)

    inspector = inspect(create_engine(db_url))
    columns = {c["name"]: c for c in inspector.get_columns("cards")}
    assert columns["archived_by"]["nullable"] is True
    refs = {
        tuple(fk["constrained_columns"]): fk["referred_table"]
        for fk in inspector.get_foreign_keys("cards")
    }
    assert refs[("archived_by",)] == "users"


def test_downgrade_to_0006_drops_archived_by_and_keeps_the_cards(db_url):
    run_migrations(db_url)
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS))
    config.set_main_option("sqlalchemy.url", db_url)
    engine = make_engine(db_url)
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO users (id, email, created_at) VALUES (1, 'a@example.com', '2026')")
        )
        conn.execute(
            text(
                "INSERT INTO boards (id, name, visibility, created_by, created_at) "
                "VALUES (1, 'B', 'workspace', 1, '2026-01-01 00:00:00')"
            )
        )
        conn.execute(
            text(
                "INSERT INTO lists (id, board_id, name, position, created_by, created_at) "
                "VALUES (1, 1, 'L', 1.0, 1, '2026-01-01 00:00:00')"
            )
        )
        conn.execute(
            text(
                "INSERT INTO cards (id, board_id, list_id, number, title, position, created_by, "
                "created_at, archived_at, archived_by) VALUES "
                "(1, 1, 1, 1, 'T', 1.0, 1, '2026-01-01 00:00:00', '2026-01-02 00:00:00', 1)"
            )
        )
        conn.execute(
            text(
                "INSERT INTO comments (card_id, author_id, text, created_at) "
                "VALUES (1, 1, 'hi', '2026-01-01 00:00:00')"
            )
        )
    engine.dispose()

    command.downgrade(config, "0006")

    inspector = inspect(create_engine(db_url))
    assert "archived_by" not in {c["name"] for c in inspector.get_columns("cards")}
    check = create_engine(db_url)
    with check.connect() as conn:
        assert conn.execute(text("SELECT title, archived_at FROM cards")).one()[0] == "T"
        assert conn.execute(text("SELECT count(*) FROM comments")).scalar() == 1
        assert conn.execute(text("PRAGMA foreign_key_check")).all() == []
    check.dispose()

    command.upgrade(config, "head")
    assert "archived_by" in {c["name"] for c in inspect(create_engine(db_url)).get_columns("cards")}


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


def test_a_card_number_is_unique_within_its_board(db_url):
    run_migrations(db_url)
    engine = make_engine(db_url)
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO users (id, email, created_at) VALUES (1, 'a@example.com', '2026')")
        )
        conn.execute(
            text(
                "INSERT INTO boards (id, name, visibility, created_by, created_at) "
                "VALUES (1, 'B', 'workspace', 1, '2026-01-01 00:00:00')"
            )
        )
        conn.execute(
            text(
                "INSERT INTO lists (id, board_id, name, position, created_by, created_at) "
                "VALUES (1, 1, 'L', 1.0, 1, '2026-01-01 00:00:00')"
            )
        )
    card = (
        "INSERT INTO cards (board_id, list_id, number, title, position, created_by, created_at) "
        "VALUES (1, 1, :n, 'T', 1.0, 1, '2026-01-01 00:00:00')"
    )
    with engine.begin() as conn:
        conn.execute(text(card), {"n": 1})
        conn.execute(text(card), {"n": 2})

    with pytest.raises(IntegrityError), engine.begin() as conn:
        conn.execute(text(card), {"n": 1})


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
