"""M1 tables: users, workspace_members, sessions, auth_events, events

Revision ID: 0001
Revises:
"""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("google_sub", sa.String, unique=True),
        sa.Column("email", sa.String, nullable=False, unique=True),
        sa.Column("name", sa.String),
        sa.Column("avatar_url", sa.String),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("last_seen_at", sa.DateTime),
    )
    op.create_table(
        "workspace_members",
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("role", sa.String, nullable=False),
        sa.Column("joined_at", sa.DateTime, nullable=False),
        sa.CheckConstraint("role IN ('admin', 'member')", name="ck_member_role"),
    )
    op.create_table(
        "sessions",
        sa.Column("id_hash", sa.String, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("expires_at", sa.DateTime, nullable=False),
    )
    op.create_table(
        "auth_events",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("at", sa.DateTime, nullable=False),
        sa.Column("email", sa.String),
        sa.Column("outcome", sa.String, nullable=False),
        sa.Column("reason", sa.String),
        sa.CheckConstraint("outcome IN ('accepted', 'refused')", name="ck_auth_outcome"),
    )
    op.create_table(
        "events",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("at", sa.DateTime, nullable=False),
        sa.Column("actor_id", sa.Integer, sa.ForeignKey("users.id")),
        sa.Column("kind", sa.String, nullable=False),
        sa.Column("subject_type", sa.String, nullable=False),
        sa.Column("subject_id", sa.String, nullable=False),
        sa.Column("data", sa.JSON, nullable=False),
    )


def downgrade() -> None:
    for table in ("events", "auth_events", "sessions", "workspace_members", "users"):
        op.drop_table(table)
