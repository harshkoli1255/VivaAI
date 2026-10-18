"""Viva configuration endpoints."""
import uuid
import json
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import require_faculty, get_current_user
from app.db.session import get_db
from app.models.models import VivaConfig, Question, VivaPhase, QuestionStatus

router = APIRouter()


class PhaseTimings(BaseModel):
    warm_up: dict = {"start": 0, "end": 60}
    fundamentals: dict = {"start": 60, "end": 300}
    depth: dict = {"start": 300, "end": 600}
    applied: dict = {"start": 600, "end": 780}
    wrap_up: dict = {"start": 780, "end": 870}
    scoring: dict = {"start": 870, "end": 900}


class CreateVivaConfigRequest(BaseModel):
    title: str
    subject: str
    topics: List[str] = []
    difficulty: str = "medium"
    total_duration_secs: int = 900
    phase_timings: Optional[dict] = None
    rubric_weights: Optional[dict] = None


class VivaConfigResponse(BaseModel):
    id: str
    title: str
    subject: str
    topics: List[str]
    difficulty: str
    total_duration_secs: int
    phase_timings: dict
    rubric_weights: dict
    is_active: bool
    question_count: int = 0

    model_config = {"from_attributes": True}


@router.get("", response_model=List[VivaConfigResponse])
@router.get("/", response_model=List[VivaConfigResponse])
async def list_viva_configs(
    db: AsyncSession = Depends(get_db),
    current: Optional[dict] = Depends(get_current_user),
):
    result = await db.execute(
        select(VivaConfig).where(VivaConfig.is_active == True).order_by(VivaConfig.created_at.desc())
    )
    configs = result.scalars().all()

    responses = []
    for c in configs:
        q_count = await db.execute(
            select(Question).where(Question.viva_config_id == c.id, Question.status == QuestionStatus.approved)
        )
        count = len(q_count.scalars().all())
        resp = VivaConfigResponse(
            id=str(c.id),
            title=c.title,
            subject=c.subject,
            topics=c.topics or [],
            difficulty=c.difficulty,
            total_duration_secs=c.total_duration_secs,
            phase_timings=c.phase_timings,
            rubric_weights=c.rubric_weights,
            is_active=c.is_active,
            question_count=count,
        )
        responses.append(resp)
    return responses


@router.post("", response_model=VivaConfigResponse)
@router.post("/", response_model=VivaConfigResponse)
async def create_viva_config(
    req: CreateVivaConfigRequest,
    db: AsyncSession = Depends(get_db),
    current: dict = Depends(require_faculty),
):
    default_weights = {
        "conceptual": 30, "depth_reasoning": 25,
        "problem_solving": 20, "practical_project": 15, "communication": 10,
    }
    config = VivaConfig(
        id=uuid.uuid4(),
        created_by=uuid.UUID(current["sub"]),
        title=req.title,
        subject=req.subject,
        topics=req.topics,
        difficulty=req.difficulty,
        total_duration_secs=req.total_duration_secs,
        phase_timings=req.phase_timings or {
            "warm_up": {"start": 0, "end": 60},
            "fundamentals": {"start": 60, "end": 300},
            "depth": {"start": 300, "end": 600},
            "applied": {"start": 600, "end": 780},
            "wrap_up": {"start": 780, "end": 870},
            "scoring": {"start": 870, "end": 900},
        },
        rubric_weights=req.rubric_weights or default_weights,
    )
    db.add(config)
    await db.commit()
    return VivaConfigResponse(
        id=str(config.id),
        title=config.title,
        subject=config.subject,
        topics=config.topics,
        difficulty=config.difficulty,
        total_duration_secs=config.total_duration_secs,
        phase_timings=config.phase_timings,
        rubric_weights=config.rubric_weights,
        is_active=config.is_active,
        question_count=0,
    )


@router.get("/{config_id}")
async def get_viva_config(
    config_id: str,
    db: AsyncSession = Depends(get_db),
    current: dict = Depends(require_faculty),
):
    result = await db.execute(select(VivaConfig).where(VivaConfig.id == uuid.UUID(config_id)))
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(404, "Viva config not found")
    return {
        "id": str(config.id),
        "title": config.title,
        "subject": config.subject,
        "topics": config.topics,
        "difficulty": config.difficulty,
        "total_duration_secs": config.total_duration_secs,
        "phase_timings": config.phase_timings,
        "rubric_weights": config.rubric_weights,
    }


@router.post("/{config_id}/generate-questions")
async def generate_questions(
    config_id: str,
    background_tasks: BackgroundTasks,
    syllabus: Optional[str] = None,
    count: int = 10,
    db: AsyncSession = Depends(get_db),
    current: dict = Depends(require_faculty),
):
    """Trigger async LLM question generation from syllabus."""
    from app.workers.tasks import generate_questions_task
    generate_questions_task.delay(config_id, syllabus or "", count)
    return {"message": f"Generating {count} questions in background. Refresh question bank shortly."}


@router.post("/{config_id}/upload-questions")
async def upload_questions(
    config_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current: dict = Depends(require_faculty),
):
    """Upload questions via JSON or CSV file."""
    content = await file.read()
    questions_data = []

    if file.filename.endswith(".json"):
        data = json.loads(content)
        questions_data = data if isinstance(data, list) else data.get("questions", [])
    elif file.filename.endswith(".csv"):
        import csv, io
        reader = csv.DictReader(io.StringIO(content.decode()))
        questions_data = list(reader)
    else:
        raise HTTPException(400, "File must be .json or .csv")

    created = 0
    for q in questions_data:
        text = q.get("text") or q.get("question", "")
        if not text:
            continue
        phase_str = q.get("phase", "fundamentals")
        try:
            phase = VivaPhase(phase_str)
        except ValueError:
            phase = VivaPhase.fundamentals

        question = Question(
            viva_config_id=uuid.UUID(config_id),
            text=text[:1024],
            phase=phase,
            topic=q.get("topic", ""),
            difficulty=q.get("difficulty", "medium"),
            expected_keywords=q.get("keywords", "").split(",") if isinstance(q.get("keywords"), str) else [],
            status=QuestionStatus.pending,
        )
        db.add(question)
        created += 1

    await db.commit()
    return {"created": created, "message": f"Uploaded {created} questions for review"}
