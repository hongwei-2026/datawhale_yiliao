"""用户注册、登录与 JWT 鉴权（stdlib，无额外依赖）。"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import secrets
import time
from typing import Any

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .db import connect, new_id, utc_now

USERNAME_RE = re.compile(r"^[a-zA-Z0-9_\u4e00-\u9fff]{2,32}$")
_bearer = HTTPBearer(auto_error=False)

PBKDF2_ROUNDS = 100_000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), PBKDF2_ROUNDS
    )
    return f"pbkdf2_sha256${PBKDF2_ROUNDS}${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, rounds_s, salt, digest_hex = stored.split("$", 3)
        if algo != "pbkdf2_sha256":
            return False
        rounds = int(rounds_s)
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt.encode("utf-8"), rounds
        )
        return hmac.compare_digest(digest.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    pad = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + pad)


def create_access_token(user_id: str, secret: str, ttl_seconds: int = 7 * 24 * 3600) -> str:
    header = _b64url(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = _b64url(
        json.dumps(
            {"sub": user_id, "exp": int(time.time()) + ttl_seconds},
            separators=(",", ":"),
        ).encode()
    )
    signing_input = f"{header}.{payload}".encode()
    sig = _b64url(hmac.new(secret.encode(), signing_input, hashlib.sha256).digest())
    return f"{header}.{payload}.{sig}"


def decode_access_token(token: str, secret: str) -> dict[str, Any] | None:
    try:
        header_b64, payload_b64, sig_b64 = token.split(".")
        signing_input = f"{header_b64}.{payload_b64}".encode()
        expected = _b64url(hmac.new(secret.encode(), signing_input, hashlib.sha256).digest())
        if not hmac.compare_digest(expected, sig_b64):
            return None
        payload = json.loads(_b64url_decode(payload_b64))
        if int(payload.get("exp", 0)) < int(time.time()):
            return None
        return payload
    except (ValueError, json.JSONDecodeError, TypeError):
        return None


def get_user_by_id(db_path: str, user_id: str) -> dict | None:
    conn = connect(db_path)
    row = conn.execute(
        "SELECT id, username, display_name, role, created_at FROM app_user WHERE id=?",
        (user_id,),
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def get_user_by_username(db_path: str, username: str) -> dict | None:
    conn = connect(db_path)
    row = conn.execute("SELECT * FROM app_user WHERE username=?", (username.lower(),)).fetchone()
    conn.close()
    return dict(row) if row else None


def register_user(
    db_path: str,
    *,
    username: str,
    password: str,
    display_name: str | None = None,
) -> dict[str, Any]:
    username = (username or "").strip().lower()
    password = password or ""
    if not USERNAME_RE.match(username):
        return {"ok": False, "error": "用户名需 2–32 位，可用中文、字母、数字、下划线"}
    if len(password) < 6:
        return {"ok": False, "error": "密码至少 6 位"}
    if get_user_by_username(db_path, username):
        return {"ok": False, "error": "用户名已被注册"}

    uid = new_id()
    now = utc_now()
    name = (display_name or username).strip()[:64] or username
    conn = connect(db_path)
    conn.execute(
        """
        INSERT INTO app_user(id, username, password_hash, display_name, role, created_at, updated_at)
        VALUES(?,?,?,?,?,?,?)
        """,
        (uid, username, hash_password(password), name, "trainee", now, now),
    )
    conn.commit()
    conn.close()
    return {
        "ok": True,
        "user": {"id": uid, "username": username, "display_name": name, "role": "trainee"},
    }


def authenticate_user(db_path: str, username: str, password: str) -> dict[str, Any]:
    username = (username or "").strip().lower()
    row = get_user_by_username(db_path, username)
    if not row or not verify_password(password or "", row["password_hash"]):
        return {"ok": False, "error": "用户名或密码错误"}
    return {
        "ok": True,
        "user": {
            "id": row["id"],
            "username": row["username"],
            "display_name": row["display_name"],
            "role": row["role"],
        },
    }


def get_current_user_optional(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict | None:
    if not creds or creds.scheme.lower() != "bearer":
        return None
    secret = request.app.state.settings.jwt_secret
    payload = decode_access_token(creds.credentials, secret)
    if not payload:
        return None
    user = get_user_by_id(request.app.state.db_path, payload.get("sub", ""))
    return user


def require_user(user: dict | None = Depends(get_current_user_optional)) -> dict:
    if not user:
        raise HTTPException(401, "请先登录")
    return user


def require_admin(user: dict = Depends(require_user)) -> dict:
    if (user.get("role") or "") != "admin":
        raise HTTPException(403, "需要管理员权限")
    return user


LEGACY_USERNAME = "history"
LEGACY_DISPLAY_NAME = "历史练习数据"
LEGACY_DEFAULT_PASSWORD = "History2026"


def migrate_legacy_sessions(db_path: str) -> dict[str, Any]:
    """将登录功能上线前的匿名练习记录归属到统一历史账号，并确保该账号始终存在。"""
    conn = connect(db_path)
    pending = conn.execute(
        "SELECT COUNT(*) AS c FROM training_session WHERE trainee_user_id IS NULL"
    ).fetchone()["c"]

    row = conn.execute(
        "SELECT id FROM app_user WHERE username=?", (LEGACY_USERNAME,)
    ).fetchone()
    if row:
        uid = row["id"]
        created = False
    else:
        uid = new_id()
        now = utc_now()
        conn.execute(
            """
            INSERT INTO app_user(id, username, password_hash, display_name, role, created_at, updated_at)
            VALUES(?,?,?,?,?,?,?)
            """,
            (
                uid,
                LEGACY_USERNAME,
                hash_password(LEGACY_DEFAULT_PASSWORD),
                LEGACY_DISPLAY_NAME,
                "trainee",
                now,
                now,
            ),
        )
        created = True

    migrated = 0
    if pending:
        conn.execute(
            "UPDATE training_session SET trainee_user_id=? WHERE trainee_user_id IS NULL",
            (uid,),
        )
        migrated = conn.execute("SELECT changes()").fetchone()[0]

    conn.commit()
    conn.close()
    return {
        "ok": True,
        "migrated": migrated,
        "user_created": created,
        "user_id": uid,
        "username": LEGACY_USERNAME,
        "display_name": LEGACY_DISPLAY_NAME,
    }
