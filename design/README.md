# Taskboard design reference

Read-only reference for the build. Do not edit files in `design/`.

| File | What it is |
|---|---|
| `taskboard-prototype.html` | The clickable prototype, round 3 (12 Nov 2026). Open it in a browser and start at **All screens**. |
| `tokens.css` | Colors, spacing, radii, shadows and type from the prototype, light and dark. Turn it into the app theme. |

Build plan: https://claude.ai/artifact/YHk8KfjB6T9zWz2uEqSyvd
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
- Copy for failure and loss is short and says what is kept, e.g. "Your change was undone",
  "Nothing is deleted."

## Screen index by milestone

| Milestone | Screens (prototype hash) |
|---|---|
| M1 Platform | Sign in (`#sign-in`), Sign-in refused (`#refused`), Workspace members (`#members`), Boards empty state (`#boards` in the "Just installed" scenario) |
| M2 Boards | Boards (`#boards`), Board with list menu and Add list (`#board`), Card detail with its own link (`#card/TB-14`), Board settings and members (`#board-settings`) |
| M3 Polish | Filter cards (`#filter`), Keyboard shortcuts (`#shortcuts`), Undo toasts, loading and error states (prototype panel) |

## What the prototype only pretends

- Google sign-in: the button just opens the boards list.
- Saving: changes live in the page and reset on reload.
- Other people: nobody else sees your changes; live updates are Later in the plan.
- The server: scenarios, latency and faults are faked in the page.

## Decisions the prototype made (Assumed, listed in the plan)

- Admins see refused sign-ins of the last 7 days on the Members page.
- Archiving a list archives its cards with it, with Undo; nothing is deleted.
- Checklist items can be deleted (with Undo); "Hide checked items" is a per-viewer view choice.
- Each card has its own link; a link to an archived or missing card says so.
- Long links show host and the start of the path; the full address is in the tooltip.
- The card members picker gets a search box above 8 assignable people.
- Ctrl/⌘+Enter posts a comment or saves the description.
- Every save shows at once and is undone with a short message if the server refuses it.
