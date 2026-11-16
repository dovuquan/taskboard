#!/usr/bin/env bash
# Run every check: backend lint and tests, then web lint, typecheck and tests.
# Stops at the first failing check and exits non-zero.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

step() {
  local dir="$1"
  shift
  echo "==> $* (in $dir)"
  if ! (cd "$root/$dir" && "$@"); then
    echo "FAILED: $*" >&2
    exit 1
  fi
}

step backend uv run ruff check .
step backend uv run pytest
step web pnpm install --frozen-lockfile
step web pnpm lint
step web pnpm typecheck
step web pnpm test

echo "All checks passed."
