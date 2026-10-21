"""Distinguish mixed conversation recordings from historical microphone captures."""
from alembic import op
import sqlalchemy as sa
revision = 'f51a9dc2be30'
down_revision = 'e40c3b7a81f2'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('audio_chunks', sa.Column('recording_kind', sa.String(32), nullable=False, server_default='candidate'))


def downgrade():
    op.drop_column('audio_chunks', 'recording_kind')
