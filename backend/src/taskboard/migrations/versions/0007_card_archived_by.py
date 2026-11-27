"""Who archived a card, for the 60-second restore rule

Revision ID: 0007
Revises: 0006
"""

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # SQLite adds a nullable column with a REFERENCES clause in place; no table copy.
    op.execute("ALTER TABLE cards ADD COLUMN archived_by INTEGER REFERENCES users (id)")


def downgrade() -> None:
    # SQLite cannot drop a column that carries a foreign key, so the table is rebuilt. Other tables
    # point at cards, so the checks are off while it is copied. This runs before the first write,
    # so no transaction is open yet and the pragma takes effect.
    op.execute("PRAGMA foreign_keys=OFF")
    with op.batch_alter_table("cards", recreate="always") as batch_op:
        batch_op.drop_column("archived_by")
    op.execute("PRAGMA foreign_keys=ON")
