"""Field types shared by several schemas."""

from typing import Annotated

from fastapi import Path
from pydantic import AfterValidator, Field, StringConstraints

from app.security import BCRYPT_MAX_BYTES


def _fits_bcrypt(value: str) -> str:
    if len(value.encode()) > BCRYPT_MAX_BYTES:
        raise ValueError(f"password must be at most {BCRYPT_MAX_BYTES} bytes")
    return value


# New passwords: at least 8 characters, at most 72 bytes (bcrypt limit).
NewPassword = Annotated[str, StringConstraints(min_length=8), AfterValidator(_fits_bcrypt)]

# Login names: letters, digits, dot, dash, underscore.
Username = Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=64, pattern=r"^[A-Za-z0-9._-]+$")]

FullName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]

# Database ids are 32-bit integers. A bigger number would crash the query (500), so reject it as invalid input (422).
DB_INT_MAX = 2_147_483_647
PathId = Annotated[int, Path(ge=1, le=DB_INT_MAX)]  # for URL path parameters
RefId = Annotated[int, Field(ge=1, le=DB_INT_MAX)]  # for ids inside request bodies
