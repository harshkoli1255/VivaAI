import logging
import uuid
import json
import math
from typing import List, Optional, Literal

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import require_faculty, get_current_user
from app.db.session import get_db
from app.models.models import VivaConfig, Question, VivaPhase, QuestionStatus
from app.services.llm_provider import get_llm_provider

logger = logging.getLogger(__name__)

router = APIRouter()


class PhaseTimings(BaseModel):
    warm_up: dict = {"start": 0, "end": 60}
    fundamentals: dict = {"start": 60, "end": 300}
    depth: dict = {"start": 300, "end": 600}
    applied: dict = {"start": 600, "end": 780}
    wrap_up: dict = {"start": 780, "end": 870}
    scoring: dict = {"start": 870, "end": 900}


class GeneratePreviewQuestionsRequest(BaseModel):
    syllabus: str
    subject: Optional[str] = "Computer Science"
    difficulty: Optional[str] = "medium"
    count: Optional[int] = 6


class CreateVivaConfigRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    subject: str = Field(min_length=1, max_length=255)
    topics: List[str] = Field(default_factory=list)
    difficulty: Literal["easy", "medium", "hard"] = "medium"
    total_duration_secs: int = Field(default=900, ge=60, le=7200)
    phase_timings: Optional[dict] = None
    rubric_weights: Optional[dict] = None
    questions: Optional[List[dict]] = None

    @model_validator(mode="after")
    def validate_assessment(self):
        self.title, self.subject = self.title.strip(), self.subject.strip()
        if not self.title or not self.subject:
            raise ValueError("Title and subject cannot be blank")
        from app.services.controller import DEFAULT_PHASE_TIMINGS
        if self.phase_timings is None:
            self.phase_timings = {
                phase.value: {"start": round(timing["start"] * self.total_duration_secs / 900),
                              "end": round(timing["end"] * self.total_duration_secs / 900)}
                for phase, timing in DEFAULT_PHASE_TIMINGS.items()
            }
        if set(self.phase_timings) != {phase.value for phase in DEFAULT_PHASE_TIMINGS}:
            raise ValueError("Phase timings must include all six examination phases")
        previous_end = 0
        for phase in DEFAULT_PHASE_TIMINGS:
            timing = self.phase_timings[phase.value]
            if (not isinstance(timing, dict) or not isinstance(timing.get("start"), int)
                    or not isinstance(timing.get("end"), int) or timing["start"] != previous_end
                    or timing["end"] <= timing["start"]):
                raise ValueError("Phase timings must be contiguous, positive integer intervals starting at zero")
            previous_end = timing["end"]
        if previous_end != self.total_duration_secs:
            raise ValueError("Phase timings must end at the configured examination duration")
        if self.rubric_weights is not None:
            dimensions = {"conceptual", "depth_reasoning", "problem_solving", "practical_project", "communication"}
            if set(self.rubric_weights) != dimensions:
                raise ValueError("Rubric must include all five scoring dimensions")
            values = list(self.rubric_weights.values())
            if (any(not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0 for value in values)
                    or not math.isclose(sum(values), 100, abs_tol=0.001)):
                raise ValueError("Rubric weights must be finite, non-negative and sum to 100")
        return self


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


