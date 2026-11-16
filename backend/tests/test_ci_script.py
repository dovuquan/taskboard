"""scripts/ci.sh runs every check in order and exits non-zero when any fails.

The real uv and pnpm are replaced by fakes on PATH that log their arguments
and fail when asked, so these tests stay fast and touch nothing.
"""

import os
import subprocess
from pathlib import Path

import pytest

CI_SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "ci.sh"

EXPECTED_STEPS = [
    "uv run ruff check .",
    "uv run pytest",
    "pnpm install --frozen-lockfile",
    "pnpm lint",
    "pnpm typecheck",
    "pnpm test",
]

FAKE_TOOL = """#!/usr/bin/env bash
line="$(basename "$0") $*"
echo "$line" >> "$FAKE_LOG"
[ "$line" = "$FAKE_FAIL" ] && exit 3
exit 0
"""


def run_ci(tmp_path: Path, fail: str = "") -> tuple[subprocess.CompletedProcess, list[str]]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for tool in ("uv", "pnpm"):
        fake = bin_dir / tool
        fake.write_text(FAKE_TOOL)
        fake.chmod(0o755)
    log = tmp_path / "calls.log"
    env = {
        **os.environ,
        "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
        "FAKE_LOG": str(log),
        "FAKE_FAIL": fail,
    }
    result = subprocess.run(
        ["bash", str(CI_SCRIPT)], env=env, capture_output=True, text=True, check=False
    )
    calls = log.read_text().splitlines() if log.exists() else []
    return result, calls


def test_ci_runs_every_check_in_order_and_exits_zero(tmp_path):
    result, calls = run_ci(tmp_path)

    assert result.returncode == 0, result.stdout + result.stderr
    assert calls == EXPECTED_STEPS


@pytest.mark.parametrize("failing_step", EXPECTED_STEPS)
def test_ci_exits_non_zero_when_a_check_fails(tmp_path, failing_step):
    result, calls = run_ci(tmp_path, fail=failing_step)

    assert result.returncode != 0
    assert calls == EXPECTED_STEPS[: EXPECTED_STEPS.index(failing_step) + 1]
    assert f"FAILED: {failing_step}" in result.stderr
