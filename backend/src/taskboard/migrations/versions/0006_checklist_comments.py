"""Checklist items and comments on cards, and an index on events by subject

Revision ID: 0006
Revises: 0005
"""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "checklist_items",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("card_id", sa.Integer, sa.ForeignKey("cards.id"), nullable=False),
        sa.Column("text", sa.String(200), nullable=False),
        sa.Column("done", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("created_by", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("deleted_at", sa.DateTime),
        sa.Column("deleted_by", sa.Integer, sa.ForeignKey("users.id")),
    )
    op.create_index("ix_checklist_items_card_id", "checklist_items", ["card_id"])
    op.create_table(
        "comments",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("card_id", sa.Integer, sa.ForeignKey("cards.id"), nullable=False),
        sa.Column("author_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("text", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("edited_at", sa.DateTime),
        sa.Column("deleted_at", sa.DateTime),
        sa.Column("deleted_by", sa.Integer, sa.ForeignKey("users.id")),
    )
    op.create_index("ix_comments_card_id", "comments", ["card_id"])
    op.create_index("ix_events_subject", "events", ["subject_type", "subject_id"])


def downgrade() -> None:
    op.drop_index("ix_events_subject", table_name="events")
    op.drop_index("ix_comments_card_id", table_name="comments")
    op.drop_table("comments")
    op.drop_index("ix_checklist_items_card_id", table_name="checklist_items")
    op.drop_table("checklist_items")
