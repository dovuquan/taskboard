import pytest


@pytest.fixture
def db_url(tmp_path):
    """A SQLite URL in a temp directory, so tests never touch the Docker volume."""
    return f"sqlite:///{tmp_path / 'test.db'}"


@pytest.fixture(autouse=True)
def _default_database_in_tmp(tmp_path, monkeypatch):
    """Even code that falls back to the default URL lands in a temp directory."""
    monkeypatch.setenv("TASKBOARD_DATABASE_URL", f"sqlite:///{tmp_path / 'default.db'}")
