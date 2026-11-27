# T12 screenshots

These show card tiles and the card dialog, at 1280x800 (saved at 800x500) and 375x812.

The app ran locally with `ALLOWED_HD=example.com`, a throwaway database and invented people. Compare
them with the prototype's Board and Card screens (`design/taskboard-prototype.html`).

| Screen | Viewer | What it shows |
| --- | --- | --- |
| `board-owner-tiles-light-app` | Board owner | Tiles with labels, due chip, description mark and avatars |
| `card-owner-light-app` | Board owner | The card dialog: members, labels, due date with Overdue, description |
| `card-observer-dark-app` | Observer | The same card, read-only |
| `card-owner-mobile-light-app` | Board owner | A 200-character title wrapping at 375 px |

## Checked by hand in the same run

- **Link:** signed out shows Sign in; `tb-2` (wrong case) shows "This card isn't on the board".
- **Hostile description:** script, `onerror` and `javascript:` text was stored without them. A label that
  poses as another address shows the real host.
- **Keyboard:** focus moves into the dialog and back to the tile; Enter opens a tile; Esc closes a popup
  first.
- **Drafts:** kept across cards and Back, after the person becomes an observer, after the session ends
  (Copy card), and after the list is archived.
- **Due date:** a half-typed year is not saved; Back right after picking a date saves it.
- **Move to and Copy card** from the menu; a drag to another list does not open the card.

## Not checked

- Drags used synthetic drag events, not a real mouse.
- Copy link's clipboard, screen readers, `docker compose` and real Google sign-in.
