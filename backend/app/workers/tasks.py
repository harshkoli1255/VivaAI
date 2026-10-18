"""Celery background tasks."""
from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Optional

from celery import shared_task
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.workers.celery_app import celery_app
from app.db.session import AsyncSessionLocal
from app.models.models import (
    VivaSession, TranscriptTurn, ScoreReport, AuditLog,
    SessionStatus, ReviewStatus,
)
from app.services.scorer import score_session
from app.services.llm_provider import get_llm_provider

logger = logging.getLogger(__name__)


def run_async(coro):
    """Run async code in a sync Celery task."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@celery_app.task(
    bind=True,
    name="app.workers.tasks.score_session_task",
    max_retries=3,
    default_retry_delay=30,
    acks_late=True,
)
def score_session_task(self, session_id: str):
    """Score a completed viva session. Runs after session ends."""
    logger.info(f"Starting scoring for session {session_id}")
    try:
        run_async(_score_session_async(session_id))
    except Exception as exc:
        logger.error(f"Scoring failed for {session_id}: {exc}")
        raise self.retry(exc=exc)


async def _score_session_async(session_id: str):
    async with AsyncSessionLocal() as db:
        # Load session with turns
        result = await db.execute(
            select(VivaSession)
            .options(
                selectinload(VivaSession.turns),
                selectinload(VivaSession.viva_config),
            )
            .where(VivaSession.id == uuid.UUID(session_id))
        )
        session = result.scalar_one_or_none()

        if not session:
            logger.error(f"Session {session_id} not found")
            return

        if session.score_report:
            logger.info(f"Session {session_id} already scored")
            return

        # Build turns list
        turns_data = [
            {
                "turn_index": t.turn_index,
                "speaker": t.speaker,
                "text": t.text,
                "answer_label": t.answer_label.value if t.answer_label else None,
                "stt_confidence": t.stt_confidence,
            }
            for t in sorted(session.turns, key=lambda x: x.turn_index)
        ]

        weights = session.viva_config.rubric_weights if session.viva_config else {
            "conceptual": 30, "depth_reasoning": 25,
            "problem_solving": 20, "practical_project": 15, "communication": 10,
        }

        llm = get_llm_provider()
        model_name = "mock" if hasattr(llm, 'QUESTION_BANK') else "gpt-4o"

        score_data = await score_session(
            session_id=session_id,
            turns=turns_data,
            rubric_weights=weights,
            llm=llm,
            model_name=model_name,
        )

        # Persist score report
        report = ScoreReport(
            session_id=uuid.UUID(session_id),
            prompt_version=score_data["prompt_version"],
            conceptual_score=score_data["conceptual_score"],
            depth_reasoning_score=score_data["depth_reasoning_score"],
            problem_solving_score=score_data["problem_solving_score"],
            practical_project_score=score_data["practical_project_score"],
            communication_score=score_data["communication_score"],
            conceptual_reason=score_data["conceptual_reason"],
            depth_reasoning_reason=score_data["depth_reasoning_reason"],
            problem_solving_reason=score_data["problem_solving_reason"],
            practical_project_reason=score_data["practical_project_reason"],
            communication_reason=score_data["communication_reason"],
            conceptual_turn_ids=score_data["conceptual_turn_ids"],
            depth_reasoning_turn_ids=score_data["depth_reasoning_turn_ids"],
            problem_solving_turn_ids=score_data["problem_solving_turn_ids"],
            practical_project_turn_ids=score_data["practical_project_turn_ids"],
            communication_turn_ids=score_data["communication_turn_ids"],
            total_score=score_data["total_score"],
            feedback_lines=score_data["feedback_lines"],
            low_confidence_flag=score_data["low_confidence_flag"],
            low_confidence_reasons=score_data.get("low_confidence_reasons", []),
            model_used=score_data["model_used"],
        )
        db.add(report)

        # Update session
        session.total_score = score_data["total_score"]
        session.score_breakdown = {
            "conceptual": score_data["conceptual_score"],
            "depth_reasoning": score_data["depth_reasoning_score"],
            "problem_solving": score_data["problem_solving_score"],
            "practical_project": score_data["practical_project_score"],
            "communication": score_data["communication_score"],
        }
        session.score_prompt_version = score_data["prompt_version"]

        if score_data["low_confidence_flag"]:
            session.status = SessionStatus.flagged
            session.review_status = ReviewStatus.pending
        else:
            session.review_status = ReviewStatus.reviewed

        # Audit log
        log = AuditLog(
            session_id=uuid.UUID(session_id),
            action="scoring_completed",
            detail={
                "total_score": score_data["total_score"],
                "model": model_name,
                "prompt_version": score_data["prompt_version"],
                "low_confidence": score_data["low_confidence_flag"],
            },
        )
        db.add(log)
        await db.commit()
        logger.info(f"Scoring complete for {session_id}: {score_data['total_score']}/100")


@celery_app.task(name="app.workers.tasks.generate_questions_task")
def generate_questions_task(viva_config_id: str, syllabus_text: str, count: int = 10):
    """Generate questions from syllabus using LLM."""
    run_async(_generate_questions_async(viva_config_id, syllabus_text, count))


async def _generate_questions_async(
    viva_config_id: str, syllabus_text: str, count: int
):
    from app.models.models import Question, VivaPhase, QuestionStatus
    llm = get_llm_provider()

    messages = [
        {"role": "system", "content":
            "You are an expert academic examiner. Generate technical viva questions from the given syllabus. "
            "Return ONLY valid JSON: {\"questions\": [{\"text\": str, \"phase\": str, \"difficulty\": str, \"topic\": str}]}"
         },
        {"role": "user", "content":
            f"Generate {count} diverse viva questions for the following syllabus.\n"
            f"Phases: warm_up, fundamentals, depth, applied, wrap_up\n"
            f"Difficulties: easy, medium, hard\n\n"
            f"SYLLABUS:\n{syllabus_text[:3000]}"
         },
    ]

    result = await llm.chat_json(messages)
    questions = result.get("questions", [])

    async with AsyncSessionLocal() as db:
        for q in questions[:count]:
            phase_str = q.get("phase", "fundamentals")
            try:
                phase = VivaPhase(phase_str)
            except ValueError:
                phase = VivaPhase.fundamentals

            question = Question(
                viva_config_id=uuid.UUID(viva_config_id),
                text=q.get("text", "")[:1024],
                phase=phase,
                topic=q.get("topic", ""),
                difficulty=q.get("difficulty", "medium"),
                is_ai_generated=True,
                status=QuestionStatus.pending,
            )
            db.add(question)
        await db.commit()
        logger.info(f"Generated {len(questions)} questions for config {viva_config_id}")
