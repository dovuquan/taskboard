# Taskboard design reference

Read-only reference for the build. Do not edit files in `design/`.

| File | What it is |
|---|---|
| `taskboard-prototype.html` | The clickable prototype, round 4 (13 Nov 2026). Open it in a browser and start at **All screens**. |
| `tokens.css` | Colors, spacing, radii, shadows and type from the prototype, light and dark. Turn it into the app theme. |

Build plan: https://claude.ai/artifact/YHk8KfjB6T9zWz2uEqSyvd
Prototype review and tickets: https://claude.ai/artifact/DE1cMSbPG9Zpzx4tnzpWKh
Live prototype: https://claude.ai/artifact/PqAuSahWYrjzsFpusJ3vQ3

## Precedence

- The **plan** wins on data, permissions and limits.
- The **prototype** wins on look and interaction: layout, spacing, colors, type, icons, wording, empty
  states, keyboard and motion.
- When they disagree in a way these rules cannot settle, stop and ask.

## How to use it

- Recreate screens with real components. Do not copy the prototype's script.
- **View as** (top strip) shows what each role sees: workspace admin, board owner, member, observer.
  Build the same differences and enforce them on the server.
- The **Prototype** tab on the right edge switches the scenario (busy, trouble, crowded, just
  installed, empty, signed out), the latency (instant, typical, slow, never answers) and faults
  (reads fail, saves fail, unreachable, session expired). Every screen state the app needs is
  shown there; build each one from real requests.
- **Trouble** also shows a board at its 1,000-card limit, a Private board without an owner (admins
  take ownership), and a card someone else moved first ("This card moved").
- Copy for failure and loss is short and says what is kept, e.g. "Your change was undone",
  "Nothing is deleted."

## Screen index by milestone

| Milestone | Screens (prototype hash) |
|---|---|
| M1 Platform | Sign in (`#sign-in`), Sign-in refused (`#refused`), Workspace members with refused sign-ins (`#members`), Boards empty state (`#boards` in the "Just installed" scenario) |
| M2 Boards | Boards with Archived boards and Boards without an owner (`#boards`), Board with list menu, list drag and Add list (`#board`), Card detail with its own link and comment edit (`#card/TB-14`), Board settings and members (`#board-settings`), Archived items (`#archived`) |
| M3 Polish | Filter cards (`#filter`), Keyboard shortcuts (`#shortcuts`), Undo toasts, loading and error states (prototype panel) |

## What the prototype only pretends

- Google sign-in: the button just opens the boards list.
- Saving: changes live in the page and reset on reload.
- Other people: nobody else sees your changes. The real board reloads on tab focus and every 30
  seconds; here only the Trouble scenario shows a card someone else moved.
- The server: scenarios, latency and faults are faked in the page.

## Decisions shown in round 4 (from the prototype review grill, 13 Nov 2026)

- Archive is soft: archived lists and cards appear under **Archived** on the board, archived boards
  under **Archived boards** on the Boards page; owners and admins restore them. Nothing is deleted.
- Board settings adds only existing workspace members (search by name or email, no free email).
- A board keeps at least one owner; a workspace keeps at least one admin.
- A workspace admin acts as owner on every board they can see; Private boards they are not on stay
  hidden, except ownerless ones in **Boards without an owner**.
- People not on a Workspace board see it as **Observer**.
- Own comments can be edited or deleted within 24 hours; edits show "edited".
- Lists reorder by drag. Due dates have no special Done rule.
- The session-expired screen promises no admin action; the refused page names no admin.
- Limits: 1,000 cards and 50 lists per board, 80-character board and list names.
