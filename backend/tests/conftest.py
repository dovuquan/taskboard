import pytest


@pytest.fixture
def db_url(tmp_path):
    """A SQLite URL in a temp directory, so tests never touch the Docker volume."""
    return f"sqlite:///{tmp_path / 'test.db'}"


@pytest.fixture(autouse=True)
def _default_database_in_tmp(tmp_path, monkeypatch):
    """Even code that falls back to the default URL lands in a temp directory."""
    monkeypatch.setenv("TASKBOARD_DATABASE_URL", f"sqlite:///{tmp_path / 'default.db'}")


@pytest.fixture(autouse=True)
def _auth_settings(monkeypatch):
    """Fixed sign-in settings, so no test depends on the developer's `.env`."""
    monkeypatch.setenv("ALLOWED_HD", "example.com")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "test-client-id")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "test-client-secret")
    monkeypatch.setenv("SESSION_SECRET", "test-session-secret-of-some-length")
