"""Viva session management endpoints."""
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user, require_faculty
from app.db.session import get_db
from app.models.models import (
    VivaSession, VivaConfig, User, SessionStatus,
    VivaPhase, ReviewStatus, AuditLog,
)

router = APIRouter()


class CreateSessionRequest(BaseModel):
    viva_config_id: str
    consent_given: bool = False


class SessionResponse(BaseModel):
    id: str
    viva_config_id: str
    student_id: str
    status: str
    current_phase: str
    elapsed_secs: int
    consent_given: bool
    started_at: Optional[datetime]
    ended_at: Optional[datetime]
    total_score: Optional[float]
    review_status: str

    model_config = {"from_attributes": True}


class OverrideRequest(BaseModel):
    override_score: float
    reason: str


@router.post("", response_model=SessionResponse)
@router.post("/", response_model=SessionResponse)
async def create_session(
    req: CreateSessionRequest,
    db: AsyncSession = Depends(get_db),
    current: dict = Depends(get_current_user),
):
    # Validate config exists
    config_result = await db.execute(
        select(VivaConfig).where(VivaConfig.id == uuid.UUID(req.viva_config_id))
    )
    config = config_result.scalar_one_or_none()
    if not config:
        raise HTTPException(404, "Viva config not found")

    session = VivaSession(
        id=uuid.uuid4(),
        viva_config_id=uuid.UUID(req.viva_config_id),
        student_id=uuid.UUID(current["sub"]),
        status=SessionStatus.scheduled,
        current_phase=VivaPhase.warm_up,
        consent_given=req.consent_given,
        consent_at=datetime.now(timezone.utc) if req.consent_given else None,
    )
    db.add(session)
    await db.commit()

    return SessionResponse(
        id=str(session.id),
        viva_config_id=str(session.viva_config_id),
        student_id=str(session.student_id),
        status=session.status.value,
        current_phase=session.current_phase.value,
        elapsed_secs=session.elapsed_secs,
        consent_given=session.consent_given,
        started_at=session.started_at,
        ended_at=session.ended_at,
        total_score=session.total_score,
        review_status=session.review_status.value,
    )


@router.get("/my", response_model=List[SessionResponse])
async def my_sessions(
    db: AsyncSession = Depends(get_db),
    current: dict = Depends(get_current_user),
):
    result = await db.execute(
        select(VivaSession)
        .where(VivaSession.student_id == uuid.UUID(current["sub"]))
        .order_by(VivaSession.created_at.desc())
    )
    sessions = result.scalars().all()
    return [
        SessionResponse(
            id=str(s.id), viva_config_id=str(s.viva_config_id),
            student_id=str(s.student_id), status=s.status.value,
            current_phase=s.current_phase.value, elapsed_secs=s.elapsed_secs,
            consent_given=s.consent_given, started_at=s.started_at,
            ended_at=s.ended_at, total_score=s.total_score,
            review_status=s.review_status.value,
        )
        for s in sessions
    ]


@router.get("/{session_id}")
async def get_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current: dict = Depends(get_current_user),
):
    result = await db.execute(
        select(VivaSession)
        .options(selectinload(VivaSession.viva_config))
        .where(VivaSession.id == uuid.UUID(session_id))
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")

    # Students can only see their own
    if current["role"] == "student" and str(session.student_id) != current["sub"]:
        raise HTTPException(403)

    return {
        "id": str(session.id),
        "viva_config_id": str(session.viva_config_id),
        "student_id": str(session.student_id),
        "status": session.status.value,
        "current_phase": session.current_phase.value,
        "elapsed_secs": session.elapsed_secs,
        "consent_given": session.consent_given,
        "started_at": session.started_at,
        "ended_at": session.ended_at,
        "total_score": session.total_score,
        "score_breakdown": session.score_breakdown,
        "review_status": session.review_status.value,
        "override_score": session.override_score,
        "tab_switch_count": session.tab_switch_count,
        "long_silence_count": session.long_silence_count,
        "viva_config": {
            "title": session.viva_config.title if session.viva_config else "",
            "subject": session.viva_config.subject if session.viva_config else "",
            "phase_timings": session.viva_config.phase_timings if session.viva_config else {},
            "total_duration_secs": session.viva_config.total_duration_secs if session.viva_config else 900,
        } if session.viva_config else None,
    }


@router.post("/{session_id}/start")
async def start_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current: dict = Depends(get_current_user),
):
    result = await db.execute(select(VivaSession).where(VivaSession.id == uuid.UUID(session_id)))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404)
    if str(session.student_id) != current["sub"]:
        raise HTTPException(403)
    if not session.consent_given:
        raise HTTPException(400, "Consent not given")

    session.status = SessionStatus.in_progress
    session.started_at = datetime.now(timezone.utc)
    await db.commit()
    return {"status": "started", "started_at": session.started_at}


@router.post("/{session_id}/end")
async def end_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current: dict = Depends(get_current_user),
):
    result = await db.execute(select(VivaSession).where(VivaSession.id == uuid.UUID(session_id)))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404)

    session.status = SessionStatus.completed
    session.ended_at = datetime.now(timezone.utc)
    await db.commit()

    # Trigger scoring job
    from app.workers.tasks import score_session_task
    score_session_task.delay(session_id)

    return {"status": "completed", "scoring": "queued"}


@router.post("/{session_id}/consent")
async def give_consent(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current: dict = Depends(get_current_user),
):
    result = await db.execute(select(VivaSession).where(VivaSession.id == uuid.UUID(session_id)))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404)
    session.consent_given = True
    session.consent_at = datetime.now(timezone.utc)
    await db.commit()
    return {"consent_given": True}


@router.post("/{session_id}/override")
async def override_score(
    session_id: str,
    req: OverrideRequest,
    db: AsyncSession = Depends(get_db),
    current: dict = Depends(require_faculty),
):
    """Faculty override — always wins, logged in audit trail."""
    if not (0 <= req.override_score <= 100):
        raise HTTPException(400, "Score must be 0-100")

    result = await db.execute(select(VivaSession).where(VivaSession.id == uuid.UUID(session_id)))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404)

    old_score = session.total_score
    session.override_score = req.override_score
    session.override_by = uuid.UUID(current["sub"])
    session.override_reason = req.reason
    session.override_at = datetime.now(timezone.utc)
    session.review_status = ReviewStatus.overridden

    log = AuditLog(
        session_id=uuid.UUID(session_id),
        actor_id=uuid.UUID(current["sub"]),
        action="score_override",
        detail={
            "old_score": old_score,
            "new_score": req.override_score,
            "reason": req.reason,
        },
    )
    db.add(log)
    await db.commit()
    return {"override_score": req.override_score, "logged": True}
