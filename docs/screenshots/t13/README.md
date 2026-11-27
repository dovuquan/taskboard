# T13 screenshots

These show the checklist, comments and activity in the card dialog, and the new tile badges, at
1280x800 (saved at 800x500).

The app ran locally with `ALLOWED_HD=example.com`, a throwaway database and invented people. Compare
them with the prototype's Board and Card screens (`design/taskboard-prototype.html`).

| Screen | Viewer | What it shows |
| --- | --- | --- |
| `board-owner-tiles-light-app` | Board owner | Tile badges: checklist `1/3` and two comments |
| `card-owner-light-app` | Board owner | Two columns: checklist with progress and a link; comments with "edited", Edit and Delete only on the viewer's own comment; activity from events |
| `card-observer-dark-app` | Observer | The same card, read-only: locked checkboxes, no add form, no comment box, no Edit or Delete |

## Checked by hand in the same run

- **Checklist:** add, check, delete; Undo brings the item back in its old place and still checked.
- **Comments:** editing your own comment shows "edited"; Close is blocked with "You have an unsent
  comment. Post or clear it first." while an edit is open.
- **Roles over the API:** an observer checking an item or posting a comment, and an owner editing a
  member's comment, all get 403 `forbidden`.
- **Activity:** every checklist add, check, delete and restore shows in the feed.
- **Found and fixed in this run:** the title field showed several times after a checklist change
  (two dialog parts shared one React key).
- **`docker compose up --build` on the existing volume:** the container starts, `taskboard check`
  inside it prints `integrity: ok` and `schema: 0006 (head)`, it serves the same web bundle as the
  screenshots (`index-AHFbC6yp.js`), and `GET .../feed` without a session answers 401
  `not_signed_in`.

## Not checked

- Signed-in screens inside the container: they need real Google sign-in, left for the owner at G2.
- The 24-hour edit window in the browser (covered by backend tests with a pinned clock).
- Phone width, screen readers.
