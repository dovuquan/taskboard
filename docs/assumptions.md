# Assumptions and differences from the plan

Each row says what was decided, why, and which ticket it came from.

| Ticket | Decision | Why |
|---|---|---|
| T1 | Tailwind and shadcn/ui are not installed yet; they arrive with the web screens ticket. | T1 has no styled screens; the theme comes from `design/tokens.css` there. |
| T1 | `GET /health` returns `{"status":"ok"}` without a database round trip. | There is no database in T1; the Database ticket adds the round trip. |
| T1 | Added `uvicorn`, `httpx` (backend dev), `eslint` and `typescript-eslint` beyond the plan's list (approved by the owner). Also `@vitejs/plugin-react`, `@types/react`, `@types/react-dom` (part of Vite + React + TypeScript) and the `uv_build` build backend. | Needed to serve the app, run FastAPI's TestClient, and run `pnpm lint`. |
| T1 | TypeScript is pinned to `~6.0`. | `typescript-eslint` 8.72 supports TypeScript `<6.1`. |
| T1 | Python is pinned to 3.12 (`backend/.python-version`, `python:3.12-slim`). | One version for local runs and the image. |
| T1 | `scripts/ci.sh` also runs `pnpm install --frozen-lockfile` and stops at the first failing check. | A clean checkout has no `node_modules`; stopping early keeps the first error visible. |
| T1 | The Vite dev server proxies `/auth` and `/health` as well as `/api`. | Sign-in routes live under `/auth`. |
