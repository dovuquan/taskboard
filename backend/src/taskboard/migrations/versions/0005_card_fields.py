"""Card fields: labels, card assignees and card labels

Revision ID: 0005
Revises: 0004
"""

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

# The fixed set, in display order; `color` is the suffix of the `--l-<color>` design token.
LABELS = ["Launch", "Bug", "Docs", "Ops", "Marketing", "Research", "Design"]


def upgrade() -> None:
    labels = op.create_table(
        "labels",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String, nullable=False),
        sa.Column("color", sa.String, nullable=False),
        sa.UniqueConstraint("name", name="uq_labels_name"),
    )
    op.create_table(
        "card_members",
        sa.Column("card_id", sa.Integer, sa.ForeignKey("cards.id"), primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id"), primary_key=True),
    )
    op.create_index("ix_card_members_user_id", "card_members", ["user_id"])
    op.create_table(
        "card_labels",
        sa.Column("card_id", sa.Integer, sa.ForeignKey("cards.id"), primary_key=True),
        sa.Column("label_id", sa.Integer, sa.ForeignKey("labels.id"), primary_key=True),
    )
    op.create_index("ix_card_labels_label_id", "card_labels", ["label_id"])
    # Seed rows are part of the schema, not a state change: no event.
    op.bulk_insert(
        labels, [{"id": i, "name": n, "color": n.lower()} for i, n in enumerate(LABELS, 1)]
    )


def downgrade() -> None:
    op.drop_index("ix_card_labels_label_id", table_name="card_labels")
    op.drop_table("card_labels")
    op.drop_index("ix_card_members_user_id", table_name="card_members")
    op.drop_table("card_members")
    op.drop_table("labels")
