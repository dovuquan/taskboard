# T10 screenshots

The board page with lists, in light and dark, at 1280x800 (saved at 800x500). The app ran locally
with `ALLOWED_HD=example.com`, invented demo people and one Workspace board with four lists. Compare
with the prototype's Board screen (`design/taskboard-prototype.html`, View as Board owner and
Observer).

| Screens | Viewer | What it shows |
| --- | --- | --- |
| `board-owner-menu-*` | Board owner | Lanes with drag grips, the open list menu (Rename list, Archive list) and Add list |
| `board-observer-*` | Observer row on the same board | The banner and the lanes with no grip, menu or Add list |

Checked by hand in the same run: add a list, rename from the menu, archive with the Undo toast
("Archived Review. Nothing is deleted.", then "Restored Done" after Undo), and drag a list to the
front (the screen and `GET /api/boards/1/lists` agree). The lanes have no cards until T11. Other
differences are logged in `docs/assumptions.md` (T10 rows).
