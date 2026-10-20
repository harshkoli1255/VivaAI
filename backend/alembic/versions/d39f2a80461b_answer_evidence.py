"""Preserve candidate-reviewed speech and question evidence.

Revision ID: d39f2a80461b
Revises: c9284c5b75e8
"""
from alembic import op
import sqlalchemy as sa

revision = "d39f2a80461b"
down_revision = "c9284c5b75e8"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("transcript_turns", sa.Column("answer_metadata", sa.JSON(), nullable=True))


def downgrade():
    op.drop_column("transcript_turns", "answer_metadata")
