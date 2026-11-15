"""Login and password change, for every role."""

from collections.abc import Callable
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.deps import CurrentUser, DbSession, get_current_user_allow_password_change
from app.models import Role, User
from app.schemas.auth import AccountOut, AdminLoginRequest, ChangePasswordRequest, LoginRequest, TokenResponse
from app.security import create_access_token
from app.services import users
from app.services.login_limiter import get_login_limiter, limiter_key

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", responses={429: {"description": "Too many wrong passwords; see Retry-After"}})
def login(body: LoginRequest, request: Request, db: DbSession) -> TokenResponse:
    """Doctors and patients. An administrator account is refused here: admins use `/api/auth/admin/login`."""
    return _login(request, db, body.username, body.password, lambda user: _allowed(user, body.role))


@router.post("/admin/login", responses={429: {"description": "Too many wrong passwords; see Retry-After"}})
def admin_login(body: AdminLoginRequest, request: Request, db: DbSession) -> TokenResponse:
    """Administrators only (the page lives at /login/admin, linked from nowhere)."""
    return _login(request, db, body.username, body.password, lambda user: user.role == Role.ADMIN)


def _allowed(user: User, chosen: Role | None) -> bool:
    return user.role != Role.ADMIN and (chosen is None or user.role == chosen)


def _login(
    request: Request, db: Session, username: str, password: str, accepts: Callable[[User], bool]
) -> TokenResponse:
    limiter = get_login_limiter()
    key = limiter_key(request.client.host if request.client else None, username)
    wait = limiter.begin_attempt(key)
    if wait is not None:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"too many wrong passwords, try again in {wait} seconds",
            headers={"Retry-After": str(wait)},
        )
    user = users.authenticate(db, username, password)
    # A wrong password and the wrong login page look the same (no hint which accounts exist); the attempt stays counted.
    if user is None or not accepts(user):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "wrong username or password",
            headers={"X-Attempts-Left": str(limiter.attempts_left(key))},
        )
    limiter.reset(key)
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "account is blocked")
    return _token_response(user)


@router.post("/change-password")
def change_password(
    body: ChangePasswordRequest,
    db: DbSession,
    user: Annotated[User, Depends(get_current_user_allow_password_change)],
) -> TokenResponse:
    """All earlier tokens of this user stop working; the response carries a fresh one."""
    users.change_password(db, user, body.current_password, body.new_password)
    return _token_response(user)


def _token_response(user: User) -> TokenResponse:
    return TokenResponse(
        access_token=create_access_token(user.id, user.role.value, user.token_version),
        role=user.role,
        must_change_password=user.must_change_password,
    )


@router.get("/me")
def whoami(user: CurrentUser) -> AccountOut:
    """The logged-in account (any role). Fails with 403 while a temporary password is not changed."""
    return AccountOut.model_validate(user)
