"""Database engine, SQLite pragmas and migrations."""

import os
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, event

DEFAULT_DATABASE_URL = "sqlite:////data/taskboard.db"
_MIGRATIONS = Path(__file__).resolve().parent / "migrations"


def database_url() -> str:
    return os.environ.get("TASKBOARD_DATABASE_URL", DEFAULT_DATABASE_URL)


def make_engine(url: str | None = None) -> Engine:
    """An engine whose every connection gets WAL, foreign keys and a busy timeout."""
    engine = create_engine(url or database_url())

    @event.listens_for(engine, "connect")
    def _pragmas(dbapi_conn, _record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()

    return engine


def run_migrations(url: str | None = None) -> None:
    """Apply every Alembic migration up to head."""
    config = Config()
    config.set_main_option("script_location", str(_MIGRATIONS))
    config.set_main_option("sqlalchemy.url", (url or database_url()).replace("%", "%%"))
    command.upgrade(config, "head")
