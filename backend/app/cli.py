"""Command line tools.

    uv run python -m app.cli create-admin

Creates the first admin from FIRST_ADMIN_USERNAME / FIRST_ADMIN_PASSWORD (env or .env). Safe to run twice:
if that username already exists nothing changes.
"""

import argparse
import sys

from app.config import get_settings
from app.db import SessionLocal
from app.models import Role
from app.services import users


def create_admin() -> int:
    settings = get_settings()
    if not settings.first_admin_password:
        print("FIRST_ADMIN_PASSWORD is <missing>; set it in .env first", file=sys.stderr)
        return 1
    if len(settings.first_admin_password) < 8:
        print("FIRST_ADMIN_PASSWORD must be at least 8 characters", file=sys.stderr)
        return 1
    with SessionLocal() as db:
        if users.username_taken(db, settings.first_admin_username):
            print(f"user '{settings.first_admin_username}' already exists, nothing changed")
            return 0
        users.create_user(
            db,
            username=settings.first_admin_username,
            password=settings.first_admin_password,
            role=Role.ADMIN,
            full_name="Administrator",
        )
        db.commit()
    print(f"admin '{settings.first_admin_username}' created")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("create-admin", help="create the first admin from env values")
    args = parser.parse_args(argv)
    if args.command == "create-admin":
        return create_admin()
    return 2


if __name__ == "__main__":
    sys.exit(main())
