"""Lists: the lists table

Revision ID: 0003
Revises: 0002
"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "lists",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("board_id", sa.Integer, sa.ForeignKey("boards.id"), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("position", sa.Float, nullable=False),
        sa.Column("created_by", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("archived_at", sa.DateTime),
        sa.Column("archived_by", sa.Integer, sa.ForeignKey("users.id")),
    )
    op.create_index("ix_lists_board_id", "lists", ["board_id"])


def downgrade() -> None:
    op.drop_index("ix_lists_board_id", table_name="lists")
    op.drop_table("lists")
