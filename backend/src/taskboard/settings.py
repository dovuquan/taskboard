"""Settings read from the environment (the Docker image gets them from `.env`)."""

import os


def allowed_hd() -> str | None:
    """The Google Workspace domain people must belong to; None when not configured."""
    value = os.environ.get("ALLOWED_HD", "").strip().lower()
    return value or None
