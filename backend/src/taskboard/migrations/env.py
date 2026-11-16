"""Alembic environment: runs migrations on a pragma-configured engine."""

from alembic import context

from taskboard.db import make_engine
from taskboard.models import Base

config = context.config
target_metadata = Base.metadata


def run_migrations_online() -> None:
    engine = make_engine(config.get_main_option("sqlalchemy.url"))
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


run_migrations_online()
