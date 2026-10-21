"""Transcribe to an editable draft. Never grade an unconfirmed cloud transcript."""
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.routes.recordings import owned_session, ALLOWED
from app.core.security import get_current_user
from app.db.session import get_db
from app.models.models import TranscriptTurn, VivaSession, Question, QuestionStatus
from app.services.auth_sessions import check_auth_rate
from app.services.stt_provider import get_stt_provider, DeepgramSTTProvider
from app.services.speech_review import sign_draft

router = APIRouter()


@router.post("/{session_id}/speech-draft")
async def transcribe_draft(session_id: uuid.UUID, request: Request, language: Literal["en", "hi", "multi"] = "en",
                           db=Depends(get_db), current=Depends(get_current_user)):
    session = await owned_session(db, session_id, current)
    if current.get("role") != "student":
        raise HTTPException(403, "Only candidates can transcribe their answers")
    if session.status.value != "in_progress":
        raise HTTPException(409, "Voice input is available during an active interview")
    if request.headers.get("content-type", "").split(";")[0] not in ALLOWED | {"audio/mpeg"}:
        raise HTTPException(415, "Unsupported speech format")
    audio = bytearray()
    async for part in request.stream():
        audio.extend(part)
        if len(audio) > 2 * 1024 * 1024:
            raise HTTPException(413, "An answer recording must be at most 2 MB")
    if not audio:
        raise HTTPException(400, "No speech recording received")
    await check_auth_rate(db, f"speech:{current['sub']}", max_attempts=10,
                          message="Too many voice requests. Please wait one minute or type your answer.")
    last_question = await db.scalar(select(TranscriptTurn).where(
        TranscriptTurn.session_id == session_id, TranscriptTurn.speaker == "ai"
    ).order_by(TranscriptTurn.turn_index.desc()).limit(1))
    if request.query_params.get("question_turn_id"):
        try:
            question_turn_id = uuid.UUID(request.query_params["question_turn_id"])
        except ValueError:
            raise HTTPException(400, "Invalid question reference") from None
        question = await db.get(TranscriptTurn, question_turn_id)
        if not question or question.session_id != session_id or question.speaker != "ai":
            raise HTTPException(400, "Question does not belong to this interview")
        last_question = question
    config_session = await db.scalar(select(VivaSession).options(selectinload(VivaSession.viva_config)).where(VivaSession.id == session_id))
    config = config_session.viva_config
    vocabulary = [str(topic)[:80] for topic in (config.topics or [])][:30] if config else []
    approved = (await db.scalars(select(Question).where(Question.viva_config_id == session.viva_config_id,
        Question.status == QuestionStatus.approved).limit(100))).all()
    # Faculty-approved terminology, not model-invented spelling substitutions.
    vocabulary = list(dict.fromkeys([str(term)[:80] for question in approved
        for term in (question.expected_keywords or [])] + vocabulary))[:30]

    async def chunks():
        yield bytes(audio)

    try:
        provider = get_stt_provider()
        if isinstance(provider, DeepgramSTTProvider):
            provider.vocabulary = vocabulary
            provider.language = language
            if language in ("hi", "multi"):
                from app.core.config import settings
                provider.model = settings.DEEPGRAM_MULTILINGUAL_MODEL
        final = None
        async for result in provider.transcribe_stream(chunks()):
            if result.is_final:
                final = result
        if not final or not final.text.strip():
            raise HTTPException(422, "No speech detected. Retry or type your answer.")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, "Voice transcription is unavailable. Your recording is retained by the interview recorder; retry or type your answer.") from None
    from app.api.routes.streaming_speech import record_voice_signal
    await record_voice_signal(session_id, final.words, {"question_id": str(last_question.question_id) if last_question and last_question.question_id else None, "question_text": last_question.text if last_question else ""})
    payload = {"session_id": str(session_id), "text": final.text, "confidence": final.confidence,
               "words": final.words[:4000], "question_text": last_question.text if last_question else "",
               "question_phase": last_question.phase.value if last_question and last_question.phase else None,
               "question_id": str(last_question.question_id) if last_question and last_question.question_id else None}
    return dict(payload, receipt=sign_draft(payload))
