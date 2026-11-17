"""FastAPI application: the JSON API plus the built web app."""

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from taskboard import auth, members
from taskboard.db import database_url, make_engine, run_migrations

log = logging.getLogger(__name__)

_REPO_WEB_DIST = Path(__file__).resolve().parents[3] / "web" / "dist"


def _web_dist() -> Path:
    return Path(os.environ.get("TASKBOARD_WEB_DIST", _REPO_WEB_DIST))


def create_app(url: str | None = None) -> FastAPI:
    url = url or database_url()
    engine = make_engine(url)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        run_migrations(url)
        yield
        engine.dispose()

    app = FastAPI(title="Taskboard", lifespan=lifespan)
    app.state.engine = engine

    @app.get("/health")
    def health():
        try:
            with app.state.engine.connect() as conn:
                conn.execute(text("SELECT 1")).scalar_one()
        except Exception as exc:
            # Class name and the driver's own message only: no URL, no traceback.
            cause = getattr(exc, "orig", None) or exc
            log.warning("health check failed: %s: %s", type(exc).__name__, cause)
            return JSONResponse({"status": "unavailable"}, status_code=503)
        return {"status": "ok"}

    app.include_router(auth.router)
    app.include_router(members.router)

    web_dist = _web_dist()
    if web_dist.is_dir():
        app.mount("/", StaticFiles(directory=web_dist, html=True), name="web")

    return app


app = create_app()
