"""patients.clinic (snapshot of the doctor's clinic) and sex "other"

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-15 20:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0007"
down_revision: str | Sequence[str] | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("patients", sa.Column("clinic", sa.String(length=200), nullable=True))
    op.execute("UPDATE patients SET clinic = (SELECT clinic FROM users WHERE users.id = patients.doctor_id)")
    op.drop_constraint("sex", "patients", type_="check")
    op.create_check_constraint("sex", "patients", "sex IN ('male', 'female', 'other')")


def downgrade() -> None:
    """Downgrade schema."""
    # The old schema has no "other": refuse rather than silently rewrite real patients' data.
    if op.get_bind().scalar(sa.text("SELECT count(*) FROM patients WHERE sex = 'other'")):
        raise RuntimeError("patients with sex 'other' exist; change them before downgrading below 0007")
    op.drop_constraint("sex", "patients", type_="check")
    op.create_check_constraint("sex", "patients", "sex IN ('male', 'female')")
    op.drop_column("patients", "clinic")
