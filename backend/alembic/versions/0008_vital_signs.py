"""vital signs entered by the doctor

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-16 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0008"
down_revision: str | Sequence[str] | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "vital_signs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=False),
        sa.Column("doctor_id", sa.Integer(), nullable=False),
        sa.Column("heart_rate", sa.Integer(), nullable=True),
        sa.Column("systolic", sa.Integer(), nullable=True),
        sa.Column("diastolic", sa.Integer(), nullable=True),
        sa.Column("spo2", sa.Integer(), nullable=True),
        sa.Column("resp_rate", sa.Integer(), nullable=True),
        sa.Column("temp_c", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["doctor_id"], ["users.id"], name=op.f("fk_vital_signs_doctor_id_users")),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], name=op.f("fk_vital_signs_patient_id_patients")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_vital_signs")),
    )
    op.create_index(op.f("ix_vital_signs_doctor_id"), "vital_signs", ["doctor_id"], unique=False)
    op.create_index(op.f("ix_vital_signs_patient_id"), "vital_signs", ["patient_id"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_vital_signs_patient_id"), table_name="vital_signs")
    op.drop_index(op.f("ix_vital_signs_doctor_id"), table_name="vital_signs")
    op.drop_table("vital_signs")
