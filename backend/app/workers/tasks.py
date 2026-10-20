"""Celery background tasks."""
from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Optional

from celery import shared_task
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload

from app.workers.celery_app import celery_app
from app.db.session import AsyncSessionLocal
from app.models.models import (
    VivaSession, TranscriptTurn, ScoreReport, AuditLog,
    SessionStatus, ReviewStatus, ScoringJob,
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


async def _score_session_async(session_id: str, claim_token=None):
    async with AsyncSessionLocal() as db:
        # Load session with turns
        result = await db.execute(
            select(VivaSession)
            .options(
                selectinload(VivaSession.turns),
                selectinload(VivaSession.viva_config),
                selectinload(VivaSession.score_report),
            )
            .where(VivaSession.id == uuid.UUID(session_id))
        )
        session = result.scalar_one_or_none()

        if not session:
            logger.error(f"Session {session_id} not found")
            return

        if session.score_report:
            if claim_token:
                await db.execute(update(ScoringJob).where(ScoringJob.session_id == session.id,
                    ScoringJob.claim_token == claim_token).values(status="completed", claim_token=None, lease_until=None))
                await db.commit()
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
                "answer_metadata": t.answer_metadata,
                "classifier_confidence": t.classifier_confidence,
            }
            for t in sorted(session.turns, key=lambda x: x.turn_index)
        ]

        weights = session.viva_config.rubric_weights if session.viva_config else {
            "conceptual": 30, "depth_reasoning": 25,
            "problem_solving": 20, "practical_project": 15, "communication": 10,
        }

        try:
            llm = get_llm_provider()
            model_name = "mock" if hasattr(llm, 'QUESTION_BANK') else getattr(llm, "strong_model", "configured")
            score_data = await score_session(
                session_id=session_id,
                turns=turns_data,
                rubric_weights=weights,
                llm=llm,
                model_name=model_name,
            )
        except Exception:
            if claim_token:
                raise
            # A provider failure cannot be converted into invented academic marks.
            session.status = SessionStatus.flagged
            session.review_status = ReviewStatus.pending
            db.add(AuditLog(session_id=uuid.UUID(session_id), action="scoring_failed",
                            detail={"reason": "Evaluation provider unavailable; manual review required"}))
            await db.commit()
            logger.exception("Scoring failed; session retained for review: %s", session_id)
            raise

        # Missing evidence requires human assessment, not a fabricated numeric
        # grade. Complete the job in an explicit terminal review state.
        if score_data.get("needs_faculty_review"):
            if claim_token:
                fenced = await db.execute(update(ScoringJob).where(
                    ScoringJob.session_id == session.id, ScoringJob.claim_token == claim_token,
                    ScoringJob.status == "processing").values(status="review_required",
                    claim_token=None, lease_until=None, last_error="Answers saved. Faculty review is required to verify grading evidence."))
                if not fenced.rowcount:
                    await db.rollback()
                    return
            session.status = SessionStatus.flagged
            session.review_status = ReviewStatus.pending
            db.add(AuditLog(session_id=session.id, action="scoring_review_required",
                detail={"reasons": score_data["low_confidence_reasons"], "model": model_name,
                        "prompt_version": score_data["prompt_version"], "feedback": score_data["feedback_lines"]}))
            await db.commit()
            return

        # Fencing prevents an expired worker from publishing a second grade.
        if claim_token:
            result = await db.execute(update(ScoringJob).where(ScoringJob.session_id == session.id,
                ScoringJob.claim_token == claim_token, ScoringJob.status == "processing").values(
                status="completed", claim_token=None, lease_until=None, last_error=None))
            if not result.rowcount:
                await db.rollback()
                return
        # Persist score report
        report = ScoreReport(
            session_id=uuid.UUID(session_id),
            prompt_version=str(score_data.get("prompt_version", "v1")),
            conceptual_score=float(score_data.get("conceptual_score", 0.0)),
            depth_reasoning_score=float(score_data.get("depth_reasoning_score", 0.0)),
            problem_solving_score=float(score_data.get("problem_solving_score", 0.0)),
            practical_project_score=float(score_data.get("practical_project_score", 0.0)),
            communication_score=float(score_data.get("communication_score", 0.0)),
            conceptual_reason=str(score_data.get("conceptual_reason", "")),
            depth_reasoning_reason=str(score_data.get("depth_reasoning_reason", "")),
            problem_solving_reason=str(score_data.get("problem_solving_reason", "")),
            practical_project_reason=str(score_data.get("practical_project_reason", "")),
            communication_reason=str(score_data.get("communication_reason", "")),
            conceptual_turn_ids=score_data.get("conceptual_turn_ids", []),
            depth_reasoning_turn_ids=score_data.get("depth_reasoning_turn_ids", []),
            problem_solving_turn_ids=score_data.get("problem_solving_turn_ids", []),
            practical_project_turn_ids=score_data.get("practical_project_turn_ids", []),
            communication_turn_ids=score_data.get("communication_turn_ids", []),
            total_score=float(score_data.get("total_score", 0.0)),
            feedback_lines=score_data.get("feedback_lines", []),
            low_confidence_flag=bool(score_data.get("low_confidence_flag", False)),
            low_confidence_reasons=score_data.get("low_confidence_reasons", []),
            model_used=str(score_data.get("model_used", model_name)),
        )
        db.add(report)

        # Update session
        session.total_score = float(score_data.get("total_score", 0.0))
        session.score_breakdown = {
            "conceptual": float(score_data.get("conceptual_score", 0.0)),
            "depth_reasoning": float(score_data.get("depth_reasoning_score", 0.0)),
            "problem_solving": float(score_data.get("problem_solving_score", 0.0)),
            "practical_project": float(score_data.get("practical_project_score", 0.0)),
            "communication": float(score_data.get("communication_score", 0.0)),
        }
        session.score_prompt_version = str(score_data.get("prompt_version", "v1"))

        if score_data.get("low_confidence_flag", False):
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
