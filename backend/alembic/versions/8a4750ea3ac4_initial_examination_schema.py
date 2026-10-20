"""initial examination schema

Revision ID: 8a4750ea3ac4
Revises: 
Create Date: 2026-10-19 22:02:51.325373+00:00

"""
from typing import Sequence, Union

from alembic import op, context
from sqlalchemy.dialects import postgresql
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8a4750ea3ac4'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_enums = {
    "userrole": postgresql.ENUM('student', 'faculty', 'admin', name='userrole', create_type=False),
    "vivaphase": postgresql.ENUM('warm_up', 'fundamentals', 'depth', 'applied', 'wrap_up', 'scoring', 'completed', name='vivaphase', create_type=False),
    "questionstatus": postgresql.ENUM('pending', 'approved', 'rejected', name='questionstatus', create_type=False),
    "sessionstatus": postgresql.ENUM('scheduled', 'in_progress', 'completed', 'aborted', 'flagged', name='sessionstatus', create_type=False),
    "reviewstatus": postgresql.ENUM('pending', 'reviewed', 'overridden', name='reviewstatus', create_type=False),
    "answerlabel": postgresql.ENUM('strong', 'partial', 'dont_know', 'off_topic', name='answerlabel', create_type=False),
}


def upgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        for enum in _enums.values():
            enum.create(op.get_bind(), checkfirst=not context.is_offline_mode())
    op.create_table('users',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('student_id', sa.String(length=64), nullable=True),
    sa.Column('email', sa.String(length=256), nullable=True),
    sa.Column('name', sa.String(length=256), nullable=False),
    sa.Column('hashed_password', sa.String(length=256), nullable=False),
    sa.Column('role', _enums["userrole"], nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)
    op.create_index(op.f('ix_users_student_id'), 'users', ['student_id'], unique=True)
    op.create_table('viva_configs',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('created_by', sa.Uuid(), nullable=False),
    sa.Column('title', sa.String(length=256), nullable=False),
    sa.Column('subject', sa.String(length=256), nullable=False),
    sa.Column('topics', sa.JSON(), nullable=False),
    sa.Column('difficulty', sa.String(length=32), nullable=False),
    sa.Column('total_duration_secs', sa.Integer(), nullable=False),
    sa.Column('phase_timings', sa.JSON(), nullable=False),
    sa.Column('rubric_weights', sa.JSON(), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('questions',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('viva_config_id', sa.Uuid(), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('phase', _enums["vivaphase"], nullable=False),
    sa.Column('topic', sa.String(length=256), nullable=True),
    sa.Column('difficulty', sa.String(length=32), nullable=False),
    sa.Column('expected_keywords', sa.JSON(), nullable=False),
    sa.Column('follow_up_hints', sa.JSON(), nullable=False),
    sa.Column('status', _enums["questionstatus"], nullable=False),
    sa.Column('is_ai_generated', sa.Boolean(), nullable=False),
    sa.Column('reviewed_by', sa.Uuid(), nullable=True),
    sa.Column('review_note', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['reviewed_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['viva_config_id'], ['viva_configs.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('viva_sessions',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('viva_config_id', sa.Uuid(), nullable=False),
    sa.Column('student_id', sa.Uuid(), nullable=False),
    sa.Column('status', _enums["sessionstatus"], nullable=False),
    sa.Column('current_phase', _enums["vivaphase"], nullable=False),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('elapsed_secs', sa.Integer(), nullable=False),
    sa.Column('audio_s3_key', sa.String(length=512), nullable=True),
    sa.Column('consent_given', sa.Boolean(), nullable=False),
    sa.Column('consent_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('tab_switch_count', sa.Integer(), nullable=False),
    sa.Column('long_silence_count', sa.Integer(), nullable=False),
    sa.Column('stt_low_confidence_count', sa.Integer(), nullable=False),
    sa.Column('proctoring_events', sa.JSON(), nullable=True),
    sa.Column('total_score', sa.Float(), nullable=True),
    sa.Column('score_breakdown', sa.JSON(), nullable=True),
    sa.Column('score_prompt_version', sa.String(length=32), nullable=True),
    sa.Column('review_status', _enums["reviewstatus"], nullable=False),
    sa.Column('override_score', sa.Float(), nullable=True),
    sa.Column('override_by', sa.Uuid(), nullable=True),
    sa.Column('override_reason', sa.Text(), nullable=True),
    sa.Column('override_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['override_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['student_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['viva_config_id'], ['viva_configs.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('audit_logs',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('session_id', sa.Uuid(), nullable=False),
    sa.Column('actor_id', sa.Uuid(), nullable=True),
    sa.Column('action', sa.String(length=128), nullable=False),
    sa.Column('detail', sa.JSON(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['actor_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['session_id'], ['viva_sessions.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('score_reports',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('session_id', sa.Uuid(), nullable=False),
    sa.Column('prompt_version', sa.String(length=32), nullable=False),
    sa.Column('conceptual_score', sa.Float(), nullable=False),
    sa.Column('depth_reasoning_score', sa.Float(), nullable=False),
    sa.Column('problem_solving_score', sa.Float(), nullable=False),
    sa.Column('practical_project_score', sa.Float(), nullable=False),
    sa.Column('communication_score', sa.Float(), nullable=False),
    sa.Column('conceptual_reason', sa.Text(), nullable=False),
    sa.Column('depth_reasoning_reason', sa.Text(), nullable=False),
    sa.Column('problem_solving_reason', sa.Text(), nullable=False),
    sa.Column('practical_project_reason', sa.Text(), nullable=False),
    sa.Column('communication_reason', sa.Text(), nullable=False),
    sa.Column('conceptual_turn_ids', sa.JSON(), nullable=False),
    sa.Column('depth_reasoning_turn_ids', sa.JSON(), nullable=False),
    sa.Column('problem_solving_turn_ids', sa.JSON(), nullable=False),
    sa.Column('practical_project_turn_ids', sa.JSON(), nullable=False),
    sa.Column('communication_turn_ids', sa.JSON(), nullable=False),
    sa.Column('total_score', sa.Float(), nullable=False),
    sa.Column('feedback_lines', sa.JSON(), nullable=False),
    sa.Column('low_confidence_flag', sa.Boolean(), nullable=False),
    sa.Column('low_confidence_reasons', sa.JSON(), nullable=False),
    sa.Column('computed_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('model_used', sa.String(length=128), nullable=False),
    sa.ForeignKeyConstraint(['session_id'], ['viva_sessions.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('session_id')
    )
    op.create_table('transcript_turns',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('session_id', sa.Uuid(), nullable=False),
    sa.Column('turn_index', sa.Integer(), nullable=False),
    sa.Column('speaker', sa.String(length=16), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('timestamp_secs', sa.Float(), nullable=False),
    sa.Column('duration_secs', sa.Float(), nullable=True),
    sa.Column('stt_confidence', sa.Float(), nullable=True),
    sa.Column('stt_words', sa.JSON(), nullable=True),
    sa.Column('question_id', sa.Uuid(), nullable=True),
    sa.Column('is_variant', sa.Boolean(), nullable=False),
    sa.Column('phase', _enums["vivaphase"], nullable=True),
    sa.Column('answer_label', _enums["answerlabel"], nullable=True),
    sa.Column('classifier_confidence', sa.Float(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['question_id'], ['questions.id'], ),
    sa.ForeignKeyConstraint(['session_id'], ['viva_sessions.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_transcript_session_idx', 'transcript_turns', ['session_id', 'turn_index'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_transcript_session_idx', table_name='transcript_turns')
    op.drop_table('transcript_turns')
    op.drop_table('score_reports')
    op.drop_table('audit_logs')
    op.drop_table('viva_sessions')
    op.drop_table('questions')
    op.drop_table('viva_configs')
    op.drop_index(op.f('ix_users_student_id'), table_name='users')
    op.drop_index(op.f('ix_users_email'), table_name='users')
    op.drop_table('users')
    if op.get_bind().dialect.name == "postgresql":
        for enum in reversed(list(_enums.values())):
            enum.drop(op.get_bind(), checkfirst=not context.is_offline_mode())
