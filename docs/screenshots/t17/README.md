# T17 screenshots

These show the sample board that `taskboard seed` fills, at 1280x800 (saved at 800x500).

The app ran locally with `ALLOWED_HD=example.com` and a throwaway database: `taskboard migrate`, then
`taskboard seed`, then a test session for the seed owner. Every name on the board is one of the five
invented seed people.

| Screen | Viewer | What it shows |
| --- | --- | --- |
| `board-seeded-light-app` | Seed owner | Office move: 3 lists, 9 cards with all 7 labels, due dates (one overdue, one soon), checklist and comment badges, people |
| `card-seeded-light-app` | Seed owner | TB-5: people, a label, "Due soon", a checklist at 2/4, a seeded comment and the activity by "Taskboard" |

## Checked by hand

- **Fresh database:** `migrate`, `seed` (three lines: 5 members, the board, 3 lists and 9 cards), `seed`
  again (`seeded 0 new member(s)` only), `check` (`integrity: ok`, `schema: 0006 (head)`).
- **`docker compose up --build`, existing volume:** the same three lines, the same second-run line, and
  the same `check` output inside the container.

## Not checked

- Signed-in screens inside the container (they need real Google sign-in), phone width.
