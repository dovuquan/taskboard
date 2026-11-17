# Taskboard

Training demo of a kanban app for a Google Workspace domain (`ALLOWED_HD`, `example.com` in the repo). FastAPI + SQLite backend that also
serves a React/TypeScript web app. Runs locally with `docker compose up` at http://localhost:8000.

The build plan (Claude Doc, the only spec): https://claude.ai/artifact/YHk8KfjB6T9zWz2uEqSyvd
The design reference: `design/` (prototype, `tokens.css`, `README.md` with the screen index).

## Rules

- Build one milestone at a time. Do not start the next until every Done-when check of the current
  one passes.
- Tie-break: when demo simplicity and feature parity conflict, simplicity wins. The plan wins on
  data, permissions and limits; `design/` wins on look and interaction. Log every difference in
  `docs/assumptions.md`.
- Sign-in is Google OIDC only. Accept only verified accounts with `hd == ALLOWED_HD` (the domain comes from `.env`; the repo says `example.com`). Identify
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
  `fix/tb-<n>-<slug>`, `chore/<slug>`.
- Tickets are GitHub issues in `dovuquan/taskboard` (title `T<n>: <title>`, milestone M1, M2
  or M3). Work only on a ticket that has an issue; if there is none, stop and ask for one.
  Every commit ends with a `Refs: #<issue>` footer line before the `Co-Authored-By` trailer,
  and the pull request body starts with `Closes #<issue>` so merging closes it.
- Branch flow: `dev` is the integration branch and `main` holds released milestones only.
  Every ticket branches from `dev` and opens its pull request into `dev`; the owner merges it.
  At each milestone gate (G1, G2, G3) the owner checks `dev` with `docker compose up --build`
  and the milestone's Done-when checks, then merges a `dev` → `main` pull request and tags
  `m1`, `m2` or `m3`.
- Push only your own feature branch, to open or update its pull request. Never push `dev` or
  `main` directly, never force-push, never merge pull requests yourself.
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
