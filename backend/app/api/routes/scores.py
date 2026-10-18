"""Score report endpoints."""
import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user, require_faculty
from app.db.session import get_db
from app.models.models import ScoreReport, VivaSession

router = APIRouter()


@router.get("/{session_id}")
async def get_score(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current: dict = Depends(get_current_user),
):
    sess_r = await db.execute(select(VivaSession).where(VivaSession.id == uuid.UUID(session_id)))
    session = sess_r.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")
    if current["role"] == "student" and str(session.student_id) != current["sub"]:
        raise HTTPException(403)

    r = await db.execute(select(ScoreReport).where(ScoreReport.session_id == uuid.UUID(session_id)))
    report = r.scalar_one_or_none()
    if not report:
        raise HTTPException(404, "Score not yet available")

    return {
        "session_id": session_id,
        "total_score": report.total_score,
        "override_score": session.override_score,
        "effective_score": session.override_score if session.override_score is not None else report.total_score,
        "dimensions": {
            "conceptual": {
                "score": report.conceptual_score, "reason": report.conceptual_reason,
                "turn_ids": report.conceptual_turn_ids,
            },
            "depth_reasoning": {
                "score": report.depth_reasoning_score, "reason": report.depth_reasoning_reason,
                "turn_ids": report.depth_reasoning_turn_ids,
            },
            "problem_solving": {
                "score": report.problem_solving_score, "reason": report.problem_solving_reason,
                "turn_ids": report.problem_solving_turn_ids,
            },
            "practical_project": {
                "score": report.practical_project_score, "reason": report.practical_project_reason,
                "turn_ids": report.practical_project_turn_ids,
            },
            "communication": {
                "score": report.communication_score, "reason": report.communication_reason,
                "turn_ids": report.communication_turn_ids,
            },
        },
        "feedback_lines": report.feedback_lines,
        "low_confidence_flag": report.low_confidence_flag,
        "low_confidence_reasons": report.low_confidence_reasons,
        "prompt_version": report.prompt_version,
        "model_used": report.model_used,
        "computed_at": report.computed_at,
    }
