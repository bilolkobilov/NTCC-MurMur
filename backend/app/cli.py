"""Command line tools.

    uv run python -m app.cli create-admin
    uv run python -m app.cli seed-demo      # Docker demo only


Creates the first admin from FIRST_ADMIN_USERNAME / FIRST_ADMIN_PASSWORD (env or .env). Safe to run twice:
if that username already exists nothing changes.
"""

import argparse
import sys

from app.config import get_settings
from app.db import SessionLocal
from app.models import Role
from app.services import devices, users


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


def seed_demo() -> int:
    """Docker demo: a doctor and a device whose key (DEMO_DEVICE_KEY) the bundled fake device already has.

    Does nothing when DEMO_DEVICE_KEY is not set, and nothing the second time.
    """
    settings = get_settings()
    if not settings.demo_device_key:
        print("DEMO_DEVICE_KEY is <missing>; demo data skipped")
        return 0
    with SessionLocal() as db:
        if users.username_taken(db, "doctor"):
            print("demo data already exists, nothing changed")
            return 0
        doctor = users.create_user(
            db, username="doctor", password=settings.demo_doctor_password, role=Role.DOCTOR, full_name="Demo Doctor"
        )
        db.commit()
        devices.create_device(
            db, name="Demo device", serial="DEMO-001", doctor_id=doctor.id, api_key=settings.demo_device_key
        )
    print("demo doctor 'doctor' and device 'DEMO-001' created")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("create-admin", help="create the first admin from env values")
    sub.add_parser("seed-demo", help="Docker demo: create a doctor and a device with a known key")
    args = parser.parse_args(argv)
    if args.command == "create-admin":
        return create_admin()
    if args.command == "seed-demo":
        return seed_demo()
    return 2


if __name__ == "__main__":
    sys.exit(main())
