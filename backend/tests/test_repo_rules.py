import re
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


def test_web_tokens_match_the_design_tokens():
    web = ROOT / "web" / "src" / "styles" / "tokens.css"
    assert web.is_file(), "web/src/styles/tokens.css is missing"
    assert web.read_bytes() == (ROOT / "design" / "tokens.css").read_bytes()


KNOWN_REFUSAL_CODES = {
    "wrong_domain",
    "missing_hd",
    "email_unverified",
    "state_mismatch",
    "nonce_mismatch",
    "expired_token",
    "oauth_error",
    "bad_token",
    "wrong_aud",
    "email_conflict",
}


def test_every_refusal_code_the_backend_emits_is_mapped_in_the_web_app():
    source = (ROOT / "backend" / "src" / "taskboard" / "auth.py").read_text()
    emitted = set(re.findall(r"""_Refused\(\s*["'](\w+)["']""", source))
    emitted |= set(re.findall(r"""_refuse\(\s*\w+\s*,\s*["'](\w+)["']""", source))
    assert emitted == KNOWN_REFUSAL_CODES

    web = ROOT / "web" / "src" / "auth" / "refusal.ts"
    assert web.is_file(), "web/src/auth/refusal.ts is missing"
    mapped = web.read_text()
    for code in sorted(emitted):
        assert re.search(rf"""["']{code}["']""", mapped), f"{code} is not mapped in refusal.ts"
