"""Google sign-in (OIDC code flow with PKCE), sessions and `GET /api/me`.

The only door is the ID token's `hd` claim equal to `ALLOWED_HD` with a verified email. The email
suffix is never the check and the `hd` login hint is never sent or trusted. Everything that talks
to Google sits behind `OidcClient`, so tests inject a fake and never call Google.
"""

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse, Response
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from taskboard.events import record_change
from taskboard.models import AuthEvent, User, UserSession, WorkspaceMember
from taskboard.settings import allowed_hd

SESSION_COOKIE = "tb_session"
FLOW_COOKIE = "tb_flow"
SESSION_DAYS = 14
FLOW_SECONDS = 600

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = ("https://accounts.google.com", "accounts.google.com")

router = APIRouter()


class TokenError(Exception):
    """The code exchange or the ID token's signature failed."""


class OidcClient(Protocol):
    def exchange(self, code: str, code_verifier: str, redirect_uri: str) -> str:
        """Trade the authorization code for an ID token (raises TokenError)."""

    def verify(self, id_token: str) -> dict[str, Any]:
        """Check the signature against Google's keys and return the claims (raises TokenError).

        Claims such as `iss`, `aud`, `exp`, `nonce`, `hd` are checked by the callback itself.
        """


class GoogleOidc:
    def __init__(self) -> None:
        self._keys = jwt.PyJWKClient(GOOGLE_CERTS_URL, cache_keys=True)

    def exchange(self, code: str, code_verifier: str, redirect_uri: str) -> str:
        try:
            response = httpx.post(
                GOOGLE_TOKEN_URL,
                data={
                    "code": code,
                    "client_id": os.environ["GOOGLE_CLIENT_ID"],
                    "client_secret": os.environ["GOOGLE_CLIENT_SECRET"],
                    "redirect_uri": redirect_uri,
                    "grant_type": "authorization_code",
                    "code_verifier": code_verifier,
                },
                timeout=10,
            )
            token = response.json().get("id_token") if response.status_code == 200 else None
        except (httpx.HTTPError, ValueError) as exc:
            raise TokenError("token endpoint unreachable") from exc
        if not isinstance(token, str):
            raise TokenError("no id_token in the token response")
        return token

    def verify(self, id_token: str) -> dict[str, Any]:
        try:
            key = self._keys.get_signing_key_from_jwt(id_token)
            return jwt.decode(
                id_token,
                key.key,
                algorithms=["RS256"],
                options={"verify_aud": False, "verify_exp": False, "verify_iss": False},
            )
        except jwt.PyJWTError as exc:
            raise TokenError(str(exc)) from exc


_google = GoogleOidc()


def get_oidc() -> OidcClient:
    return _google


def get_db(request: Request):
    with Session(request.app.state.engine) as session:
        yield session


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _sign(payload: str, secret: str) -> str:
    return _b64(hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest())


def make_flow(flow: dict[str, Any], secret: str) -> str:
    payload = _b64(json.dumps(flow).encode())
    return f"{payload}.{_sign(payload, secret)}"


def read_flow(value: str | None, secret: str) -> dict[str, Any] | None:
    """The flow cookie's content, or None when it is missing, forged or older than 10 minutes."""
    if not value or "." not in value:
        return None
    payload, _, signature = value.partition(".")
    if not hmac.compare_digest(signature, _sign(payload, secret)):
        return None
    try:
        flow = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except ValueError:
        return None
    if not isinstance(flow, dict) or flow.get("exp", 0) < time.time():
        return None
    return flow


def _secure(request: Request) -> bool:
    return request.url.hostname not in ("localhost", "127.0.0.1", "::1")


def _configured() -> bool:
    needed = ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SESSION_SECRET")
    return allowed_hd() is not None and all(os.environ.get(name) for name in needed)


def _redirect_uri(request: Request) -> str:
    return str(request.url_for("callback"))


@router.get("/auth/login")
def login(request: Request):
    if not _configured():
        return JSONResponse({"detail": "sign_in_not_configured"}, status_code=503)
    state, nonce, verifier = (secrets.token_urlsafe(n) for n in (24, 24, 48))
    challenge = _b64(hashlib.sha256(verifier.encode()).digest())
    url = (
        GOOGLE_AUTH_URL
        + "?"
        + urlencode(
            {
                "client_id": os.environ["GOOGLE_CLIENT_ID"],
                "redirect_uri": _redirect_uri(request),
                "response_type": "code",
                "scope": "openid email profile",
                "state": state,
                "nonce": nonce,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            }
        )
    )
    flow = {"state": state, "nonce": nonce, "verifier": verifier, "exp": time.time() + FLOW_SECONDS}
    response = RedirectResponse(url, status_code=303)
    response.set_cookie(
        FLOW_COOKIE,
        make_flow(flow, os.environ["SESSION_SECRET"]),
        max_age=FLOW_SECONDS,
        httponly=True,
        samesite="lax",
        secure=_secure(request),
    )
    return response


class _Refused(Exception):
    def __init__(self, reason: str, email: str | None = None):
        self.reason = reason
        self.email = email


