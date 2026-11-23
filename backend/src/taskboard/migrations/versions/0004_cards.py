"""Cards: the cards table

Revision ID: 0004
Revises: 0003
"""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cards",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("board_id", sa.Integer, sa.ForeignKey("boards.id"), nullable=False),
        sa.Column("list_id", sa.Integer, sa.ForeignKey("lists.id"), nullable=False),
        sa.Column("number", sa.Integer, nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("due_at", sa.DateTime),
        sa.Column("position", sa.Float, nullable=False),
        sa.Column("created_by", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("archived_at", sa.DateTime),
        sa.UniqueConstraint("board_id", "number", name="uq_cards_board_number"),
    )
    op.create_index("ix_cards_board_id", "cards", ["board_id"])
    op.create_index("ix_cards_list_id", "cards", ["list_id"])


def downgrade() -> None:
    op.drop_index("ix_cards_list_id", table_name="cards")
    op.drop_index("ix_cards_board_id", table_name="cards")
    op.drop_table("cards")
