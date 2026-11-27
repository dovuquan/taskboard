# T11 screenshots

These show the board page with cards, in light and dark, at 1280x800 (saved at 800x500).

The app ran locally with `ALLOWED_HD=example.com`, invented demo people and one Workspace board
with four lists and seven cards. Compare them with the prototype's Board screen
(`design/taskboard-prototype.html`, View as Board owner and Observer).

| Screen | Viewer | What it shows |
| --- | --- | --- |
| `board-owner-card-moved-light-app` | Board owner | Card tiles with keys and lane counts, Add a card, and the "This card moved" toast after a stale drag |
| `board-owner-composer-dark-app` | Board owner | The open card composer (Card title, Add card, Cancel, "Enter to add · Esc to close") |
| `board-observer-{light,dark}-app` | Observer on the same board | The banner and the cards, with no drag, Add a card or lane menu |

## Checked by hand in the same run

- **Add a card:** a card added from the composer gets the next key (TB-7) and stays at the end of its
  list. The composer stays open after the add, and Esc closes it.
- **Drag:** dragging a card to another list shows "Moved TB-1 to Done", and the screen and
  `GET /api/boards/1/cards` agree.
- **Stale drag:** the card was first moved through the API, then dragged from the old screen. The
  result was a 409. The card went to the list the server named, right after its neighbour, and the
  toast read "This card moved. Ada Park put it in Review a moment ago; it is shown there now."
- **30-second reload:** while the tab stayed open, it picked up a move made through the API.
- **Observer:** no draggable cards, no Add a card button and no lane menu.

## Not checked

- Drags used synthetic drag events, not a real mouse.
- Copy has no button until T12, so it was tested through the API tests only.
