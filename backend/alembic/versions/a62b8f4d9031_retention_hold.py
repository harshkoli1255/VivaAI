"""Protect records under appeal or review from configured retention deletion."""
from alembic import op
import sqlalchemy as sa
revision = 'a62b8f4d9031'
down_revision = 'f51a9dc2be30'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('viva_sessions', sa.Column('retention_hold', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    op.drop_column('viva_sessions', 'retention_hold')
