"""FastAPI dependencies for authentication and role checks. Every protected route uses one of these."""

from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Device, Role, User
from app.security import decode_access_token, hash_api_key

DbSession = Annotated[Session, Depends(get_db)]

_bearer = HTTPBearer(auto_error=False)


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, detail, headers={"WWW-Authenticate": "Bearer"})


def get_current_user_allow_password_change(
    db: DbSession, credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]
) -> User:
    """Valid token + active account. Allows users who still must change their temporary password."""
    if credentials is None:
        raise _unauthorized("not authenticated")
    decoded = decode_access_token(credentials.credentials)
    user = db.get(User, decoded[0]) if decoded is not None else None
    if user is None:
        raise _unauthorized("invalid or expired token")
    if user.token_version != decoded[1]:
        raise _unauthorized("token is no longer valid, log in again")
    if not user.is_active:
        raise _unauthorized("account is blocked")
    return user


def get_current_user(user: Annotated[User, Depends(get_current_user_allow_password_change)]) -> User:
    """Like above, but a user with a temporary password can do nothing until they change it."""
    if user.must_change_password:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "password change required")
    return user


def require_role(role: Role):
    def checker(user: Annotated[User, Depends(get_current_user)]) -> User:
        if user.role != role:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"{role.value} only")
        return user

    return checker


CurrentUser = Annotated[User, Depends(get_current_user)]
CurrentAdmin = Annotated[User, Depends(require_role(Role.ADMIN))]
CurrentDoctor = Annotated[User, Depends(require_role(Role.DOCTOR))]
CurrentPatient = Annotated[User, Depends(require_role(Role.PATIENT))]


def get_current_device(db: DbSession, x_device_key: Annotated[str | None, Header()] = None) -> Device:
    if not x_device_key:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing X-Device-Key")
    device = db.scalar(select(Device).where(Device.api_key_hash == hash_api_key(x_device_key)))
    if device is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid device key")
    return device


CurrentDevice = Annotated[Device, Depends(get_current_device)]
