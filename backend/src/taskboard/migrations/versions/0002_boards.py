"""Boards: boards, board_members and events.board_id

Revision ID: 0002
Revises: 0001
"""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "boards",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("visibility", sa.String, nullable=False),
        sa.Column("key_prefix", sa.String, nullable=False, server_default="TB"),
        sa.Column("next_card_number", sa.Integer, nullable=False, server_default="1"),
        sa.Column("created_by", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("archived_at", sa.DateTime),
        sa.CheckConstraint("visibility IN ('workspace', 'private')", name="ck_board_visibility"),
    )
    op.create_table(
        "board_members",
        sa.Column("board_id", sa.Integer, sa.ForeignKey("boards.id"), primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("role", sa.String, nullable=False),
        sa.Column("added_at", sa.DateTime, nullable=False),
        sa.CheckConstraint("role IN ('owner', 'member', 'observer')", name="ck_board_member_role"),
    )
    with op.batch_alter_table("events") as batch:
        batch.add_column(sa.Column("board_id", sa.Integer))
        batch.create_index("ix_events_board_id", ["board_id"])


def downgrade() -> None:
    with op.batch_alter_table("events") as batch:
        batch.drop_index("ix_events_board_id")
        batch.drop_column("board_id")
    op.drop_table("board_members")
    op.drop_table("boards")
