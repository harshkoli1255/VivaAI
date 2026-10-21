"""Viva session management endpoints with strict object authorization."""
import asyncio
from datetime import datetime, timezone
import logging
from typing import List, Optional
import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.security import (
    create_ws_ticket, get_current_user, require_faculty,
)
from app.db.session import get_db
from app.models.models import (
    AuditLog, ReviewStatus, SessionStatus, User, VivaConfig,
    VivaPhase, VivaSession,
)
from app.services.storage import get_audio_storage
from app.services.scoring_jobs import enqueue_scoring

logger = logging.getLogger(__name__)
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
    viva_title: Optional[str] = None
    subject: Optional[str] = None

    model_config = {"from_attributes": True}


class OverrideRequest(BaseModel):
    override_score: float = Field(..., ge=0.0, le=100.0, description="Override score between 0 and 100")
    reason: str = Field(..., min_length=5, max_length=1000, description="Mandatory academic justification")


class WsTicketResponse(BaseModel):
    ticket: str
    session_id: str
    expires_in: int
    ws_url: Optional[str] = None


@router.post("", response_model=SessionResponse)
@router.post("/", response_model=SessionResponse)
async def create_session(
    req: CreateSessionRequest,
    db: AsyncSession = Depends(get_db),
    current: dict = Depends(get_current_user),
):
    """Schedule or initialize a viva session for current candidate."""
    try:
        config_uuid = uuid.UUID(req.viva_config_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid viva config ID")

    if current.get("role") != "student":
        raise HTTPException(status_code=403, detail="Only candidates can create examination sessions")
    from app.services.config_versions import lock_config
    config = await lock_config(db, config_uuid)

    if not config.is_active:
        raise HTTPException(status_code=409, detail="This examination is no longer available")
    if current.get("role") != "student":
        raise HTTPException(status_code=403, detail="Only candidates can create examination sessions")

    student_uuid = uuid.UUID(current["sub"])
    session = VivaSession(
        id=uuid.uuid4(),
        viva_config_id=config_uuid,
        student_id=student_uuid,
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
    """Retrieve all sessions belonging to the authenticated student candidate."""
    try:
        student_uuid = uuid.UUID(current["sub"])
    except ValueError:
        return []

    result = await db.execute(
        select(VivaSession)
        .options(selectinload(VivaSession.viva_config))
        .where(VivaSession.student_id == student_uuid)
        .order_by(VivaSession.created_at.desc())
    )
    sessions = result.scalars().all()
    return [
        SessionResponse(
            id=str(s.id),
            viva_config_id=str(s.viva_config_id),
            student_id=str(s.student_id),
            status=s.status.value,
            current_phase=s.current_phase.value,
            elapsed_secs=s.elapsed_secs,
            consent_given=s.consent_given,
            started_at=s.started_at,
            ended_at=s.ended_at,
            total_score=s.total_score,
            review_status=s.review_status.value,
            viva_title=s.viva_config.title if s.viva_config else None,
            subject=s.viva_config.subject if s.viva_config else None,
        )
        for s in sessions
    ]


@router.get("/{session_id}")
async def get_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current: dict = Depends(get_current_user),
):
    """Retrieve single session with object-level authorization."""
    try:
        session_uuid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session UUID")

    result = await db.execute(
        select(VivaSession)
        .options(selectinload(VivaSession.viva_config))
        .where(VivaSession.id == session_uuid)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Object-level check: students can only see their own sessions
    if current.get("role") == "student" and str(session.student_id) != current["sub"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Candidates may only access their own examination sessions",
        )

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
        "override_reason": session.override_reason,
        "tab_switch_count": session.tab_switch_count,
        "long_silence_count": session.long_silence_count,
        "proctoring_events": session.proctoring_events or [],
        "viva_config": {
            "title": session.viva_config.title if session.viva_config else "",
            "subject": session.viva_config.subject if session.viva_config else "",
            "phase_timings": session.viva_config.phase_timings if session.viva_config else {},
            "total_duration_secs": session.viva_config.total_duration_secs if session.viva_config else 900,
        } if session.viva_config else None,
    }


@router.post("/{session_id}/ws-ticket", response_model=WsTicketResponse)
async def generate_ws_ticket(
    session_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current: dict = Depends(get_current_user),
):
    """Generate a single-use 60s ticket for WebSocket authentication."""
    try:
        session_uuid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session UUID")

    result = await db.execute(select(VivaSession).where(VivaSession.id == session_uuid))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Students can only request ticket for their own session
    if current.get("role") == "student" and str(session.student_id) != current["sub"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot obtain ticket for another candidate's session",
        )

    ticket = create_ws_ticket(session_id, current["sub"], current.get("role", "student"), current.get("jti"))

    ws_url = os.getenv("NEXT_PUBLIC_WS_URL") or getattr(settings, "NEXT_PUBLIC_WS_URL", None) or os.getenv("WS_URL")
    if not ws_url or (settings.IS_PRODUCTION and "trycloudflare" in ws_url):
        host = request.headers.get("x-forwarded-host") or request.headers.get("host") or "localhost:8000"
        proto = "wss" if (request.headers.get("x-forwarded-proto") == "https" or "trycloudflare" in host) else "ws"
        ws_url = f"{proto}://{host}"

    return WsTicketResponse(
        ticket=ticket,
        session_id=session_id,
        expires_in=settings.WS_TICKET_EXPIRE_SECONDS,
        ws_url=ws_url,
    )


@router.post("/{session_id}/start")
async def start_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current: dict = Depends(get_current_user),
):
    """Candidate starts their live examination."""
    try:
        session_uuid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session UUID")

    result = await db.execute(select(VivaSession).where(VivaSession.id == session_uuid))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if current.get("role") == "student" and str(session.student_id) != current["sub"]:
        raise HTTPException(status_code=403, detail="Forbidden")

    if not session.consent_given:
        raise HTTPException(status_code=400, detail="Academic honor consent not granted")

    if session.status not in (SessionStatus.scheduled, SessionStatus.in_progress):
        raise HTTPException(status_code=409, detail="This examination has already ended")
    session.status = SessionStatus.in_progress
    session.started_at = session.started_at or datetime.now(timezone.utc)
    await db.commit()
    return {"status": "started", "started_at": session.started_at}


