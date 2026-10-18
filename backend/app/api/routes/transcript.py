"""Transcript endpoints."""
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.session import get_db
from app.models.models import TranscriptTurn, VivaSession

router = APIRouter()


class TurnResponse(BaseModel):
    id: str
    turn_index: int
    speaker: str
    text: str
    timestamp_secs: float
    duration_secs: Optional[float]
    phase: Optional[str]
    answer_label: Optional[str]
    stt_confidence: Optional[float]
    question_id: Optional[str]
    is_variant: bool


@router.get("/{session_id}")
async def get_transcript(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current: dict = Depends(get_current_user),
):
    # Verify access
    sess_result = await db.execute(
        select(VivaSession).where(VivaSession.id == uuid.UUID(session_id))
    )
    session = sess_result.scalar_one_or_none()
    if not session:
        raise HTTPException(404)
    if current["role"] == "student" and str(session.student_id) != current["sub"]:
        raise HTTPException(403)

    result = await db.execute(
        select(TranscriptTurn)
        .where(TranscriptTurn.session_id == uuid.UUID(session_id))
        .order_by(TranscriptTurn.turn_index)
    )
    turns = result.scalars().all()

    return [
        TurnResponse(
            id=str(t.id),
            turn_index=t.turn_index,
            speaker=t.speaker,
            text=t.text,
            timestamp_secs=t.timestamp_secs,
            duration_secs=t.duration_secs,
            phase=t.phase.value if t.phase else None,
            answer_label=t.answer_label.value if t.answer_label else None,
            stt_confidence=t.stt_confidence,
            question_id=str(t.question_id) if t.question_id else None,
            is_variant=t.is_variant,
        )
        for t in turns
    ]
