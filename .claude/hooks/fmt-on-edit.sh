#!/usr/bin/env bash
# fmt-on-edit: PostToolUse hook. Formats the file Claude just edited or wrote.
# - backend/**/*.py      -> ruff format (via uv, inside backend/)
# - web/** (ts/tsx/js/jsx/css/json/md) -> prettier (from web/node_modules, via pnpm)
# Skips design/ (read-only) and anything outside the repository.
# Never blocks: it always exits 0, and a missing formatter is skipped silently.

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
file="$(/usr/bin/python3 -c 'import json,sys
try:
    d = json.load(sys.stdin)
    print((d.get("tool_input") or {}).get("file_path", ""))
except Exception:
    print("")')"

[ -n "$file" ] || exit 0
[ -f "$file" ] || exit 0
case "$file" in
  "$root"/*) rel="${file#"$root"/}" ;;
  *) exit 0 ;;
esac

case "$rel" in
  design/*) exit 0 ;;
  backend/*.py)
    if [ -f "$root/backend/pyproject.toml" ] && command -v uv >/dev/null 2>&1; then
      (cd "$root/backend" && uv run --quiet ruff format --quiet "$file") >/dev/null 2>&1
    fi ;;
  web/*.ts|web/*.tsx|web/*.js|web/*.jsx|web/*.css|web/*.json|web/*.md)
    if [ -x "$root/web/node_modules/.bin/prettier" ] && command -v pnpm >/dev/null 2>&1; then
      pnpm --dir "$root/web" exec prettier --write --log-level silent "$file" >/dev/null 2>&1
    fi ;;
esac
exit 0
