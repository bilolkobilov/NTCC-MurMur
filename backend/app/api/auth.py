"""Login and password change, for every role."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.deps import CurrentUser, DbSession, get_current_user_allow_password_change
from app.models import User
from app.schemas.auth import AccountOut, ChangePasswordRequest, LoginRequest, TokenResponse
from app.security import create_access_token
from app.services import users

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login")
def login(body: LoginRequest, db: DbSession) -> TokenResponse:
    user = users.authenticate(db, body.username, body.password)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "wrong username or password")
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
