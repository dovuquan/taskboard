# T9 screenshots

Each screen in light and dark, the app (`-app.jpg`) beside the matching prototype view
(`-prototype.jpg`), at 1280x800. The app ran locally with `ALLOWED_HD=example.com` and invented demo
people and boards; the prototype shots show example.com in place of the domain it hard-codes
(changed in the browser only, `design/` is untouched).

| Screens | Viewer | Prototype View as |
| --- | --- | --- |
| `boards-admin-*` | Workspace admin: tiles and "Boards without an owner" | Workspace admin |
| `board-owner-*` | Board owner on an empty Workspace board | Board owner |
| `board-observer-*` | Observer row on the same board: banner, Board info | Observer |
| `settings-owner-*` | Board settings for the owner | Board owner |
| `settings-member-*` | Read-only Board info for a board member | Board member |

The prototype boards have lists and cards; the app's boards are empty until T10 and T11. Other
differences are logged in `docs/assumptions.md` (T9 rows).