@router.post("/generate-preview-questions")
async def generate_preview_questions(
    req: GeneratePreviewQuestionsRequest,
    current: dict = Depends(require_faculty),
):
    """Generate on-the-fly technical viva questions from syllabus using fast LLM (Groq)."""
    llm = get_llm_provider()
    target_count = max(3, min(req.count or 6, 12))

    messages = [
        {
            "role": "system",
            "content": (
                "You are an expert university technical viva examiner. Generate diverse, high-caliber examination questions "
                "from the provided syllabus or topic outline.\n"
                "You MUST return a JSON object with this exact shape:\n"
                '{"questions": [{"text": "...", "phase": "fundamentals", "topic": "...", "difficulty": "medium"}]}\n'
                "Phases must be chosen from: 'fundamentals', 'depth', 'applied', 'wrap_up'.\n"
                "Difficulties must be chosen from: 'easy', 'medium', 'hard'."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Subject: {req.subject or 'Technical Assessment'}\n"
                f"Target Difficulty: {req.difficulty}\n"
                f"Target Question Count: {target_count}\n\n"
                f"SYLLABUS / COURSE TOPICS:\n{req.syllabus[:4000]}"
            ),
        },
    ]

    try:
        result = await llm.chat_json(messages, temperature=0.7, max_tokens=1500)
        raw_questions = result.get("questions", []) if isinstance(result, dict) else []
    except Exception as e:
        logger.error(f"Failed to generate questions via LLM: {e}")
        raw_questions = []

    questions = []
    valid_phases = {"warm_up", "fundamentals", "depth", "applied", "wrap_up"}
    for idx, q in enumerate(raw_questions[:target_count]):
        text = (q.get("text") or "").strip()
        if not text:
            continue
        phase = str(q.get("phase", "fundamentals")).lower()
        if phase not in valid_phases:
            phase = "fundamentals"
        questions.append({
            "id": f"ai-{uuid.uuid4().hex[:8]}",
            "text": text,
            "phase": phase,
            "topic": q.get("topic") or req.subject or "Core",
            "difficulty": q.get("difficulty") or req.difficulty,
            "status": "approved",
            "is_ai_generated": True,
        })

    # Graceful fallback if LLM produced empty list
    if not questions:
        questions = [
            {
                "id": f"fb-{uuid.uuid4().hex[:8]}",
                "text": f"Explain the core architectural principles and internal mechanics of {req.subject or 'this topic'}.",
                "phase": "fundamentals",
                "topic": req.subject or "Fundamentals",
                "difficulty": req.difficulty,
                "status": "approved",
                "is_ai_generated": True,
            },
            {
                "id": f"fb-{uuid.uuid4().hex[:8]}",
                "text": f"What are the key trade-offs, edge cases, and failure modes encountered when scaling {req.subject or 'these systems'}?",
                "phase": "depth",
                "topic": req.subject or "Architecture",
                "difficulty": "hard",
                "status": "approved",
                "is_ai_generated": True,
            },
            {
                "id": f"fb-{uuid.uuid4().hex[:8]}",
                "text": f"Walk through an applied debugging or design scenario involving {req.subject or 'the given syllabus'}.",
                "phase": "applied",
                "topic": req.subject or "Applied Problem",
                "difficulty": "hard",
                "status": "approved",
                "is_ai_generated": True,
            },
        ]

    return {"questions": questions}


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

    # Persist any approved questions created during faculty setup
    added_question_count = 0
    if req.questions:
        for q in req.questions:
            text = (q.get("text") or "").strip()
            if not text:
                continue
            phase_str = str(q.get("phase", "fundamentals")).lower()
            try:
                phase = VivaPhase(phase_str)
            except ValueError:
                phase = VivaPhase.fundamentals

            status_str = str(q.get("status", "approved")).lower()
            try:
                status = QuestionStatus(status_str)
            except ValueError:
                status = QuestionStatus.approved

            new_q = Question(
                id=uuid.uuid4(),
                viva_config_id=config.id,
                text=text[:1024],
                phase=phase,
                topic=str(q.get("topic", ""))[:256],
                difficulty=str(q.get("difficulty", req.difficulty or "medium")),
                status=status,
                is_ai_generated=bool(q.get("is_ai_generated", False)),
            )
            db.add(new_q)
            if status == QuestionStatus.approved:
                added_question_count += 1

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
        question_count=added_question_count,
    )


@router.get("/{config_id}")
async def get_viva_config(
    config_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current: dict = Depends(require_faculty),
):
    result = await db.execute(select(VivaConfig).where(VivaConfig.id == config_id))
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
    config_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    syllabus: Optional[str] = None,
    count: int = 10,
    db: AsyncSession = Depends(get_db),
    current: dict = Depends(require_faculty),
):
    """Trigger async LLM question generation from syllabus."""
    from app.workers.tasks import generate_questions_task, _generate_questions_async
    try:
        generate_questions_task.delay(str(config_id), syllabus or "", count)
        dispatch_mode = "celery_queued"
    except Exception as e:
        logger.info(f"Celery task dispatch unavailable ({e}); generating questions via background task.")
        background_tasks.add_task(_generate_questions_async, str(config_id), syllabus or "", count)
        dispatch_mode = "in_process"
    return {
        "message": f"Generating {count} questions in background. Refresh question bank shortly.",
        "dispatch": dispatch_mode,
    }


@router.post("/{config_id}/upload-questions")
async def upload_questions(
    config_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current: dict = Depends(require_faculty),
):
    """Upload questions via JSON or CSV file."""
    config = await db.get(VivaConfig, config_id)
    if not config:
        raise HTTPException(404, "Viva configuration not found")
    content = await file.read(2 * 1024 * 1024 + 1)
    if len(content) > 2 * 1024 * 1024:
        raise HTTPException(413, "Question upload must be under 2 MB")
    try:
        filename = (file.filename or "").lower()
        if filename.endswith(".json"):
            data = json.loads(content)
            questions_data = data if isinstance(data, list) else data.get("questions", [])
        elif filename.endswith(".csv"):
            import csv, io
            questions_data = list(csv.DictReader(io.StringIO(content.decode("utf-8-sig"))))
        else:
            raise HTTPException(400, "File must be .json or .csv")
        if not isinstance(questions_data, list) or any(not isinstance(q, dict) for q in questions_data):
            raise ValueError("Questions must be an array of objects")
        if len(questions_data) > 1000:
            raise ValueError("Upload at most 1000 questions at a time")
        if any(not isinstance(q.get("text", q.get("question", "")), str) for q in questions_data):
            raise ValueError("Question text must be a string")
    except (ValueError, TypeError, AttributeError, UnicodeError) as exc:
        raise HTTPException(400, "Invalid question file. Use a JSON question array or a UTF-8 CSV with a text column") from exc

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
            viva_config_id=config_id,
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
