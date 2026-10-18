"""Faculty dashboard aggregation endpoints with CSV export."""
import csv
import io
import uuid
from typing import Optional, List

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select, func, and_
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import require_faculty
from app.db.session import get_db
from app.models.models import (
    VivaSession, User, VivaConfig, ScoreReport, AuditLog,
    SessionStatus, ReviewStatus,
)

router = APIRouter()


@router.get("/stats")
async def dashboard_stats(
    db: AsyncSession = Depends(get_db),
    current: dict = Depends(require_faculty),
):
    """Summary statistics for the dashboard."""
    total = await db.execute(select(func.count(VivaSession.id)))
    completed = await db.execute(
        select(func.count(VivaSession.id)).where(VivaSession.status == SessionStatus.completed)
    )
    flagged = await db.execute(
        select(func.count(VivaSession.id)).where(VivaSession.status == SessionStatus.flagged)
    )
    pending_review = await db.execute(
        select(func.count(VivaSession.id)).where(VivaSession.review_status == ReviewStatus.pending)
    )
    avg_score = await db.execute(
        select(func.avg(VivaSession.total_score)).where(VivaSession.total_score != None)
    )

    return {
        "total_sessions": total.scalar() or 0,
        "completed_sessions": completed.scalar() or 0,
        "flagged_sessions": flagged.scalar() or 0,
        "pending_review": pending_review.scalar() or 0,
        "average_score": round(float(avg_score.scalar() or 0), 1),
    }


@router.get("/sessions")
async def list_sessions(
    status: Optional[str] = None,
    review_status: Optional[str] = None,
    config_id: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
    current: dict = Depends(require_faculty),
):
    """Paginated, filterable session list."""
    query = (
        select(VivaSession)
        .options(
            selectinload(VivaSession.student),
            selectinload(VivaSession.viva_config),
        )
        .order_by(VivaSession.created_at.desc())
    )

    if status:
        query = query.where(VivaSession.status == SessionStatus(status))
    if review_status:
        query = query.where(VivaSession.review_status == ReviewStatus(review_status))
    if config_id:
        query = query.where(VivaSession.viva_config_id == uuid.UUID(config_id))

    # Count total
    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    # Paginate
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    sessions = result.scalars().all()

    items = []
    for s in sessions:
        items.append({
            "id": str(s.id),
            "student_name": s.student.name if s.student else "Unknown",
            "student_id_code": s.student.student_id if s.student else "",
            "viva_title": s.viva_config.title if s.viva_config else "",
            "subject": s.viva_config.subject if s.viva_config else "",
            "status": s.status.value,
            "review_status": s.review_status.value,
            "total_score": s.total_score,
            "override_score": s.override_score,
            "effective_score": s.override_score if s.override_score is not None else s.total_score,
            "started_at": s.started_at,
            "ended_at": s.ended_at,
            "tab_switch_count": s.tab_switch_count,
            "long_silence_count": s.long_silence_count,
        })

    return {"total": total, "page": page, "page_size": page_size, "items": items}


