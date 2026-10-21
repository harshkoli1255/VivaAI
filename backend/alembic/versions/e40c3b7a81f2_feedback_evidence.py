"""Persist candidate transcript evidence for each feedback line.

Revision ID: e40c3b7a81f2
Revises: d39f2a80461b
"""
from alembic import op
import sqlalchemy as sa

revision = "e40c3b7a81f2"
down_revision = "d39f2a80461b"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("score_reports", sa.Column("feedback_turn_ids", sa.JSON(), nullable=False, server_default="[]"))


def downgrade():
    op.drop_column("score_reports", "feedback_turn_ids")
