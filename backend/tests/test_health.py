import logging

from fastapi.testclient import TestClient

from taskboard.app import create_app
from taskboard.db import make_engine


def test_health_returns_ok_after_a_database_round_trip(db_url):
    with TestClient(create_app(db_url)) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_fails_when_the_database_cannot_be_read(db_url):
    app = create_app(db_url)
    with TestClient(app) as client:
        app.state.engine = make_engine("sqlite:////nonexistent-dir/x.db")
        response = client.get("/health")

    assert response.status_code == 503
    assert response.json() == {"status": "unavailable"}


def test_health_logs_why_the_database_check_failed(db_url, caplog):
    app = create_app(db_url)
    with TestClient(app) as client:
        app.state.engine = make_engine("sqlite:////nonexistent-dir/x.db")
        with caplog.at_level(logging.WARNING, logger="taskboard.app"):
            client.get("/health")

    assert [(r.levelname, r.getMessage()) for r in caplog.records if r.name == "taskboard.app"] == [
        ("WARNING", "health check failed: OperationalError: unable to open database file")
    ]
