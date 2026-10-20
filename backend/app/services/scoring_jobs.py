"""Durable database job queue. Completion and enqueue share one transaction."""
import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone
from sqlalchemy import select, update, or_, and_
from app.db.session import AsyncSessionLocal
from app.models.models import ScoreReport, ScoringJob, VivaSession, SessionStatus, ReviewStatus, AuditLog

logger = logging.getLogger(__name__)
LEASE_SECONDS = 120
MAX_ATTEMPTS = 3


def now():
    return datetime.now(timezone.utc)


async def enqueue_scoring(db, session_id):
    # Atomic insertion keeps HTTP and WebSocket completion retries idempotent.
    from sqlalchemy.dialects.sqlite import insert as sqlite_insert
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    insert = pg_insert if db.get_bind().dialect.name == "postgresql" else sqlite_insert
    await db.execute(insert(ScoringJob).values(session_id=session_id, status="queued", attempts=0,
        available_at=now(), created_at=now(), updated_at=now()).on_conflict_do_nothing(index_elements=["session_id"]))


async def claim_job():
    timestamp = now()
    eligible = or_(and_(ScoringJob.status == "queued", ScoringJob.available_at <= timestamp),
                   and_(ScoringJob.status == "processing", ScoringJob.lease_until <= timestamp))
    async with AsyncSessionLocal() as db:
        exhausted = (await db.execute(update(ScoringJob).where(ScoringJob.status == "processing",
            ScoringJob.lease_until <= timestamp, ScoringJob.attempts >= MAX_ATTEMPTS).values(
            status="failed", claim_token=None, lease_until=None, last_error="Evaluation worker stopped repeatedly. Faculty review required.").returning(ScoringJob.session_id))).scalars().all()
        if exhausted:
            await db.execute(update(VivaSession).where(VivaSession.id.in_(exhausted)).values(
                status=SessionStatus.flagged, review_status=ReviewStatus.pending))
            await db.commit()
        candidate = await db.scalar(select(ScoringJob.session_id).where(eligible).order_by(ScoringJob.created_at).limit(1))
        if not candidate:
            return None
        token = uuid.uuid4()
        result = await db.execute(update(ScoringJob).where(ScoringJob.session_id == candidate, eligible).values(
            status="processing", attempts=ScoringJob.attempts + 1, claim_token=token,
            lease_until=timestamp + timedelta(seconds=LEASE_SECONDS), updated_at=timestamp))
        await db.commit()
        return (candidate, token) if result.rowcount else None


async def renew(session_id, token):
    while True:
        await asyncio.sleep(20)
        async with AsyncSessionLocal() as db:
            result = await db.execute(update(ScoringJob).where(ScoringJob.session_id == session_id,
                ScoringJob.claim_token == token, ScoringJob.status == "processing").values(
                lease_until=now() + timedelta(seconds=LEASE_SECONDS)))
            await db.commit()
            if not result.rowcount:
                return


async def process_one_job():
    claim = await claim_job()
    if not claim:
        return False
    session_id, token = claim
    heartbeat = asyncio.create_task(renew(session_id, token))
    try:
        from app.workers.tasks import _score_session_async
        await _score_session_async(str(session_id), claim_token=token)
    except asyncio.CancelledError:
        async with AsyncSessionLocal() as db:
            await db.execute(update(ScoringJob).where(ScoringJob.session_id == session_id,
                ScoringJob.claim_token == token).values(status="queued", claim_token=None, lease_until=None, available_at=now()))
            await db.commit()
        raise
    except Exception:
        logger.exception("Scoring attempt failed for %s", session_id)
        async with AsyncSessionLocal() as db:
            job = await db.get(ScoringJob, session_id)
            if job and job.claim_token == token and job.status == "processing":
                terminal = job.attempts >= MAX_ATTEMPTS
                job.status = "failed" if terminal else "queued"
                job.last_error = "Evaluation unavailable. Faculty review required." if terminal else "Evaluation failed; retry scheduled."
                job.available_at = now() + timedelta(seconds=min(60, 2 ** job.attempts))
                job.claim_token = job.lease_until = None
                job.updated_at = now()
                if terminal:
                    session = await db.get(VivaSession, session_id)
                    session.status = SessionStatus.flagged
                    session.review_status = ReviewStatus.pending
                    db.add(AuditLog(session_id=session_id, action="scoring_failed", detail={"attempts": job.attempts}))
                await db.commit()
    finally:
        heartbeat.cancel()
        await asyncio.gather(heartbeat, return_exceptions=True)
    return True


async def reconcile_completed_sessions():
    """Recover pre-upgrade completions which never received a durable job."""
    async with AsyncSessionLocal() as db:
        missing = (await db.scalars(select(VivaSession.id).where(
            VivaSession.status == SessionStatus.completed,
            ~select(ScoreReport.id).where(ScoreReport.session_id == VivaSession.id).exists(),
            ~select(ScoringJob.session_id).where(ScoringJob.session_id == VivaSession.id).exists()).limit(100))).all()
        for session_id in missing:
            await enqueue_scoring(db, session_id)
        await db.commit()


async def run_scoring_worker():
    reconcile_at = 0
    while True:
        try:
            if asyncio.get_running_loop().time() >= reconcile_at:
                await reconcile_completed_sessions()
                reconcile_at = asyncio.get_running_loop().time() + 60
            if not await process_one_job():
                await asyncio.sleep(1)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Scoring queue temporarily unavailable")
            await asyncio.sleep(2)
