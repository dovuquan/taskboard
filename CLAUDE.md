# Taskboard

Training demo of a kanban app for the asnet.com.vn workspace. FastAPI + SQLite backend that also
serves a React/TypeScript web app. Runs locally with `docker compose up` at http://localhost:8000.

The build plan (Claude Doc, the only spec): https://claude.ai/artifact/YHk8KfjB6T9zWz2uEqSyvd
The design reference: `design/` (prototype, `tokens.css`, `README.md` with the screen index).

## Rules

- Build one milestone at a time. Do not start the next until every Done-when check of the current
  one passes.
- Tie-break: when demo simplicity and feature parity conflict, simplicity wins. The plan wins on
  data, permissions and limits; `design/` wins on look and interaction. Log every difference in
  `docs/assumptions.md`.
- Sign-in is Google OIDC only. Accept only verified accounts with `hd == asnet.com.vn`. Identify
  people by Google `sub`. Log every attempt in `auth_events`.
- Every state change writes an `events` row in the same transaction.
- Roles: workspace admin/member; board owner/member/observer. Enforce them on the server and test
  each one.
- Secrets (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`) live only in `.env`.
  Never write them to the repo, logs or chat.
- Clean-room: never name another product anywhere; work only from the plan and `design/`;
  permissive licenses only.
- Never edit `design/`.
- Conventional Commits, keep the `Co-Authored-By` trailer, branches `feat/tb-<n>-<slug>`,
  `fix/tb-<n>-<slug>`, `chore/<slug>`. Never push unless asked.
- Use pnpm for the web app, never npm. Use uv for the backend.
- Stop and ask only for: the Google Cloud step, machine changes outside the repo, a check that
  cannot pass, destructive or outward-facing actions.

## Commands

- `scripts/ci.sh`: ruff, pytest, pnpm lint, typecheck, test. Run before every commit, without a
  pipe that hides the exit code.
- `docker compose up --build`: run the app at http://localhost:8000.
- `cd backend && uv run taskboard <migrate|admin --email|seed|check>`.
- `cd web && pnpm dev`: web at http://localhost:5173 with `/api` proxied to 8000.

## Claude Code setup in this repo

- Agents in `.claude/agents/` (read-only, they report and never edit):
  - `planner`: turns the next milestone of the plan plus its prototype screens into an ordered
    task list with tests first. Use before starting a milestone.
  - `reviewer`: pre-PR review of the diff against the base branch and these rules.
  - `security`: review of sign-in, sessions, roles and permissions, API input and secrets.
- Hook `fmt-on-edit` (`.claude/hooks/fmt-on-edit.sh`): after every Edit/Write, formats the file
  (ruff for `backend/**/*.py`, prettier for `web/**`). It skips `design/` and never blocks.
- Permissions (`.claude/settings.json`): tests, lint, formatting and read-only git run without a
  prompt; `git push`, dependency changes and `docker compose down` ask first; `.env` reads, edits
  to `design/`, `sudo`, `rm -rf`, force push and `npm` are blocked.