@router.post("/{session_id}/end")
async def end_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current: dict = Depends(get_current_user),
):
    """End viva examination session and queue scoring task."""
    try:
        session_uuid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session UUID")

    result = await db.execute(select(VivaSession).where(VivaSession.id == session_uuid))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Candidate or faculty only
    if current.get("role") == "student" and str(session.student_id) != current["sub"]:
        raise HTTPException(status_code=403, detail="Forbidden")

    if session.status in (SessionStatus.completed, SessionStatus.flagged):
        return {"status": "completed", "scoring": "already_requested"}
    if session.status != SessionStatus.in_progress:
        raise HTTPException(status_code=409, detail="This examination has not started")
    session.status = SessionStatus.completed
    session.ended_at = datetime.now(timezone.utc)
    await enqueue_scoring(db, session_uuid)
    await db.commit()

    return {"status": "completed", "scoring": "queued"}


@router.post("/{session_id}/consent")
async def give_consent(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current: dict = Depends(get_current_user),
):
    """Grant academic honor consent for this session."""
    try:
        session_uuid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session UUID")

    result = await db.execute(select(VivaSession).where(VivaSession.id == session_uuid))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if current.get("role") == "student" and str(session.student_id) != current["sub"]:
        raise HTTPException(status_code=403, detail="Forbidden: Cannot sign consent for another student")

    session.consent_given = True
    session.consent_at = datetime.now(timezone.utc)
    await db.commit()
    return {"consent_given": True, "consent_at": session.consent_at}


