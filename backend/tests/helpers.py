"""Small builders shared by tests. They write straight to the database, so each test sets up only what it needs."""

from sqlalchemy.orm import Session

from app.models import Role, User
from app.services.users import create_user

DEFAULT_PASSWORD = "correct-horse-1"


def make_user(
    db: Session,
    username: str,
    role: Role,
    *,
    password: str = DEFAULT_PASSWORD,
    is_active: bool = True,
    must_change_password: bool = False,
) -> User:
    user = create_user(
        db,
        username=username,
        password=password,
        role=role,
        full_name=username.title(),
        must_change_password=must_change_password,
    )
    user.is_active = is_active
    db.commit()
    return user


def login(client, username: str, password: str = DEFAULT_PASSWORD) -> dict[str, str]:
    """Log in and return the Authorization header."""
    response = client.post("/api/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}
