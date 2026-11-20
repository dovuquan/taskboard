import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from support import FakeOidc, good_claims, query, sign_in

from taskboard import auth
from taskboard.app import create_app
from taskboard.models import User, WorkspaceMember


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


@pytest.fixture
def oidc():
    return FakeOidc()


@pytest.fixture
def app(db_url, oidc):
    app = create_app(db_url)
    app.dependency_overrides[auth.get_oidc] = lambda: oidc
    return app


@pytest.fixture
def client(app):
    with TestClient(app, base_url="http://localhost:8000") as c:
        yield c


@pytest.fixture
def as_user(app, oidc, db_url):
    """Factory: a new client signed in as `email`, with its workspace role set directly."""
    clients: list[TestClient] = []

    def make(email: str, sub: str, role: str = "member") -> TestClient:
        c = TestClient(app, base_url="http://localhost:8000")
        c.__enter__()
        clients.append(c)
        claims = good_claims(email=email, sub=sub, name=email.split("@")[0].title())
        assert sign_in(c, oidc, claims).headers["location"] == "/boards"

        def set_role(s: Session) -> None:
            user = s.scalars(select(User).where(User.email == email)).one()
            s.get(WorkspaceMember, user.id).role = role
            s.commit()

        query(db_url, set_role)
        return c

    yield make
    for c in clients:
        c.__exit__(None, None, None)