@router.post("/{session_id}/override")
async def override_score(
    session_id: str,
    req: OverrideRequest,
    db: AsyncSession = Depends(get_db),
    current: dict = Depends(require_faculty),
):
    """Faculty mark override with mandatory justification and audit logging."""
    try:
        session_uuid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session UUID")

    result = await db.execute(select(VivaSession).where(VivaSession.id == session_uuid))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if len(req.reason.strip()) < 5:
        raise HTTPException(422, "Provide a justification of at least 5 non-whitespace characters")

    old_score = session.override_score if session.override_score is not None else session.total_score
    session.override_score = req.override_score
    session.override_by = uuid.UUID(current["sub"])
    session.override_reason = req.reason.strip()
    session.override_at = datetime.now(timezone.utc)
    session.review_status = ReviewStatus.overridden

    log = AuditLog(
        session_id=session_uuid,
        actor_id=uuid.UUID(current["sub"]),
        action="score_override",
        detail={
            "old_score": old_score,
            "new_score": req.override_score,
            "reason": req.reason.strip(),
            "actor_role": current.get("role", "faculty"),
        },
    )
    db.add(log)
    await db.commit()
    return {
        "session_id": session_id,
        "override_score": req.override_score,
        "logged": True,
        "timestamp": session.override_at,
    }


@router.post("/{session_id}/audio")
async def upload_session_audio(
    session_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current: dict = Depends(get_current_user),
):
    """Upload recorded examination audio from student viva session."""
    try:
        session_uuid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session UUID")

    result = await db.execute(select(VivaSession).where(VivaSession.id == session_uuid))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if current.get("role") == "student" and str(session.student_id) != current["sub"]:
        raise HTTPException(status_code=403, detail="Forbidden: Cannot upload audio for other students")

    allowed_types = {"audio/webm", "video/webm", "audio/ogg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/mpeg"}
    if (file.content_type or "").split(";")[0] not in allowed_types:
        raise HTTPException(status_code=415, detail="Unsupported audio format")
    content = await file.read(settings.MAX_AUDIO_UPLOAD_BYTES + 1)
    if len(content) > settings.MAX_AUDIO_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Audio recording exceeds the upload limit")
    if not content:
        raise HTTPException(status_code=400, detail="Audio file payload is empty")

    storage = get_audio_storage()
    content_type = file.content_type or "audio/webm"
    audio_key = storage.save_session_audio(session_id, content, content_type=content_type)

    session.audio_s3_key = audio_key
    await db.commit()

    logger.info(f"Uploaded {len(content)} bytes of audio for session {session_id} (key: {audio_key})")
    return {
        "status": "uploaded",
        "session_id": session_id,
        "audio_key": audio_key,
        "size_bytes": len(content),
        "content_type": content_type,
        "audio_url": f"/api/v1/sessions/{session_id}/audio/stream",
    }


@router.get("/{session_id}/audio/stream")
async def stream_session_audio(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current: dict = Depends(get_current_user),
):
    """Directly stream examination audio with range header support for scrubbing."""
    try:
        session_uuid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session UUID")

    result = await db.execute(select(VivaSession).where(VivaSession.id == session_uuid))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if current.get("role") == "student" and str(session.student_id) != current["sub"]:
        raise HTTPException(status_code=403, detail="Forbidden: You cannot access audio for other sessions")

    from app.api.routes.recordings import reconstructed_audio
    reconstructed = await reconstructed_audio(db, session_uuid)
    if reconstructed is not None:
        return reconstructed

    storage = get_audio_storage()
    local_path = storage.get_local_audio_path(session.audio_s3_key or session_id)
    if local_path and local_path.exists():
        media_type = "audio/webm"
        if local_path.suffix.lower() == ".wav":
            media_type = "audio/wav"
        elif local_path.suffix.lower() == ".mp4":
            media_type = "audio/mp4"

        return FileResponse(
            path=str(local_path),
            media_type=media_type,
            filename=f"session_{session_id}{local_path.suffix}",
            headers={"Accept-Ranges": "bytes", "Cache-Control": "private, no-store"},
        )

    # If S3 presigned URL is available, redirect
    if session.audio_s3_key:
        presigned = storage.get_presigned_url(session.audio_s3_key)
        if presigned:
            from fastapi.responses import RedirectResponse
            return RedirectResponse(presigned)

    raise HTTPException(status_code=404, detail="Session audio recording is not available")


