from pydantic import BaseModel, ConfigDict

from app.models import Role
from app.schemas.common import NewPassword


class LoginRequest(BaseModel):
    username: str
    password: str
    role: Role | None = None  # the role chosen on the login card; the account must have it


class AdminLoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: Role
    must_change_password: bool


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: NewPassword


class AccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    role: Role
    full_name: str
    clinic: str | None = None
