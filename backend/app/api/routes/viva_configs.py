import logging
import uuid
import json
import math
from typing import List, Optional, Literal
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import require_faculty, get_current_user
from app.db.session import get_db
from app.models.models import VivaConfig, Question, VivaPhase, QuestionStatus, VivaSession, SessionStatus
from app.services.config_versions import lock_config, guard_question_mutation
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


class ConfigQuestionInput(BaseModel):
    text: str = Field(min_length=1, max_length=1024)
    phase: Literal["warm_up", "fundamentals", "depth", "applied", "wrap_up"] = "fundamentals"
    topic: str = Field(default="", max_length=256)
    difficulty: Literal["easy", "medium", "hard"] = "medium"
    status: Literal["pending", "approved", "rejected"] = "approved"
    is_ai_generated: bool = False
    expected_keywords: List[str] = Field(default_factory=list, max_length=100)
    follow_up_hints: List[str] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def trim_text(self):
        self.text = self.text.strip()
        if not self.text:
            raise ValueError("Question text cannot be blank")
        return self


class CreateVivaConfigRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    subject: str = Field(min_length=1, max_length=255)
    topics: List[str] = Field(default_factory=list)
    difficulty: Literal["easy", "medium", "hard"] = "medium"
    total_duration_secs: int = Field(default=900, ge=60, le=900)
    phase_timings: Optional[dict] = None
    rubric_weights: Optional[dict] = None
    questions: Optional[List[ConfigQuestionInput]] = Field(default=None, max_length=1000)
    course_code: str = Field(default="", max_length=64)
    is_active: bool = True

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
    course_code: str = ""
    revision: int = 1

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
            course_code=c.course_code,
            revision=c.revision,
        )
        responses.append(resp)
    return responses


DEFAULT_WEIGHTS = {"conceptual": 30, "depth_reasoning": 25, "problem_solving": 20, "practical_project": 15, "communication": 10}


def add_bank(db, config_id, questions, actor):
    for question in questions:
        values = question.model_dump()
        values["phase"] = VivaPhase(values["phase"])
        values["status"] = QuestionStatus(values["status"])
        db.add(Question(id=uuid.uuid4(), viva_config_id=config_id, reviewed_by=uuid.UUID(actor)
            if question.status in ("approved", "rejected") else None, **values))


async def config_detail(db, config, include_questions=False):
    bank = list((await db.scalars(select(Question).where(Question.viva_config_id == config.id).order_by(Question.created_at, Question.id))).all())
    session_count = await db.scalar(select(func.count(VivaSession.id)).where(VivaSession.viva_config_id == config.id))
    running = await db.scalar(select(func.count(VivaSession.id)).where(VivaSession.viva_config_id == config.id, VivaSession.status == SessionStatus.in_progress))
    data = {key: getattr(config, key) for key in ["title", "subject", "topics", "difficulty", "total_duration_secs", "phase_timings", "rubric_weights", "is_active", "course_code", "revision", "created_at", "updated_at"]}
    data.update(id=str(config.id), previous_version_id=str(config.previous_version_id) if config.previous_version_id else None,
        superseded_by_id=str(config.superseded_by_id) if config.superseded_by_id else None,
        question_count=sum(q.status == QuestionStatus.approved for q in bank),
        pending_question_count=sum(q.status == QuestionStatus.pending for q in bank),
        session_count=session_count, in_progress_count=running)
    if include_questions:
        data["questions"] = [{"id": str(q.id), "text": q.text, "phase": q.phase.value, "topic": q.topic or "",
            "difficulty": q.difficulty, "status": q.status.value, "is_ai_generated": q.is_ai_generated,
            "expected_keywords": q.expected_keywords or [], "follow_up_hints": q.follow_up_hints or []} for q in bank]
    return data


@router.get("/manage")
async def manage_vivas(db: AsyncSession = Depends(get_db), current: dict = Depends(require_faculty)):
    configs = list((await db.scalars(select(VivaConfig).order_by(VivaConfig.created_at.desc()))).all())
    return [await config_detail(db, config) for config in configs]


class PublishVersionRequest(CreateVivaConfigRequest):
    expected_updated_at: datetime


class EnrollmentRequest(BaseModel):
    is_active: bool
    expected_updated_at: datetime


def check_edit_token(config, expected):
    normalize = lambda value: value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
    if config.superseded_by_id:
        raise HTTPException(409, "A newer version of this viva has already been published. Return to the dashboard and open the latest version.")
    if normalize(config.updated_at) != normalize(expected):
        raise HTTPException(409, "This viva changed after you opened it. Reload the latest version before saving; your unsaved edits are still in this tab.")


@router.post("/{config_id}/versions")
async def publish_version(config_id: uuid.UUID, req: PublishVersionRequest,
    db: AsyncSession = Depends(get_db), current: dict = Depends(require_faculty)):
    source = await lock_config(db, config_id)
    check_edit_token(source, req.expected_updated_at)
    # Every publication gets a new ID, even before the first student enrolls.
    # Resume, transcript references, and delayed scoring continue using the old ID.
    if req.questions is None:
        existing = (await config_detail(db, source, include_questions=True))["questions"]
        questions = [ConfigQuestionInput(**q) for q in existing]
    else:
        questions = req.questions
    if req.is_active and not any(q.status == "approved" for q in questions):
        raise HTTPException(422, "Approve at least one question before publishing a viva")
    config = VivaConfig(id=uuid.uuid4(), created_by=uuid.UUID(current["sub"]), title=req.title,
        subject=req.subject, topics=req.topics, difficulty=req.difficulty, total_duration_secs=req.total_duration_secs,
        phase_timings=req.phase_timings, rubric_weights=req.rubric_weights or source.rubric_weights,
        course_code=req.course_code.strip(), revision=source.revision + 1, previous_version_id=source.id,
        is_active=req.is_active)
    db.add(config)
    await db.flush()
    add_bank(db, config.id, questions, current["sub"])
    source.is_active = False
    source.superseded_by_id = config.id
    await db.commit()
    return await config_detail(db, config)


@router.patch("/{config_id}/enrollment")
async def change_enrollment(config_id: uuid.UUID, req: EnrollmentRequest,
    db: AsyncSession = Depends(get_db), current: dict = Depends(require_faculty)):
    config = await lock_config(db, config_id)
    check_edit_token(config, req.expected_updated_at)
    if req.is_active:
        approved = await db.scalar(select(Question.id).where(Question.viva_config_id == config.id, Question.status == QuestionStatus.approved).limit(1))
        if not approved:
            raise HTTPException(422, "Approve at least one question before opening enrollment")
    config.is_active = req.is_active
    # Explicit token change also covers an idempotent status save.
    config.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return await config_detail(db, config)


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
    if req.is_active and not any(q.status == "approved" for q in (req.questions or [])):
        raise HTTPException(422, "Approve at least one question before publishing a viva")
    config = VivaConfig(id=uuid.uuid4(), created_by=uuid.UUID(current["sub"]),
        title=req.title, subject=req.subject, topics=req.topics, difficulty=req.difficulty,
        total_duration_secs=req.total_duration_secs, phase_timings=req.phase_timings,
        course_code=req.course_code.strip(), is_active=req.is_active,
        rubric_weights=req.rubric_weights or DEFAULT_WEIGHTS, revision=1)
    db.add(config)
    await db.flush()
    add_bank(db, config.id, req.questions or [], current["sub"])
    await db.commit()
    return await config_detail(db, config)


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
    return await config_detail(db, config, include_questions=True)


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
    await guard_question_mutation(db, config_id)
    await db.commit()
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

    await guard_question_mutation(db, config_id)
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
