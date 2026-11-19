# G1 manual sign-in check

M1 Done-when: the owner signs in once with a real Workspace account and once with a personal
Gmail account (refused). Run on 19 Nov 2026 against `dev` with `docker compose up --build` and a
real Google sign-in.

| Screenshot | Attempt | Result | `auth_events` row |
| --- | --- | --- | --- |
| `signin-workspace-accepted.jpg` | Workspace account on the allowed domain | Lands on Boards (empty), signed in | `accepted` |
| `signin-gmail-refused.jpg` | Personal Gmail account | Sign-in refused page, reason "not an … Workspace account" | `refused`, `missing_hd` |

Grey blocks cover the company domain and the owner's name, which the repository does not hold
(the domain lives only in `.env`). Nothing else was changed in the screenshots.

The accepted sign-in matched the existing user by Google `sub`, so no new user was created; the
refused sign-in created no user and no session.
