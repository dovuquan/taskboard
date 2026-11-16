"""FastAPI application: the JSON API plus the built web app."""

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

_REPO_WEB_DIST = Path(__file__).resolve().parents[3] / "web" / "dist"


def _web_dist() -> Path:
    return Path(os.environ.get("TASKBOARD_WEB_DIST", _REPO_WEB_DIST))


def create_app() -> FastAPI:
    app = FastAPI(title="Taskboard")

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    web_dist = _web_dist()
    if web_dist.is_dir():
        app.mount("/", StaticFiles(directory=web_dist, html=True), name="web")

    return app


app = create_app()
