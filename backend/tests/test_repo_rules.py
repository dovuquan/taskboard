import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.skipif(shutil.which("git") is None, reason="git is not installed")
def test_the_company_domain_is_not_named_outside_design():
    needle = "as" + "net"  # not spelled out here, so this file does not match itself
    result = subprocess.run(
        ["git", "grep", "-il", needle, "--", ".", ":!design"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if result.returncode not in (0, 1):
        pytest.skip("not a git checkout")
    assert result.stdout == ""
