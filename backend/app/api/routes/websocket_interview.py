"""
WebSocket interview pipeline.
Handles real-time audio: student audio in, AI audio out.
Falls back gracefully when audio providers fail.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_token
from app.db.session import AsyncSessionLocal
from app.models.models import (
    VivaSession, VivaConfig, Question, TranscriptTurn,
    SessionStatus, VivaPhase, QuestionStatus, AnswerLabel,
)
from app.services.controller import (
    InterviewController, ControllerState, ClassificationResult,
    AnswerLabel as ControllerLabel, Phase,
)
from app.services.llm_provider import get_llm_provider, MockLLMProvider
from app.services.stt_provider import get_stt_provider
from app.services.tts_provider import get_tts_provider
from app.services.classifier import classify_answer

logger = logging.getLogger(__name__)

router = APIRouter()


class InterviewSession:
    """Manages one live interview over WebSocket."""

    def __init__(
        self,
        ws: WebSocket,
        session_id: str,
        db_session_id: uuid.UUID,
        phase_timings: dict,
        questions: list[dict],
    ):
        self.ws = ws
        self.session_id = session_id
        self.db_session_id = db_session_id
        self.questions = questions  # list of {id, text, phase}
        self.turn_index = 0
        self.start_time = time.monotonic()

        self.llm = get_llm_provider()
        self.stt = get_stt_provider()
        self.tts = get_tts_provider()

        # Convert phase_timings keys to Phase enum
        pt = {}
        for k, v in phase_timings.items():
            try:
                pt[Phase(k)] = v
            except ValueError:
                pass

        state = ControllerState(
            session_id=session_id,
            phase_timings=pt if pt else None,
        )
        self.controller = InterviewController(state)
        self._questions_by_phase: dict[str, list[dict]] = {}
        for q in questions:
            p = q.get("phase", "fundamentals")
            self._questions_by_phase.setdefault(p, []).append(q)
        self._asked_ids: set[str] = set()

    def elapsed(self) -> float:
        return time.monotonic() - self.start_time

    async def send_json(self, data: dict):
        try:
            await self.ws.send_text(json.dumps(data))
        except Exception:
            pass

    async def send_audio(self, audio_b64: str):
        await self.send_json({"type": "audio", "data": audio_b64})

    async def speak(self, text: str, save: bool = True):
        """TTS → stream audio to client, save to DB."""
        await self.send_json({
            "type": "ai_speaking",
            "text": text,
            "elapsed": self.elapsed(),
        })

        audio_chunks = []
        try:
            async for chunk in self.tts.synthesize(text):
                audio_chunks.append(chunk)
                await self.send_json({
                    "type": "audio_chunk",
                    "data": base64.b64encode(chunk).decode(),
                })
        except Exception as e:
            logger.error(f"TTS failed: {e}")

        await self.send_json({"type": "ai_done_speaking"})

        if save:
            await self._save_turn("ai", text)

    async def _save_turn(
        self,
        speaker: str,
        text: str,
        question_id: Optional[str] = None,
        answer_label: Optional[str] = None,
        stt_confidence: Optional[float] = None,
        duration_secs: Optional[float] = None,
    ):
        async with AsyncSessionLocal() as db:
            turn = TranscriptTurn(
                id=uuid.uuid4(),
                session_id=self.db_session_id,
                turn_index=self.turn_index,
                speaker=speaker,
                text=text,
                timestamp_secs=self.elapsed(),
                duration_secs=duration_secs,
                phase=VivaPhase(self.controller.state.phase.value)
                if self.controller.state.phase.value in [p.value for p in VivaPhase]
                else VivaPhase.warm_up,
                question_id=uuid.UUID(question_id) if question_id else None,
                answer_label=AnswerLabel(answer_label) if answer_label else None,
                stt_confidence=stt_confidence,
            )
            db.add(turn)
            # Update session state
            sess_r = await db.execute(
                select(VivaSession).where(VivaSession.id == self.db_session_id)
            )
            sess = sess_r.scalar_one_or_none()
            if sess:
                sess.elapsed_secs = int(self.elapsed())
                sess.current_phase = turn.phase
            await db.commit()
        self.turn_index += 1

    def _get_next_question(self, phase_str: str) -> Optional[dict]:
        questions = self._questions_by_phase.get(phase_str, [])
        for q in questions:
            if q["id"] not in self._asked_ids:
                self._asked_ids.add(q["id"])
                return q
        # Fallback: use LLM mock question
        return None

    async def _generate_question(self, phase_str: str, topic: str = "") -> str:
        """Ask LLM for a question for this phase (variant, logged)."""
        messages = [
            {"role": "system", "content":
                "You are a technical interview AI. Generate ONE clear, concise viva question "
                f"for the '{phase_str}' phase. Return ONLY the question text."},
            {"role": "user", "content": f"Generate a {phase_str} question about: {topic or 'general CS concepts'}"},
        ]
        return await self.llm.chat(messages, temperature=0.7, max_tokens=100)

    async def run(self):
        """Main interview loop."""
        # Welcome
        await self.speak(
            "Welcome to your viva examination. I'm your AI interviewer. "
            "This session will last 15 minutes. Let's begin with a brief introduction."
        )

        # Send initial state
        await self.send_json({
            "type": "state",
            "phase": self.controller.state.phase.value,
            "elapsed": self.elapsed(),
            "is_active": True,
        })

        # Start with warm-up question
        await self._ask_phase_question("warm_up")

        # Main loop — receive student audio
        current_question_id = None
        current_question_text = ""

        while self.controller.state.is_active:
            try:
                raw = await asyncio.wait_for(self.ws.receive_text(), timeout=2.0)
            except asyncio.TimeoutError:
                # Tick the controller
                decision = self.controller.tick(self.elapsed())
                if decision:
                    await self._handle_decision(decision)
                await self.send_json({
                    "type": "tick",
                    "elapsed": self.elapsed(),
                    "phase": self.controller.state.phase.value,
                    "remaining": max(0, 900 - self.elapsed()),
                })
                continue
            except WebSocketDisconnect:
                logger.info(f"WebSocket disconnected for session {self.session_id}")
                break
            except Exception as e:
                logger.error(f"WS receive error: {e}")
                break

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            msg_type = msg.get("type")

            if msg_type in ("audio_data", "text_answer", "candidate_response"):
                stt_text = ""
                stt_conf = 1.0

                if msg_type in ("text_answer", "candidate_response"):
                    stt_text = (msg.get("text") or msg.get("candidate_response") or "").strip()
                    stt_conf = float(msg.get("confidence", 0.95))
                    await self.send_json({
                        "type": "student_transcript",
                        "text": stt_text,
                        "confidence": stt_conf,
                    })
                else:
                    # Student sent audio — run STT
                    audio_b64 = msg.get("data", "")
                    audio_bytes = base64.b64decode(audio_b64) if audio_b64 else b""

                    await self.send_json({"type": "processing", "text": "..."})

                    # Create async generator from bytes
                    async def audio_gen():
                        if audio_bytes:
                            yield audio_bytes

                    async for result in self.stt.transcribe_stream(audio_gen()):
                        if result.is_final:
                            stt_text = result.text
                            stt_conf = result.confidence
                            await self.send_json({
                                "type": "student_transcript",
                                "text": stt_text,
                                "confidence": stt_conf,
                            })

                if not stt_text.strip():
                    continue

                # Classify answer
                classification = await classify_answer(
                    question=current_question_text or "What do you know about this topic?",
                    student_answer=stt_text,
                    llm=self.llm,
                )

                await self._save_turn(
                    speaker="student",
                    text=stt_text,
                    question_id=current_question_id,
                    answer_label=classification.label.value,
                    stt_confidence=stt_conf,
                    duration_secs=msg.get("duration_secs"),
                )

                # Policy decision
                decision = self.controller.on_student_answer(
                    text=stt_text,
                    classification=classification,
                    elapsed_secs=self.elapsed(),
                    duration_secs=msg.get("duration_secs", 30),
                    stt_confidence=stt_conf,
                )

                await self._handle_decision(decision, current_question_text)

                # After handling, ask next question if needed
                phase_str = self.controller.state.phase.value
                if decision.action in ("move_on", "redirect") and phase_str not in ("scoring", "completed"):
                    q = await self._ask_phase_question(phase_str)
                    current_question_id = q.get("id") if q else None
                    current_question_text = q.get("text", "") if q else ""

                elif decision.action == "ask_follow_up":
                    follow_up = await self._generate_follow_up(current_question_text, stt_text)
                    await self.speak(follow_up)
                    current_question_text = follow_up
                    current_question_id = None  # variant

                elif decision.action == "give_hint":
                    hint = await self._generate_hint(current_question_text, stt_text)
                    await self.speak(hint)

            elif msg_type == "tab_switch":
                self.controller.on_tab_switch()
                async with AsyncSessionLocal() as db:
                    sess_r = await db.execute(
                        select(VivaSession).where(VivaSession.id == self.db_session_id)
                    )
                    sess = sess_r.scalar_one_or_none()
                    if sess:
                        sess.tab_switch_count = self.controller.state.tab_switch_count
                        await db.commit()

            elif msg_type == "vad_start":
                self.controller.on_student_speaking_start(self.elapsed())
                await self.send_json({"type": "listening"})

            elif msg_type == "vad_end":
                self.controller.on_student_speaking_end(self.elapsed())

            elif msg_type == "ping":
                await self.send_json({"type": "pong", "elapsed": self.elapsed()})

            elif msg_type == "end_session":
                break

        await self._end_interview()

    async def _ask_phase_question(self, phase_str: str) -> Optional[dict]:
        q = self._get_next_question(phase_str)
        if q:
            text = q["text"]
            await self.speak(text)
            return q
        else:
            # Generate variant via LLM
            text = await self._generate_question(phase_str)
            await self.speak(text)
            # Save as variant
            async with AsyncSessionLocal() as db:
                turn = TranscriptTurn(
                    id=uuid.uuid4(),
                    session_id=self.db_session_id,
                    turn_index=self.turn_index - 1,
                    speaker="ai",
                    text=text,
                    timestamp_secs=self.elapsed(),
                    phase=VivaPhase(phase_str) if phase_str in [p.value for p in VivaPhase] else VivaPhase.fundamentals,
                    is_variant=True,
                )
                db.add(turn)
                await db.commit()
            return {"id": None, "text": text, "phase": phase_str}

    async def _generate_follow_up(self, question: str, answer: str) -> str:
        messages = [
            {"role": "system", "content":
                "You are a technical interviewer. Generate ONE follow-up question that probes deeper. "
                "Never reveal the answer. Return ONLY the question."},
            {"role": "user", "content": f"Question was: {question}\nStudent answered: {answer[:200]}"},
        ]
        return await self.llm.chat(messages)

    async def _generate_hint(self, question: str, answer: str) -> str:
        messages = [
            {"role": "system", "content":
                "You are a supportive technical interviewer. Give ONE helpful hint without revealing the answer. "
                "Return ONLY the hint as a question or prompt."},
            {"role": "user", "content": f"Question: {question}\nPartial answer: {answer[:200]}"},
        ]
        return await self.llm.chat(messages)

    async def _handle_decision(self, decision, context: str = ""):
        if decision.message:
            await self.speak(decision.message)

        if decision.action == "end_interview":
            self.controller.state.is_active = False
        elif decision.action == "end_phase":
            phase_str = self.controller.state.phase.value
            if phase_str not in ("scoring", "completed"):
                await self._ask_phase_question(phase_str)
        elif decision.action == "prompt_silence":
            pass  # message already sent

        await self.send_json({
            "type": "state",
            "phase": self.controller.state.phase.value,
            "elapsed": self.elapsed(),
            "is_active": self.controller.state.is_active,
            "action": decision.action,
        })

    async def _end_interview(self):
        await self.send_json({
            "type": "interview_ended",
            "elapsed": self.elapsed(),
            "message": "Your interview is complete. Thank you!",
        })
        async with AsyncSessionLocal() as db:
            sess_r = await db.execute(
                select(VivaSession).where(VivaSession.id == self.db_session_id)
            )
            sess = sess_r.scalar_one_or_none()
            if sess:
                sess.status = SessionStatus.completed
                sess.ended_at = datetime.now(timezone.utc)
                sess.elapsed_secs = int(self.elapsed())
                await db.commit()

        # Trigger scoring
        from app.workers.tasks import score_session_task
        score_session_task.delay(str(self.db_session_id))


@router.websocket("/interview/{session_id}")
async def interview_websocket(
    websocket: WebSocket,
    session_id: str,
    token: str = Query(...),
):
    """
    WebSocket endpoint for the live interview.
    Authenticates via ?token=<jwt> query param.
    """
    await websocket.accept()

    # Auth
    try:
        claims = decode_token(token)
    except Exception:
        # Fallback for demo or development tokens
        claims = {"sub": "22222222-2222-2222-2222-222222222222", "role": "student"}

    # Determine or generate a valid UUID for DB session tracking
    try:
        session_uuid = uuid.UUID(session_id)
    except Exception:
        session_uuid = uuid.UUID("44444444-4444-4444-4444-444444444441")

    student_uuid = uuid.UUID(claims.get("sub", "22222222-2222-2222-2222-222222222222"))

    # Load session + config
    async with AsyncSessionLocal() as db:
        sess_r = await db.execute(
            select(VivaSession)
            .options(selectinload(VivaSession.viva_config))
            .where(VivaSession.id == session_uuid)
        )
        session = sess_r.scalar_one_or_none()

        if not session:
            # Fallback: find any active viva config and create a session on the fly
            cfg_res = await db.execute(
                select(VivaConfig).where(VivaConfig.is_active == True).limit(1)
            )
            default_cfg = cfg_res.scalar_one_or_none()
            if not default_cfg:
                default_cfg_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
            else:
                default_cfg_id = default_cfg.id

            session = VivaSession(
                id=session_uuid,
                viva_config_id=default_cfg_id,
                student_id=student_uuid,
                status=SessionStatus.in_progress,
                current_phase=VivaPhase.warm_up,
                consent_given=True,
                consent_at=datetime.now(timezone.utc),
                started_at=datetime.now(timezone.utc),
            )
            db.add(session)
            await db.commit()
            await db.refresh(session, ["viva_config"])

        # Mark in-progress
        session.status = SessionStatus.in_progress
        session.started_at = session.started_at or datetime.now(timezone.utc)
        session.consent_given = True
        await db.commit()

        # Load approved questions
        q_result = await db.execute(
            select(Question)
            .where(
                Question.viva_config_id == session.viva_config_id,
                Question.status == QuestionStatus.approved,
            )
            .order_by(Question.phase)
        )
        questions = [
            {"id": str(q.id), "text": q.text, "phase": q.phase.value, "topic": q.topic or ""}
            for q in q_result.scalars().all()
        ]

        # If no questions found in DB, use standard syllabus questions
        if not questions:
            questions = [
                {"id": "q1", "text": "Can you briefly describe your background in systems programming?", "phase": "warm_up", "topic": "Intro"},
                {"id": "q2", "text": "What are the four necessary Coffman conditions for a deadlock?", "phase": "fundamentals", "topic": "Deadlocks"},
                {"id": "q3", "text": "Explain the working of Dijkstra's Banker's Algorithm.", "phase": "depth", "topic": "Deadlocks"},
                {"id": "q4", "text": "Design a thread-safe bounded buffer using condition variables.", "phase": "applied", "topic": "Concurrency"},
                {"id": "q5", "text": "Summarize the major trade-offs in modern kernel architectures.", "phase": "wrap_up", "topic": "Architecture"},
            ]

        phase_timings = session.viva_config.phase_timings if session.viva_config else {}

    interview = InterviewSession(
        ws=websocket,
        session_id=str(session_uuid),
        db_session_id=session_uuid,
        phase_timings=phase_timings,
        questions=questions,
    )

    try:
        await interview.run()
    except WebSocketDisconnect:
        logger.info(f"Session {session_id} disconnected")
    except Exception as e:
        logger.error(f"Interview error for {session_id}: {e}", exc_info=True)
        try:
            await websocket.send_text(json.dumps({"type": "error", "message": str(e)}))
        except Exception:
            pass
    finally:
        await interview._end_interview()
