"""Creating accounts and changing passwords."""

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Role, User
from app.security import hash_password, verify_password
from app.services.errors import BadRequest, Conflict


def username_taken(db: Session, username: str) -> bool:
    return db.scalar(select(User.id).where(User.username == username)) is not None


def create_user(
    db: Session,
    *,
    username: str,
    password: str,
    role: Role,
    full_name: str,
    must_change_password: bool = False,
) -> User:
    """Add a user to the session (caller commits). Raises Conflict if the username exists."""
    if username_taken(db, username):
        raise Conflict("username already exists")
    user = User(
        username=username,
        password_hash=hash_password(password),
        role=role,
        full_name=full_name,
        must_change_password=must_change_password,
    )
    # The check above can race with a parallel request; the unique index is the real guard.
    # A savepoint keeps the caller's other pending changes if the insert is rejected.
    try:
        with db.begin_nested():
            db.add(user)
    except IntegrityError:
        raise Conflict("username already exists") from None
    return user


def authenticate(db: Session, username: str, password: str) -> User | None:
    user = db.scalar(select(User).where(User.username == username))
    if user is None or not verify_password(password, user.password_hash):
        return None
    return user


def change_password(db: Session, user: User, current_password: str, new_password: str) -> None:
    if not verify_password(current_password, user.password_hash):
        raise BadRequest("current password is wrong")
    if current_password == new_password:
        raise BadRequest("new password must be different")
    user.password_hash = hash_password(new_password)
    user.must_change_password = False
    user.token_version += 1  # every token issued before this moment stops working
    db.commit()
