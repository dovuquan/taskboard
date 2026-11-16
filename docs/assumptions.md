# Assumptions and differences from the plan

Each row says what was decided, why, and which ticket it came from.

| Ticket | Decision | Why |
|---|---|---|
| T1 | Tailwind and shadcn/ui are not installed yet; they arrive with the web screens ticket. | T1 has no styled screens; the theme comes from `design/tokens.css` there. |
| T1 | `GET /health` returns `{"status":"ok"}` without a database round trip. | There is no database in T1; the Database ticket adds the round trip (done in T2). |
| T1 | Added `uvicorn`, `httpx` (backend dev), `eslint` and `typescript-eslint` beyond the plan's list (approved by the owner). Also `@vitejs/plugin-react`, `@types/react`, `@types/react-dom` (part of Vite + React + TypeScript) and the `uv_build` build backend. | Needed to serve the app, run FastAPI's TestClient, and run `pnpm lint`. |
| T1 | TypeScript is pinned to `~6.0`. | `typescript-eslint` 8.72 supports TypeScript `<6.1`. |
| T1 | Python is pinned to 3.12 (`backend/.python-version`, `python:3.12-slim`). | One version for local runs and the image. |
| T1 | `scripts/ci.sh` also runs `pnpm install --frozen-lockfile` and stops at the first failing check. | A clean checkout has no `node_modules`; stopping early keeps the first error visible. |
| T1 | The Vite dev server proxies `/auth` and `/health` as well as `/api`. | Sign-in routes live under `/auth`. |
| T2 | Added `sqlalchemy` and `alembic`, both named in the plan. | Models and migrations. |
| T2 | Keys: integer `id` on `users`, `auth_events` and `events`; `workspace_members.user_id` is its primary key (one row per user); `sessions.id_hash` is its primary key. Times are naive UTC `DateTime`; `events.data` is JSON. | The plan lists key columns only, not types. |
| T2 | Check constraints: `workspace_members.role` in (admin, member); `auth_events.outcome` in (accepted, refused). `events.actor_id` is a nullable foreign key. | Keeps bad roles and outcomes out at the database level; system events have no actor. |
| T2 | The database URL comes from `TASKBOARD_DATABASE_URL`, default `sqlite:////data/taskboard.db`. Tests set it to a temp file and pass temp URLs explicitly. | The Docker volume is mounted at `/data`; tests must never touch it. |
| T2 | Migrations live in the package (`taskboard/migrations`) and run in the app's startup lifespan. `GET /health` returns 503 `{"status":"unavailable"}` when the database cannot be read. | The image has no separate Alembic config; a failing health check should not say ok. |
| T3 | `record_change(session, change, ...)` in `taskboard/events.py` commits the change and its event together, and refuses a session that already has pending changes. `subject_id` is a string. | One helper owns the transaction, so no write can slip in without an event. |
