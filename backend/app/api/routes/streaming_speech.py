"""Ticket-authenticated, bounded live speech to an editable, signed draft."""
import asyncio
import json
import uuid
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from app.core.security import decode_ws_ticket, validate_principal
from app.db.session import AsyncSessionLocal
from app.models.models import VivaSession, SessionStatus, TranscriptTurn, AuditLog, Question, QuestionStatus
from app.services.interview_lease import interview_lease
from app.services.auth_sessions import check_auth_rate
from app.services.speech_review import sign_draft
from app.services.stt_provider import get_stt_provider, DeepgramSTTProvider, transcribe_live

router = APIRouter()


async def authorize(socket, session_id, ticket):
    try:
        session_uuid = uuid.UUID(session_id)
        claims = decode_ws_ticket(ticket, expected_session_id=session_id)
        await validate_principal({**claims, 'jti': claims.get('auth_session_id')})
    except Exception:
        await socket.close(code=4401, reason='Sign in again and request a fresh voice ticket')
        return None
    async with AsyncSessionLocal() as db:
        session = await db.get(VivaSession, session_uuid)
        if not session or claims.get('role') != 'student' or str(session.student_id) != claims['sub'] or not session.consent_given:
            await socket.close(code=4403, reason='Voice input is restricted to the consenting candidate')
            return None
        if session.status != SessionStatus.in_progress:
            await socket.close(code=4409, reason='Voice input requires an active interview')
            return None
        try:
            await check_auth_rate(db, f'speech:{claims["sub"]}', max_attempts=10,
                                  message='Too many voice requests. Please type or wait one minute.')
            db.add(AuditLog(id=uuid.UUID(claims['jti']), session_id=session_uuid,
                           actor_id=session.student_id, action='ws_ticket_redeemed', detail={'purpose': 'streaming_speech'}))
            await db.commit()
        except IntegrityError:
            await socket.close(code=4401, reason='Voice ticket already used')
            return None
        except Exception:
            await socket.close(code=4429, reason='Voice requests temporarily limited')
            return None
        return session_uuid


async def stream_draft(socket, session_uuid):
    # Only the bounded start frame may precede container bytes.
    raw = await asyncio.wait_for(socket.receive_text(), timeout=10)
    if len(raw) > 4096:
        raise ValueError('Invalid stream setup')
    setup = json.loads(raw)
    if not isinstance(setup, dict) or setup.get('type') != 'start' or setup.get('language', 'en') not in ('en', 'hi', 'multi'):
        raise ValueError('Invalid stream setup')
    async with AsyncSessionLocal() as db:
        query = select(TranscriptTurn).where(TranscriptTurn.session_id == session_uuid, TranscriptTurn.speaker == 'ai')
        if setup.get('question_turn_id'):
            query = query.where(TranscriptTurn.id == uuid.UUID(setup['question_turn_id']))
        question = await db.scalar(query.order_by(TranscriptTurn.turn_index.desc()).limit(1))
        if setup.get('question_turn_id') and not question:
            raise ValueError('Question does not belong to this interview')
        session = await db.get(VivaSession, session_uuid)
        keywords = (await db.scalars(select(Question).where(Question.viva_config_id == session.viva_config_id,
                    Question.status == QuestionStatus.approved).limit(100))).all()
        vocabulary = list(dict.fromkeys(str(term)[:80] for row in keywords for term in (row.expected_keywords or [])))[:30]
        context = {'session_id': str(session_uuid), 'question_text': question.text if question else '',
                   'question_phase': question.phase.value if question and question.phase else None,
                   'question_id': str(question.question_id) if question and question.question_id else None}
    queue = asyncio.Queue(maxsize=16)
    byte_count = 0

    async def receive():
        nonlocal byte_count
        while True:
            frame = await socket.receive()
            if frame['type'] == 'websocket.disconnect':
                raise WebSocketDisconnect()
            if frame.get('bytes') is not None:
                data = frame['bytes']
                byte_count += len(data)
                if len(data) > 128 * 1024 or byte_count > 2 * 1024 * 1024:
                    raise ValueError('Voice stream exceeds its recording limit')
                # Bounded backpressure; overload fails visibly instead of dropping speech.
                await asyncio.wait_for(queue.put(data), timeout=3)
            else:
                text = frame.get('text', '')
                if len(text) > 256 or json.loads(text).get('type') != 'stop':
                    raise ValueError('Invalid voice stream control')
                await queue.put(None)
                return

    async def chunks():
        while True:
            chunk = await queue.get()
            if chunk is None:
                return
            yield chunk

    async def recognize():
        provider = get_stt_provider()
        if isinstance(provider, DeepgramSTTProvider):
            provider.vocabulary = vocabulary
        final_text, words, confidences = [], [], []
        await socket.send_json({'type': 'ready'})
        async for result in transcribe_live(provider, chunks(), setup.get('language', 'en')):
            if result.is_final:
                final_text.append(result.text)
                words.extend(result.words[:4000 - len(words)])
                confidences.append(result.confidence)
            visible = ' '.join(final_text + ([] if result.is_final else [result.text]))
            await socket.send_json({'type': 'interim', 'text': visible})
        text = ' '.join(final_text).strip()
        if not text:
            raise ValueError('No speech detected. Retry or type your answer.')
        await record_voice_signal(session_uuid, words, context)
        payload = dict(context, text=text, words=words, confidence=sum(confidences) / len(confidences))
        await socket.send_json(dict(payload, type='draft', receipt=sign_draft(payload)))

    tasks = [asyncio.create_task(receive()), asyncio.create_task(recognize())]
    try:
        await asyncio.gather(*tasks)
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


async def record_voice_signal(session_uuid, words, context):
    from collections import Counter
    speakers = Counter(word.get('speaker') for word in words
                       if isinstance(word, dict) and isinstance(word.get('speaker'), int)
                       and not isinstance(word.get('speaker'), bool) and word.get('word'))
    # One stray word is insufficient evidence. Speaker labels are probabilistic
    # clusters for this clip, never identity or an automatic cheating verdict.
    if sum(count >= 3 for count in speakers.values()) < 2:
        return
    async with AsyncSessionLocal() as db:
        session = await db.get(VivaSession, session_uuid)
        if session:
            db.add(AuditLog(session_id=session_uuid, actor_id=session.student_id, action='voice_activity_signal', detail={
                'event_type': 'multiple_voices', 'timestamp_secs': session.elapsed_secs,
                'question_id': context.get('question_id'), 'question_text': context.get('question_text'),
                'message': 'Speech provider estimated multiple voices. Review the recording; this is not proof of misconduct.',
                'source': 'provider_diarization', 'speaker_clusters': len(speakers)}))
            await db.commit()


@router.websocket('/speech/{session_id}')
async def speech_socket(socket: WebSocket, session_id: str, ticket: str = ''):
    await socket.accept()
    session_uuid = await authorize(socket, session_id, ticket)
    if not session_uuid:
        return
    async with interview_lease('speech:' + session_id, socket) as acquired:
        if not acquired:
            return
        try:
            await asyncio.wait_for(stream_draft(socket, session_uuid), timeout=100)
        except WebSocketDisconnect:
            return
        except Exception as exc:
            # Provider details/credentials must never appear in browser messages.
            message = str(exc) if isinstance(exc, ValueError) else 'Live transcription interrupted. Retry your saved clip or type your answer.'
            await socket.send_json({'type': 'error', 'message': message})
        finally:
            try:
                await socket.close()
            except RuntimeError:
                pass
