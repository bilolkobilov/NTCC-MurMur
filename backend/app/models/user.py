from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, CreatedAtMixin
from app.models.enums import Role, str_enum


class User(CreatedAtMixin, Base):
    """A login: admin, doctor or patient."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True)
    password_hash: Mapped[str] = mapped_column(String(100))
    role: Mapped[Role] = mapped_column(str_enum(Role, "role"))
    full_name: Mapped[str] = mapped_column(String(200))
    clinic: Mapped[str | None] = mapped_column(String(200))  # where a doctor works; set by the admin
    is_active: Mapped[bool] = mapped_column(default=True)
    must_change_password: Mapped[bool] = mapped_column(default=False)
    # Goes up on every password change; tokens carry it, so older tokens stop working at once.
    token_version: Mapped[int] = mapped_column(default=0, server_default="0")
