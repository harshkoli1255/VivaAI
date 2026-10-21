"""Version viva configurations without changing existing interview contracts."""
from alembic import op
import sqlalchemy as sa
revision = 'b73d0a8e214f'
down_revision = 'a62b8f4d9031'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('viva_configs', sa.Column('course_code', sa.String(64), nullable=False, server_default=''))
    op.add_column('viva_configs', sa.Column('revision', sa.Integer(), nullable=False, server_default='1'))
    op.add_column('viva_configs', sa.Column('previous_version_id', sa.Uuid(), nullable=True))
    op.add_column('viva_configs', sa.Column('superseded_by_id', sa.Uuid(), nullable=True))


def downgrade():
    for name in ['superseded_by_id', 'previous_version_id', 'revision', 'course_code']:
        op.drop_column('viva_configs', name)
