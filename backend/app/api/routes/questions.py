"""Question bank management endpoints."""
import uuid
from typing import List, Optional, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import require_faculty
from app.db.session import get_db
from app.models.models import Question, QuestionStatus, VivaPhase

router = APIRouter()


class QuestionResponse(BaseModel):
    id: str
    text: str
    phase: str
    topic: Optional[str]
    difficulty: str
    status: str
    is_ai_generated: bool
    review_note: Optional[str]

    model_config = {"from_attributes": True}


class ReviewRequest(BaseModel):
    status: Literal["approved", "rejected"]
    note: Optional[str] = None


class UpdateQuestionRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    text: Optional[str] = Field(default=None, min_length=1, max_length=1024)
    phase: Optional[Literal["warm_up", "fundamentals", "depth", "applied", "wrap_up"]] = None
    topic: Optional[str] = Field(default=None, max_length=256)
    difficulty: Optional[Literal["easy", "medium", "hard"]] = None


@router.get("/config/{config_id}", response_model=List[QuestionResponse])
async def list_questions(
    config_id: uuid.UUID,
    status: Optional[QuestionStatus] = None,
    db: AsyncSession = Depends(get_db),
    current: dict = Depends(require_faculty),
):
    query = select(Question).where(Question.viva_config_id == config_id)
    if status:
        query = query.where(Question.status == QuestionStatus(status))
    query = query.order_by(Question.created_at.desc())
    result = await db.execute(query)
    questions = result.scalars().all()
    return [
        QuestionResponse(
            id=str(q.id), text=q.text, phase=q.phase.value,
            topic=q.topic, difficulty=q.difficulty, status=q.status.value,
            is_ai_generated=q.is_ai_generated, review_note=q.review_note,
        )
        for q in questions
    ]


@router.patch("/{question_id}/review")
async def review_question(
    question_id: uuid.UUID,
    req: ReviewRequest,
    db: AsyncSession = Depends(get_db),
    current: dict = Depends(require_faculty),
):
    result = await db.execute(select(Question).where(Question.id == question_id))
    question = result.scalar_one_or_none()
    if not question:
        raise HTTPException(404, "Question not found")

    try:
        question.status = QuestionStatus(req.status)
    except ValueError:
        raise HTTPException(400, f"Invalid status '{req.status}'")

    question.review_note = req.note
    question.reviewed_by = uuid.UUID(current["sub"])
    await db.commit()
    return {"id": question_id, "status": req.status}


@router.patch("/{question_id}")
async def update_question(
    question_id: uuid.UUID,
    req: UpdateQuestionRequest,
    db: AsyncSession = Depends(get_db),
    current: dict = Depends(require_faculty),
):
    result = await db.execute(select(Question).where(Question.id == question_id))
    question = result.scalar_one_or_none()
    if not question:
        raise HTTPException(404, "Question not found")

    if req.text:
        question.text = req.text
    if req.phase:
        question.phase = VivaPhase(req.phase)
    if req.topic is not None:
        question.topic = req.topic
    if req.difficulty:
        question.difficulty = req.difficulty

    await db.commit()
    return {"id": question_id, "updated": True}


@router.delete("/{question_id}")
async def delete_question(
    question_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current: dict = Depends(require_faculty),
):
    result = await db.execute(select(Question).where(Question.id == question_id))
    question = result.scalar_one_or_none()
    if not question:
        raise HTTPException(404, "Question not found")
    await db.delete(question)
    await db.commit()
    return {"deleted": True}