@router.get("/{session_id}/audio")
async def get_session_audio(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current: dict = Depends(get_current_user),
):
    """Retrieve session audio playback URL."""
    try:
        session_uuid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session UUID")

    result = await db.execute(select(VivaSession).where(VivaSession.id == session_uuid))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if current.get("role") == "student" and str(session.student_id) != current["sub"]:
        raise HTTPException(status_code=403, detail="Forbidden: You cannot access audio for other sessions")

    storage = get_audio_storage()
    from app.models.models import AudioChunk
    chunk_exists = await db.scalar(select(AudioChunk.id).where(AudioChunk.session_id == session_uuid).limit(1))
    has_audio = storage.has_audio(session.audio_s3_key or session_id)

    if chunk_exists or has_audio or session.audio_s3_key:
        audio_stream_url = f"/api/v1/sessions/{session_id}/audio/stream"
        return {
            "session_id": session_id,
            "audio_url": audio_stream_url,
            "status": "ready",
        }

    return {
        "session_id": session_id,
        "audio_url": None,
        "status": "not_recorded",
        "message": "Session audio stream has not been recorded yet.",
    }


@router.get("/{session_id}/scoring")
async def scoring_status(session_id: uuid.UUID, db: AsyncSession = Depends(get_db), current=Depends(get_current_user)):
    from app.models.models import ScoringJob
    session = await db.get(VivaSession, session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    if current.get("role") == "student" and str(session.student_id) != current["sub"]:
        raise HTTPException(403, "Session access denied")
    job = await db.get(ScoringJob, session_id)
    return {"status": job.status if job else ("completed" if session.total_score is not None else "not_requested"),
            "attempts": job.attempts if job else 0, "message": job.last_error if job else None,
            "review_status": session.review_status.value}


@router.post("/{session_id}/scoring/retry")
async def retry_scoring(session_id: uuid.UUID, db: AsyncSession = Depends(get_db), current=Depends(require_faculty)):
    from app.models.models import ScoringJob
    from app.services.scoring_jobs import now
    session = await db.get(VivaSession, session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    job = await db.get(ScoringJob, session_id)
    if not job or job.status != "failed":
        raise HTTPException(409, "Only failed evaluations can be retried")
    job.status, job.attempts, job.available_at, job.last_error = "queued", 0, now(), None
    job.claim_token = job.lease_until = None
    session.status = SessionStatus.completed
    db.add(AuditLog(session_id=session_id, actor_id=uuid.UUID(current["sub"]), action="scoring_retry_requested", detail={}))
    await db.commit()
    return {"status": "queued"}


class RetentionHoldRequest(BaseModel):
    hold: bool
    reason: str = Field(min_length=5, max_length=1000)


@router.post("/{session_id}/retention-hold")
async def set_retention_hold(session_id: uuid.UUID, req: RetentionHoldRequest,
        db: AsyncSession = Depends(get_db), current: dict = Depends(require_faculty)):
    session = await db.scalar(select(VivaSession).where(VivaSession.id == session_id).with_for_update())
    if not session:
        raise HTTPException(404, "Session not found")
    if not req.reason.strip() or len(req.reason.strip()) < 5:
        raise HTTPException(422, "Explain why the retention hold is changing")
    old = session.retention_hold
    session.retention_hold = req.hold
    db.add(AuditLog(session_id=session_id, actor_id=uuid.UUID(current["sub"]), action="retention_hold_changed",
                    detail={"previous": old, "hold": req.hold, "reason": req.reason.strip()}))
    await db.commit()
    return {"session_id": str(session_id), "retention_hold": session.retention_hold}