@router.get("/sessions/{session_id}/detail")
async def session_detail(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current: dict = Depends(require_faculty),
):
    """Full session detail for dashboard review page."""
    from app.models.models import TranscriptTurn
    from app.services.storage import get_audio_storage

    result = await db.execute(
        select(VivaSession)
        .options(
            selectinload(VivaSession.student),
            selectinload(VivaSession.viva_config),
            selectinload(VivaSession.turns),
            selectinload(VivaSession.score_report),
            selectinload(VivaSession.audit_logs),
        )
        .where(VivaSession.id == uuid.UUID(session_id))
    )
    session = result.scalar_one_or_none()
    if not session:
        from fastapi import HTTPException
        raise HTTPException(404)

    # Audio URL
    audio_url = None
    if session.audio_s3_key:
        try:
            storage = get_audio_storage()
            if storage:
                audio_url = storage.get_presigned_url(session.audio_s3_key)
        except Exception:
            pass

    return {
        "session": {
            "id": str(session.id),
            "status": session.status.value,
            "review_status": session.review_status.value,
            "started_at": session.started_at,
            "ended_at": session.ended_at,
            "total_score": session.total_score,
            "override_score": session.override_score,
            "override_reason": session.override_reason,
            "override_at": session.override_at,
            "tab_switch_count": session.tab_switch_count,
            "long_silence_count": session.long_silence_count,
            "audio_url": audio_url,
        },
        "student": {
            "id": str(session.student.id) if session.student else None,
            "name": session.student.name if session.student else "Unknown",
            "student_id": session.student.student_id if session.student else None,
        },
        "viva_config": {
            "title": session.viva_config.title if session.viva_config else "",
            "subject": session.viva_config.subject if session.viva_config else "",
            "rubric_weights": session.viva_config.rubric_weights if session.viva_config else {},
        },
        "transcript": [
            {
                "id": str(t.id),
                "turn_index": t.turn_index,
                "speaker": t.speaker,
                "text": t.text,
                "timestamp_secs": t.timestamp_secs,
                "phase": t.phase.value if t.phase else None,
                "answer_label": t.answer_label.value if t.answer_label else None,
                "stt_confidence": t.stt_confidence,
            }
            for t in sorted(session.turns, key=lambda x: x.turn_index)
        ],
        "score_report": {
            "total_score": session.score_report.total_score,
            "dimensions": {
                "conceptual": {"score": session.score_report.conceptual_score,
                               "reason": session.score_report.conceptual_reason,
                               "turn_ids": session.score_report.conceptual_turn_ids},
                "depth_reasoning": {"score": session.score_report.depth_reasoning_score,
                                    "reason": session.score_report.depth_reasoning_reason,
                                    "turn_ids": session.score_report.depth_reasoning_turn_ids},
                "problem_solving": {"score": session.score_report.problem_solving_score,
                                    "reason": session.score_report.problem_solving_reason,
                                    "turn_ids": session.score_report.problem_solving_turn_ids},
                "practical_project": {"score": session.score_report.practical_project_score,
                                      "reason": session.score_report.practical_project_reason,
                                      "turn_ids": session.score_report.practical_project_turn_ids},
                "communication": {"score": session.score_report.communication_score,
                                  "reason": session.score_report.communication_reason,
                                  "turn_ids": session.score_report.communication_turn_ids},
            },
            "feedback_lines": session.score_report.feedback_lines,
            "low_confidence_flag": session.score_report.low_confidence_flag,
            "low_confidence_reasons": session.score_report.low_confidence_reasons,
            "prompt_version": session.score_report.prompt_version,
        } if session.score_report else None,
        "audit_logs": [
            {
                "action": log.action,
                "detail": log.detail,
                "created_at": log.created_at,
            }
            for log in sorted(session.audit_logs, key=lambda x: x.created_at)
        ],
    }


@router.get("/export/csv")
async def export_csv(
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current: dict = Depends(require_faculty),
):
    """Export all sessions as CSV."""
    query = (
        select(VivaSession)
        .options(
            selectinload(VivaSession.student),
            selectinload(VivaSession.viva_config),
        )
        .order_by(VivaSession.created_at.desc())
    )
    if status:
        query = query.where(VivaSession.status == SessionStatus(status))

    result = await db.execute(query)
    sessions = result.scalars().all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "session_id", "student_name", "student_id", "viva_title", "subject",
        "status", "review_status", "total_score", "override_score",
        "effective_score", "started_at", "ended_at",
        "tab_switches", "long_silences",
    ])

    for s in sessions:
        effective = s.override_score if s.override_score is not None else s.total_score
        writer.writerow([
            str(s.id),
            s.student.name if s.student else "",
            s.student.student_id if s.student else "",
            s.viva_config.title if s.viva_config else "",
            s.viva_config.subject if s.viva_config else "",
            s.status.value, s.review_status.value,
            s.total_score, s.override_score, effective,
            s.started_at, s.ended_at,
            s.tab_switch_count, s.long_silence_count,
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.read()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=vivaai_export.csv"},
    )
