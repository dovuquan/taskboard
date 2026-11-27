# T18 screenshots

These fill the two card detail views the G2 audit found missing, at 1280x800 (saved at 800x500).
Together with `t13/card-owner-light-app` and `t13/card-observer-dark-app`, the card detail now has
owner and observer views in both themes.

The app ran locally from `dev` (187798c) with `ALLOWED_HD=example.com` and a throwaway database:
`taskboard migrate`, then `taskboard seed`, then test sessions for the seed owner and for a second seed
person whom the owner made an observer through the API. Every name is one of the five invented seed
people.

| Screen | Viewer | What it shows |
| --- | --- | --- |
| `card-owner-dark-app` | Board owner | TB-5 in dark: people, label, due date with "Due soon", checklist at 2/4 with Add, comment box, activity |
| `card-observer-light-app` | Observer | TB-5 in light, read-only: no add buttons, locked checklist, "Observers can read comments but not post." |

## Not checked

- Signed-in screens inside the Docker container (they need real Google sign-in), phone width.
