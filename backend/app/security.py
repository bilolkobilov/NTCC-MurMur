"""Passwords (bcrypt), access tokens (JWT) and device API keys (random string + SHA-256 hash)."""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt

from app.config import get_settings

JWT_ALGORITHM = "HS256"
BCRYPT_MAX_BYTES = 72  # bcrypt ignores/rejects anything longer


def hash_password(password: str) -> str:
    salt = bcrypt.gensalt(rounds=get_settings().bcrypt_rounds)
    return bcrypt.hashpw(password.encode(), salt).decode()


def verify_password(password: str, password_hash: str) -> bool:
    encoded = password.encode()
    if len(encoded) > BCRYPT_MAX_BYTES:
        return False
    return bcrypt.checkpw(encoded, password_hash.encode())


def generate_temp_password() -> str:
    """One-time password shown once to the person who creates the account."""
    return secrets.token_urlsafe(9)


def create_access_token(user_id: int, role: str, token_version: int) -> str:
    settings = get_settings()
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "role": role,
        "ver": token_version,
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> tuple[int, int] | None:
    """Return (user id, token version) from a valid token, or None if it is invalid or expired."""
    try:
        payload = jwt.decode(
            token, get_settings().jwt_secret, algorithms=[JWT_ALGORITHM], options={"require": ["exp", "sub", "ver"]}
        )
        return int(payload["sub"]), int(payload["ver"])
    except (jwt.PyJWTError, ValueError, TypeError):
        return None


def generate_api_key() -> str:
    return secrets.token_urlsafe(32)


def hash_api_key(api_key: str) -> str:
    """SHA-256 is enough here: the key is 256 random bits, so it cannot be guessed, and lookup must be fast."""
    return hashlib.sha256(api_key.encode()).hexdigest()
