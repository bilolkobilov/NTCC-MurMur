"""devices: model, location, telemetry, disconnect and self-test; self-test commands have no exam

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-15 20:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0006"
down_revision: str | Sequence[str] | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("devices", sa.Column("model", sa.String(length=32), server_default="MurMur S2", nullable=False))
    op.add_column("devices", sa.Column("location", sa.String(length=100), nullable=True))
    op.add_column("devices", sa.Column("battery_pct", sa.Integer(), nullable=True))
    op.add_column("devices", sa.Column("mic_noise_db", sa.Integer(), nullable=True))
    op.add_column("devices", sa.Column("wifi_ssid", sa.String(length=32), nullable=True))
    op.add_column("devices", sa.Column("ip", sa.String(length=45), nullable=True))
    op.add_column("devices", sa.Column("mac", sa.String(length=17), nullable=True))
    op.add_column("devices", sa.Column("gateway", sa.String(length=45), nullable=True))
    op.add_column("devices", sa.Column("disconnected_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("devices", sa.Column("disconnect_reason", sa.String(length=20), nullable=True))
    op.add_column("devices", sa.Column("last_self_test_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("devices", sa.Column("last_self_test_ok", sa.Boolean(), nullable=True))
    op.alter_column("device_commands", "exam_id", existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DELETE FROM device_commands WHERE exam_id IS NULL")
    op.alter_column("device_commands", "exam_id", existing_type=sa.Integer(), nullable=False)
    for column in (
        "last_self_test_ok",
        "last_self_test_at",
        "disconnect_reason",
        "disconnected_at",
        "gateway",
        "mac",
        "ip",
        "wifi_ssid",
        "mic_noise_db",
        "battery_pct",
        "location",
        "model",
    ):
        op.drop_column("devices", column)
