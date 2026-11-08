"""audit log keeps ids of deleted users

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-08 16:41:27.305433

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0003"
down_revision: str | Sequence[str] | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_constraint(op.f("fk_audit_logs_user_id_users"), "audit_logs", type_="foreignkey")


def downgrade() -> None:
    """Downgrade schema."""
    # Rows of users deleted since the upgrade would break the restored foreign key: keep the row, drop the id.
    op.execute(
        "UPDATE audit_logs SET user_id = NULL WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM users)"
    )
    op.create_foreign_key(op.f("fk_audit_logs_user_id_users"), "audit_logs", "users", ["user_id"], ["id"])
