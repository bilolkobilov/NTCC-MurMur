"""exams.clinic: the clinic where the exam was made, frozen at creation

Before this, "analyzed at" was read from the device's current doctor, so reassigning a device rewrote the clinic of
every past exam (a patient could see another doctor's clinic). Existing rows get the clinic of the exam's doctor.

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-17 16:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0010"
down_revision: str | Sequence[str] | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("exams", sa.Column("clinic", sa.String(length=200), nullable=True))
    op.execute("UPDATE exams SET clinic = users.clinic FROM users WHERE users.id = exams.doctor_id")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("exams", "clinic")