def _check_claims(claims: dict[str, Any], nonce: str) -> tuple[str, str]:
    """Raise _Refused unless the claims pass every check; returns (sub, lower-cased email)."""
    email = claims.get("email")
    email = email.strip().lower() if isinstance(email, str) and email.strip() else None
    if claims.get("iss") not in GOOGLE_ISSUERS:
        raise _Refused("bad_token", email)
    aud = claims.get("aud")
    audiences = aud if isinstance(aud, list) else [aud]
    if os.environ["GOOGLE_CLIENT_ID"] not in audiences:
        raise _Refused("wrong_aud", email)
    exp = claims.get("exp")
    if not isinstance(exp, int | float) or exp < time.time():
        raise _Refused("expired_token", email)
    token_nonce = claims.get("nonce")
    if not isinstance(token_nonce, str) or not hmac.compare_digest(token_nonce, nonce):
        raise _Refused("nonce_mismatch", email)
    sub = claims.get("sub")
    if not isinstance(sub, str) or not sub or email is None:
        raise _Refused("bad_token", email)
    if claims.get("email_verified") is not True:
        raise _Refused("email_unverified", email)
    hd = claims.get("hd")
    if not isinstance(hd, str) or not hd:
        raise _Refused("missing_hd", email)
    if hd.lower() != allowed_hd():
        raise _Refused("wrong_domain", email)
    return sub, email


def _resolve_user(db: Session, sub: str, email: str, claims: dict[str, Any]) -> User:
    """Find or create the user for this sign-in; every state change records its event."""
    name = claims.get("name") if isinstance(claims.get("name"), str) else None
    avatar = claims.get("picture") if isinstance(claims.get("picture"), str) else None
    user = db.scalar(select(User).where(User.google_sub == sub))
    if user is not None:
        if user.email != email:
            if db.scalar(select(User.id).where(User.email == email)) is not None:
                raise _Refused("email_conflict", email)
            old, user_id = user.email, user.id

            def change_email(s: Session) -> None:
                s.get(User, user_id).email = email

            record_change(
                db,
                change_email,
                actor_id=user_id,
                kind="member.email_changed",
                subject_type="user",
                subject_id=str(user_id),
                data={"from": old, "to": email},
            )
            db.refresh(user)
    else:
        user = db.scalar(select(User).where(User.email == email))
        if user is not None:
            if user.google_sub is not None:
                raise _Refused("email_conflict", email)
            user_id = user.id

            def link(s: Session) -> None:
                s.get(User, user_id).google_sub = sub

            record_change(
                db,
                link,
                actor_id=user_id,
                kind="member.signed_up",
                subject_type="user",
                subject_id=str(user_id),
            )
            db.refresh(user)
        else:
            user_id = (db.scalar(select(func.max(User.id))) or 0) + 1

            def create(s: Session) -> None:
                s.add(User(id=user_id, google_sub=sub, email=email))
                s.flush()
                s.add(WorkspaceMember(user_id=user_id, role="member"))

            record_change(
                db,
                create,
                actor_id=None,
                kind="member.added",
                subject_type="user",
                subject_id=str(user_id),
                data={"role": "member", "pending": False},
            )
            user = db.get(User, user_id)
    # The profile mirrors Google and is not a workspace change, so it writes no event.
    user.name = name or user.name
    user.avatar_url = avatar or user.avatar_url
    user.last_seen_at = _now()
    return user


def _refuse(db: Session, reason: str, email: str | None) -> Response:
    db.rollback()
    db.add(AuthEvent(email=email, outcome="refused", reason=reason))
    db.commit()
    response = RedirectResponse(f"/signin/refused?reason={reason}", status_code=303)
    response.delete_cookie(FLOW_COOKIE)
    return response


@router.get("/auth/callback", name="callback")
def callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
    oidc: OidcClient = Depends(get_oidc),
):
    if not _configured():
        return JSONResponse({"detail": "sign_in_not_configured"}, status_code=503)
    if error is not None:
        return _refuse(db, "oauth_error", None)
    flow = read_flow(request.cookies.get(FLOW_COOKIE), os.environ["SESSION_SECRET"])
    if flow is None or not state or not hmac.compare_digest(state, str(flow.get("state"))):
        return _refuse(db, "state_mismatch", None)
    if not code:
        return _refuse(db, "oauth_error", None)
    try:
        id_token = oidc.exchange(code, flow["verifier"], _redirect_uri(request))
    except TokenError:
        return _refuse(db, "oauth_error", None)
    try:
        claims = oidc.verify(id_token)
    except TokenError:
        return _refuse(db, "bad_token", None)
    try:
        sub, email = _check_claims(claims, flow["nonce"])
        user = _resolve_user(db, sub, email, claims)
        token = secrets.token_urlsafe(32)
        db.add(
            UserSession(
                id_hash=_hash(token),
                user_id=user.id,
                expires_at=_now() + timedelta(days=SESSION_DAYS),
            )
        )
        db.add(AuthEvent(email=email, outcome="accepted"))
        db.commit()
    except _Refused as refused:
        return _refuse(db, refused.reason, refused.email)
    except IntegrityError:
        return _refuse(db, "email_conflict", claims.get("email"))
    response = RedirectResponse("/boards", status_code=303)
    response.delete_cookie(FLOW_COOKIE)
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_DAYS * 86400,
        httponly=True,
        samesite="lax",
        secure=_secure(request),
    )
    return response


@router.post("/auth/logout")
def logout(request: Request, db: Session = Depends(get_db)):
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        row = db.get(UserSession, _hash(token))
        if row is not None:
            db.delete(row)
            db.commit()
    response = Response(status_code=204)
    response.delete_cookie(SESSION_COOKIE)
    return response


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    """The signed-in user, or a 401 whose detail is `not_signed_in` or `session_expired`."""
    token = request.cookies.get(SESSION_COOKIE)
    row = db.get(UserSession, _hash(token)) if token else None
    if row is None:
        raise HTTPException(401, "not_signed_in")
    if row.expires_at <= _now():
        db.delete(row)
        db.commit()
        raise HTTPException(401, "session_expired")
    user = db.get(User, row.user_id)
    if user is None:
        raise HTTPException(401, "not_signed_in")
    return user


@router.get("/api/me")
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    member = db.get(WorkspaceMember, user.id)
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "avatar_url": user.avatar_url,
        "role": member.role if member else "member",
    }
