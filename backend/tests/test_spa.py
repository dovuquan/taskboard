"""The built web app is served with a client-side routing fallback; /api/config is public."""

import pytest
from fastapi.testclient import TestClient

from taskboard.app import create_app

INDEX_HTML = "<!doctype html><title>spa-fixture</title>"
ASSET_JS = 'console.log("x")'


@pytest.fixture
def spa_client(tmp_path, db_url, monkeypatch):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text(INDEX_HTML)
    (dist / "assets" / "x.js").write_text(ASSET_JS)
    monkeypatch.setenv("TASKBOARD_WEB_DIST", str(dist))
    with TestClient(create_app(db_url), base_url="http://localhost:8000") as c:
        yield c


@pytest.mark.parametrize(
    "path",
    [
        "/boards",
        "/members",
        "/signin/refused?reason=wrong_domain",
        "/signin",
    ],
)
def test_client_routes_serve_the_index_page(spa_client, path):
    response = spa_client.get(path)

    assert response.status_code == 200
    assert response.text == INDEX_HTML


def test_built_assets_are_served_as_files(spa_client):
    response = spa_client.get("/assets/x.js")

    assert response.status_code == 200
    assert response.text == ASSET_JS


def test_unknown_api_paths_return_a_json_404(spa_client):
    response = spa_client.get("/api/nope")

    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}
    assert response.headers["content-type"].startswith("application/json")


@pytest.mark.parametrize("path", ["/API/me", "/Api/nope", "/api\\me", "/AUTH/nope", "/Health/x"])
def test_server_prefix_match_ignores_case_and_backslashes(spa_client, path):
    response = spa_client.get(path)

    assert response.status_code == 404
    assert response.text != INDEX_HTML


@pytest.mark.parametrize("path", ["/assets/missing.js", "/favicon-missing.png"])
def test_missing_files_stay_404_instead_of_the_index_page(spa_client, path):
    response = spa_client.get(path)

    assert response.status_code == 404
    assert response.text != INDEX_HTML


def test_unknown_auth_paths_do_not_fall_back_to_the_index_page(spa_client):
    response = spa_client.get("/auth/nope")

    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}


def test_health_is_not_shadowed_by_the_fallback(spa_client):
    response = spa_client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.parametrize("path", ["/..%2f..%2fpyproject.toml", "/%2e%2e/%2e%2e/pyproject.toml"])
def test_path_traversal_never_leaves_the_web_folder(spa_client, path):
    response = spa_client.get(path)

    assert "[project]" not in response.text
    assert response.status_code == 404 or (
        response.status_code == 200 and response.text == INDEX_HTML
    )


def test_posting_to_a_client_route_is_refused(spa_client):
    response = spa_client.post("/boards")

    assert response.status_code == 405


def test_config_returns_the_allowed_domain_without_a_session(client):
    response = client.get("/api/config")

    assert response.status_code == 200
    assert response.json() == {"allowed_hd": "example.com"}


def test_config_returns_null_when_no_domain_is_configured(db_url, monkeypatch):
    monkeypatch.setenv("ALLOWED_HD", "")
    with TestClient(create_app(db_url), base_url="http://localhost:8000") as client:
        response = client.get("/api/config")

    assert response.status_code == 200
    assert response.json() == {"allowed_hd": None}
