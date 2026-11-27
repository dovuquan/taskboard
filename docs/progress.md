# Progress

One section per milestone, written at its gate: what was built, each Done-when check with the test
or command that proved it, differences from the prototype, and what was not verified. Decisions
taken without the owner, and every difference from the prototype, are in
[assumptions.md](assumptions.md).

## M1 Platform

Released at gate G1 on 20 Nov 2026: pull request #46, merge commit 356c39e, tag `m1`.

### Built

- Scaffold, Docker image and `scripts/ci.sh` (T1 #6).
- SQLite database, the Alembic migration for the five M1 tables, `GET /health` (T2 #7).
- Events helper: every change writes its `events` row in the same transaction (T3 #8).
- Google OIDC sign-in with domain, verification, nonce, state and PKCE checks; 14-day hashed
  sessions; `auth_events` for every attempt (T4 #9).
- `taskboard migrate | admin --email | seed | check` (T5 #10).
- Members API with admin-only role changes, last-admin and self-change guards, and the refused
  sign-ins feed (T6 #11).
- Sign in, Sign-in refused, the app bar with Sign out, the Boards empty state and Workspace members
  screens, in light and dark (T7 #12, T8 #13, #42).
- Follow-ups from the per-ticket reviews: #22, #23, #27–#31, #33, #43.

### Checks

Run on `dev` at 77bb29f on 20 Nov 2026.

| M1 Done-when check | Proved by |
| --- | --- |
| `docker compose up --build` serves the app; `/health` returns `{"status":"ok"}` | `docker compose up --build`, then `curl localhost:8000/health` |
| Fake-verifier sign-in creates a member and redirects to `/boards` | `test_auth.py` |
| Each refusal case (wrong or missing hd, unverified email, wrong aud, expired, nonce, state) writes its `auth_events` reason | `test_auth.py` |
| The same `sub` with a changed email reaches the same user | `test_auth.py` |
| `taskboard admin --email` before and after the first sign-in | `test_cli.py` |
| Member PATCH → 403, own role → 409, last admin → 409 | `test_members.py` |
| A role change writes one event; a forced failure leaves neither | `test_members.py`, `test_events.py` |
| Session cookie HttpOnly and SameSite=Lax, only the hash stored, logout deletes it | `test_auth.py` |
| `git ls-files` holds no `.env`; `.env.example` has placeholders only | `git ls-files` |
| `scripts/ci.sh` exits 0 | `scripts/ci.sh`: pytest 145 passed, Vitest 172 passed |
| Real sign-in accepted, a personal account refused | Owner run, `docs/screenshots/g1/` |
| Screens match the prototype tiles in light and dark | `docs/screenshots/t7/`, `docs/screenshots/t8/` |

### Differences from the prototype

The T1–T8 rows of [assumptions.md](assumptions.md).

### Not verified

Nothing left open at G1.

## M2 Boards

Released at gate G2 on 27 Nov 2026: pull request #57, merge commit 978105b.

### Built

- Boards: create, Workspace or Private, rename, members and roles, the last-owner guard, Ownerless
  boards for admins (T9 #14).
- Lists: add, rename, drag reorder with fractional order, archive with Undo, the 50-list limit
  (T10 #15).
- Cards: add, drag between lists, the stale-move 409 "This card moved", copy, the 1,000-card limit
  (T11 #16).
- Card detail with its own link: title, Markdown description (sanitised), people, labels, due date
  (T12 #17).
- Checklist, comments (author only, 24 hours) and the card activity feed (T13 #18).
- Archive and restore boards, lists and cards; the Archived view; Archived boards (T14 #19).
- `taskboard seed` fills an invented sample board (T17 #50).
- G2 evidence: the list restore test and card detail in both themes (T18 #55).

### Checks

Run on `dev` at 16c6ccc on 27 Nov 2026.

| M2 Done-when check | Proved by |
| --- | --- |
| `docker compose up --build` on `dev` serves M1 plus Boards, Board, Card detail and Board settings | `docker compose up --build`; `taskboard check` prints `integrity: ok` and `schema: 0007 (head)`; signed-in screens need real Google sign-in (owner check in #57) |
| Role matrix: owner, member, observer, outsider on Workspace and on Private, admin × boards, lists, cards, card fields, checklist, comments, archive | `test_role_matrix` in `test_boards.py`, `test_lists.py`, `test_cards.py`, `test_card_fields.py`, `test_checklist.py`, `test_comments.py`; five archive matrices in `test_archive.py` |
| A Private board is absent from `GET /api/boards` and 404 for outsiders; an admin sees it only in Ownerless boards | `test_boards.py` |
| Removing or demoting the last owner returns 409 | `test_boards.py` |
| The 51st list and the 1,001st card are refused with 422; titles over 200, names over 80 and descriptions over 10,000 characters are refused | `test_lists.py`, `test_cards.py`, `test_boards.py`, `test_card_fields.py` |
| A stale card move returns 409 with the new position; the web app shows "This card moved" | `test_cards.py`, `cards/move.test.ts`, `cards/text.test.ts` |
| A refused save rolls the web app back and shows an error | `cards/logic.test.ts`, `cards/move.test.ts` |
| Script tags, event handlers and `javascript:` links are stripped from descriptions | `test_card_fields.py`, `test_markdown.py`, `Markdown.test.tsx` |
| An observer cannot be assigned; comments are edited or deleted only by the author within 24 hours | `test_card_fields.py`, `test_comments.py` |
| Archiving a list archives its cards; restore brings both back; archived items are absent from lists, counts and the card link | `test_lists.py::test_archiving_a_list_hides_its_cards_everywhere_and_restore_brings_them_back`, `test_cards.py`, `test_archive.py` |
| Every M2 change writes exactly one events row in the same transaction, and the activity feed shows it | Events: the role matrices and `test_events.py`. The feed is per card and shows card, checklist and comment events (see Differences) |
| `taskboard seed` adds one invented sample board with lists, cards and labels | `test_seed.py`, `test_cli.py`; run in the container |
| `scripts/ci.sh` exits 0 | `scripts/ci.sh`: pytest 1431 passed, Vitest 984 passed |
| Boards, Board, Card detail and Board settings match their prototype tiles in light and dark | `docs/screenshots/t9/`, `t12/`, `t13/`, `t18/`, `t14/` |

### Differences from the prototype

The T9–T18 rows of [assumptions.md](assumptions.md). The largest:

- The activity feed is per card; board and list events are stored in `events` but shown in no feed
  (T13 row).
- The card move toast waits for the server and has no Undo; Undo toasts for card moves are left to
  M3 (T11 row).
- An archived Private board whose last owner left cannot be restored; the seed guards only its
  first list (T14 and T17 rows).

### Not verified

- Signed-in screens inside the Docker container and phone width were not checked by the build
  session; they need real Google sign-in and were listed as the owner check in #57.

## M3 Polish

Filled at gate G3.
