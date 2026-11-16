"""patients: contact details the patient edits (phone, email, city, emergency contact)

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-16 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0009"
down_revision: str | Sequence[str] | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COLUMNS = (
    ("phone", 32),
    ("email", 200),
    ("city", 100),
    ("emergency_contact_name", 200),
    ("emergency_contact_phone", 32),
)


def upgrade() -> None:
    """Upgrade schema."""
    for name, length in COLUMNS:
        op.add_column("patients", sa.Column(name, sa.String(length=length), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    for name, _ in reversed(COLUMNS):
        op.drop_column("patients", name)
