"""Policy-gated retention of reviewed, ended records; disabled by default.

Deletion covers the live database and known application audio copies. Backup,
provider and exported/on-device copies require the institution's separate policy.
Never execute against a real dataset without institutional authorization.
"""
from datetime import datetime, timezone, timedelta
from sqlalchemy import select, delete, exists
from app.core.config import settings
from app.models.models import VivaSession, SessionStatus, ReviewStatus, ScoringJob, AudioChunk, TranscriptTurn, ScoreReport, AuditLog


def approved_cutoff(now=None):
    if not settings.RETENTION_POLICY_ID.strip() or not 1 <= settings.RETENTION_DAYS <= 36500:
        raise ValueError('Retention is disabled: configure an approved policy ID and positive RETENTION_DAYS')
    return (now or datetime.now(timezone.utc)) - timedelta(days=settings.RETENTION_DAYS)


def eligibility(cutoff):
    busy_job = exists(select(ScoringJob.session_id).where(ScoringJob.session_id == VivaSession.id,
                      ScoringJob.status.in_(['queued', 'processing'])))
    return (VivaSession.status.in_([SessionStatus.completed, SessionStatus.flagged]),
            VivaSession.ended_at.is_not(None), VivaSession.ended_at < cutoff,
            VivaSession.retention_hold.is_(False),
            VivaSession.review_status.in_([ReviewStatus.reviewed, ReviewStatus.overridden]), ~busy_job)


async def plan(db, now=None):
    cutoff = approved_cutoff(now)
    records = (await db.scalars(select(VivaSession).where(*eligibility(cutoff)).order_by(VivaSession.ended_at))).all()
    return {'policy_id': settings.RETENTION_POLICY_ID, 'days': settings.RETENTION_DAYS,
            'cutoff': cutoff.isoformat(), 'eligible_session_ids': [str(row.id) for row in records],
            'scope': 'Live database and known application audio only. Backups, providers, exports and browser copies need separate handling.'}


async def purge_one(db, session_id, delete_audio, now=None):
    # Recheck eligibility under the row lock immediately before deleting. Holds
    # or a restarted scoring job added after a dry-run always take precedence.
    row = await db.scalar(select(VivaSession).where(VivaSession.id == session_id,
                          *eligibility(approved_cutoff(now))).with_for_update())
    if not row:
        return False
    await delete_audio(row)  # Must fail visibly if a configured external copy cannot be deleted.
    for model in (AudioChunk, TranscriptTurn, ScoreReport, ScoringJob, AuditLog):
        await db.execute(delete(model).where(model.session_id == session_id))
    await db.execute(delete(VivaSession).where(VivaSession.id == session_id))
    await db.commit()
    return True
