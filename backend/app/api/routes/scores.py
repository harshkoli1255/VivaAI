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
    try:
        session_uuid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session UUID")

    sess_r = await db.execute(select(VivaSession).where(VivaSession.id == session_uuid))
    session = sess_r.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")
    if current.get("role") == "student" and str(session.student_id) != current["sub"]:
        raise HTTPException(status_code=403, detail="Forbidden: You cannot access scores for other candidates")

    r = await db.execute(select(ScoreReport).where(ScoreReport.session_id == session_uuid))
    report = r.scalar_one_or_none()
    if not report:
        if session.override_score is not None:
            return {"session_id": session_id, "total_score": None,
                    "override_score": session.override_score, "effective_score": session.override_score,
                    "dimensions": {}, "feedback_lines": [session.override_reason or "Faculty assessment completed."],
                    "low_confidence_flag": False, "low_confidence_reasons": [], "model_used": "faculty",
                    "prompt_version": None, "computed_at": session.override_at}
        if session.status.value == "flagged":
            raise HTTPException(409, "Your answers are saved. Feedback requires faculty review.")
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


@router.get("/{session_id}/pdf")
async def get_score_pdf(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current: dict = Depends(get_current_user),
):
    """Generate accredited PDF grade report for an examination session."""
    from fastapi.responses import Response
    from sqlalchemy.orm import selectinload
    from app.services.pdf_report import generate_session_pdf_report

    try:
        session_uuid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session UUID")

    stmt = (
        select(VivaSession)
        .options(
            selectinload(VivaSession.student),
            selectinload(VivaSession.viva_config),
            selectinload(VivaSession.score_report),
        )
        .where(VivaSession.id == session_uuid)
    )
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")

    if current.get("role") == "student" and str(session.student_id) != current["sub"]:
        raise HTTPException(status_code=403, detail="Forbidden: You cannot access scores for other candidates")

    report = session.score_report
    if not report:
        raise HTTPException(404, "Score report not yet available for this session")

    rubric_entries = {
        "conceptual": {
            "score": report.conceptual_score,
            "reason": report.conceptual_reason,
            "turn_ids": report.conceptual_turn_ids,
        },
        "depth_reasoning": {
            "score": report.depth_reasoning_score,
            "reason": report.depth_reasoning_reason,
            "turn_ids": report.depth_reasoning_turn_ids,
        },
        "problem_solving": {
            "score": report.problem_solving_score,
            "reason": report.problem_solving_reason,
            "turn_ids": report.problem_solving_turn_ids,
        },
        "practical_project": {
            "score": report.practical_project_score,
            "reason": report.practical_project_reason,
            "turn_ids": report.practical_project_turn_ids,
        },
        "communication": {
            "score": report.communication_score,
            "reason": report.communication_reason,
            "turn_ids": report.communication_turn_ids,
        },
    }

    rubric_weights = (
        session.viva_config.rubric_weights
        if session.viva_config and session.viva_config.rubric_weights
        else {
            "conceptual": 30,
            "depth_reasoning": 25,
            "problem_solving": 20,
            "practical_project": 15,
            "communication": 10,
        }
    )

    pdf_bytes = generate_session_pdf_report(
        session_id=str(session.id),
        student_name=session.student.name if session.student else "Candidate",
        student_id=session.student.student_id if session.student else None,
        viva_title=session.viva_config.title if session.viva_config else "Oral Viva",
        subject=session.viva_config.subject if session.viva_config else "Curriculum",
        started_at=session.started_at,
        ended_at=session.ended_at,
        total_score=report.total_score,
        override_score=session.override_score,
        override_reason=session.override_reason,
        review_status=session.review_status.value if hasattr(session.review_status, "value") else str(session.review_status),
        rubric_entries=rubric_entries,
        rubric_weights=rubric_weights,
        feedback_lines=report.feedback_lines or [],
        proctoring_events=session.proctoring_events or [],
    )

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename=vivaai_accredited_report_{session_id[:8]}.pdf",
            "Cache-Control": "no-cache",
        },
    )
