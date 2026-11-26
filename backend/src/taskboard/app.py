"""FastAPI application: the JSON API plus the built web app."""

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from starlette.exceptions import HTTPException as StarletteHTTPException

from taskboard import auth, boards, card_fields, cards, checklist, comments, lists, members
from taskboard.db import database_url, make_engine, run_migrations
from taskboard.settings import allowed_hd

log = logging.getLogger(__name__)

_REPO_WEB_DIST = Path(__file__).resolve().parents[3] / "web" / "dist"


def _web_dist() -> Path:
    return Path(os.environ.get("TASKBOARD_WEB_DIST", _REPO_WEB_DIST))


# Paths that belong to the server; an unknown one stays a 404 instead of the web page.
_SERVER_PREFIXES = ("api", "auth", "health")


def _is_server_path(path: str) -> bool:
    first = path.replace("\\", "/").strip("/").split("/", 1)[0]
    return first.lower() in _SERVER_PREFIXES


def _is_file_path(path: str) -> bool:
    """Paths under assets/ or ending in a file extension are files, never client routes."""
    clean = path.replace("\\", "/").strip("/")
    return clean.lower().startswith("assets/") or "." in clean.rsplit("/", 1)[-1]


class _SpaStaticFiles(StaticFiles):
    """Serve real files; unknown client routes get the one fixed index.html."""

    async def get_response(self, path, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404 or _is_server_path(path) or _is_file_path(path):
                raise
            return FileResponse(
                Path(self.directory) / "index.html",
                headers={"Cache-Control": "no-cache"},
            )


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

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_request: Request, exc: RequestValidationError):
        # FastAPI's own handler echoes each rejected value back. That would send a whole
        # description to the client again, and a lone surrogate in it cannot even be encoded
        # (a 500), so the echo (`input`, `ctx`) is dropped; type, location and message stay.
        errors = [{k: v for k, v in e.items() if k not in ("input", "ctx")} for e in exc.errors()]
        return JSONResponse({"detail": jsonable_encoder(errors)}, status_code=422)

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

    @app.get("/api/config")
    def public_config():
        # Public on purpose: the sign-in page shows the domain before anyone signs in.
        return {"allowed_hd": allowed_hd()}

    app.include_router(auth.router)
    app.include_router(members.router)
    app.include_router(boards.router)
    app.include_router(lists.router)
    app.include_router(cards.router)
    app.include_router(card_fields.router)
    app.include_router(checklist.router)
    app.include_router(comments.router)

    web_dist = _web_dist()
    if web_dist.is_dir():
        app.mount("/", _SpaStaticFiles(directory=web_dist, html=True), name="web")

    return app


app = create_app()
