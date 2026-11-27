# T14 screenshots

These show archive and restore at 1280x800 (saved at 800x500).

The app ran locally with `ALLOWED_HD=example.com` and a throwaway database: `taskboard migrate`, then
`taskboard seed`, then a test session for the seed owner. Every name on the board is one of the five
invented seed people.

| Screen | Viewer | What it shows |
| --- | --- | --- |
| `board-archived-count-light-app` | Seed owner | Office move after TB-9 was archived: "Done" counts 1 card and the header shows "Archived (1)" |
| `archived-view-light-app` | Seed owner | The Archived view with the list "Done" (2 cards) and the card TB-5, each with Restore |
| `archive-board-confirm-light-app` | Seed owner | Board settings with the "Archive this board" confirm step |
| `archived-boards-light-app` | Seed owner | The Boards page after archiving: "Archived boards" with Restore, and the toast with Undo |

## Checked by hand

- Archive card TB-5 from the card menu: the tile leaves, the lane count drops, "Archived (1)" appears and
  the toast offers Undo.
- Archive the list "Done": "Archived (2)"; the card link `/boards/1/cards/TB-5` shows "This card isn't on
  the board".
- Restore the list from the Archived view: "Restored Done with its 2 cards", both cards back. Restore TB-5:
  "Restored TB-5 to Doing". The view then shows "Nothing is archived on this board".
- Archive the board from settings: the Boards page lists it under "Archived boards"; Restore and the
  toast's Undo both bring it back ("Restored Office move").

## Not checked

- Signed-in screens inside the Docker container (they need real Google sign-in), phone width, dark theme.
