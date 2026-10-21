"""Live provider streaming, draft authorization and mixed-recording contracts."""
import asyncio
import json
import uuid
from types import SimpleNamespace
import pytest
from fastapi import WebSocketDisconnect
from httpx import AsyncClient, ASGITransport
from app.core.security import create_ws_ticket, create_access_token
from app.db.session import AsyncSessionLocal
from app.models.models import VivaSession, SessionStatus, TranscriptTurn, VivaPhase
from app.api.routes import streaming_speech
from app.services.stt_provider import deepgram_live, STTResult
from app.services.speech_review import verify_draft
from app.main import app

STUDENT = '22222222-2222-2222-2222-222222222222'
OTHER = '22222222-2222-2222-2222-222222222223'
CONFIG = '00000000-0000-0000-0000-000000000001'


async def create_session(consent=True, status=SessionStatus.in_progress):
    identity = uuid.uuid4()
    async with AsyncSessionLocal() as db:
        db.add(VivaSession(id=identity, student_id=uuid.UUID(STUDENT), viva_config_id=uuid.UUID(CONFIG),
                           consent_given=consent, status=status))
        await db.commit()
    return identity


class Socket:
    def __init__(self, frames=()):
        self.frames = iter(frames)
        self.sent = []
        self.code = None
    async def receive_text(self): return next(self.frames)
    async def receive(self): return next(self.frames)
    async def send_json(self, payload): self.sent.append(payload)
    async def close(self, code=1000, reason=''): self.code = code


@pytest.mark.asyncio
async def test_provider_yields_interim_before_input_finishes_and_flushes_close(monkeypatch):
    incoming = asyncio.Queue()
    allow_rest = asyncio.Event()
    sent = []
    class Upstream:
        async def send(self, value):
            sent.append(value)
            if isinstance(value, bytes):
                await incoming.put(json.dumps({'type': 'Results', 'is_final': False,
                    'channel': {'alternatives': [{'transcript': 'live words', 'confidence': .9}]}}))
            else:
                assert json.loads(value)['type'] == 'CloseStream'
                await incoming.put(json.dumps({'type': 'Results', 'is_final': True,
                    'channel': {'alternatives': [{'transcript': 'final words', 'confidence': .95}]}}))
                await incoming.put(None)
        def __aiter__(self): return self
        async def __anext__(self):
            value = await incoming.get()
            if value is None: raise StopAsyncIteration
            return value
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
    def connect(url, **kwargs):
        assert 'interim_results=true' in url and 'language=en' in url
        assert kwargs['extra_headers']['Authorization'] == 'Token test-provider-key'
        return Upstream()
    import websockets
    monkeypatch.setattr(websockets, 'connect', connect)
    async def chunks():
        yield b'container-header-and-first-fragment'
        await allow_rest.wait()
        yield b'second-fragment'
    stream = deepgram_live(chunks(), api_key='test-provider-key', model='nova-2')
    first = await asyncio.wait_for(anext(stream), 2)
    assert not first.is_final and first.text == 'live words'
    assert len(sent) == 1  # The remaining audio has not even been captured.
    allow_rest.set()
    rest = [item async for item in stream]
    assert rest[-1].is_final and rest[-1].text == 'final words'
    assert json.loads(sent[-1]) == {'type': 'CloseStream'}


@pytest.mark.asyncio
async def test_stream_accumulates_final_segments_without_duplicating_interims(monkeypatch):
    session = await create_session()
    question_id = uuid.uuid4()
    async with AsyncSessionLocal() as db:
        db.add(TranscriptTurn(id=question_id, session_id=session, turn_index=0, speaker='ai',
                              text='Explain a mutex.', timestamp_secs=3, phase=VivaPhase.fundamentals))
        await db.commit()
    socket = Socket([json.dumps({'type': 'start', 'question_turn_id': str(question_id)}),
                     {'type': 'websocket.receive', 'bytes': b'first'},
                     {'type': 'websocket.receive', 'text': '{"type":"stop"}'}])
    async def recognize(provider, chunks, language):
        async for _ in chunks: pass
        yield STTResult('Threads', .8, False)
        yield STTResult('Threads share memory.', .9, True)
        yield STTResult('A mutex', .8, False)
        yield STTResult('A mutex protects state.', .95, True)
    monkeypatch.setattr(streaming_speech, 'transcribe_live', recognize)
    await streaming_speech.stream_draft(socket, session)
    draft = socket.sent[-1]
    assert draft['type'] == 'draft'
    assert draft['text'] == 'Threads share memory. A mutex protects state.'
    verified = verify_draft(draft['receipt'], str(session))
    assert verified['question_text'] == 'Explain a mutex.'
    assert verified['text'] == draft['text']
    async with AsyncSessionLocal() as db:
        from sqlalchemy import select
        assert not (await db.scalars(select(TranscriptTurn).where(TranscriptTurn.session_id == session, TranscriptTurn.speaker == 'student'))).all()


@pytest.mark.asyncio
async def test_stream_ticket_cannot_be_reused_or_cross_candidate():
    session = await create_session()
    ticket = create_ws_ticket(str(session), STUDENT, 'student')
    assert await streaming_speech.authorize(Socket(), str(session), ticket) == session
    duplicate = Socket()
    assert await streaming_speech.authorize(duplicate, str(session), ticket) is None
    assert duplicate.code == 4401
    other = Socket()
    assert await streaming_speech.authorize(other, str(session), create_ws_ticket(str(session), OTHER, 'student')) is None
    assert other.code in (4401, 4403)


@pytest.mark.parametrize('consent,status', [(False, SessionStatus.in_progress), (True, SessionStatus.completed)])
@pytest.mark.asyncio
async def test_stream_requires_consent_and_active_exam(consent, status):
    session = await create_session(consent, status)
    socket = Socket()
    assert await streaming_speech.authorize(socket, str(session), create_ws_ticket(str(session), STUDENT, 'student')) is None
    assert socket.code in (4403, 4409)


@pytest.mark.asyncio
async def test_mixed_recording_kind_is_durable_and_immutable():
    from test_durable_interview import wav_bytes
    session = await create_session()
    identity = uuid.uuid4()
    params = {'capture_id': str(uuid.uuid4()), 'sequence': 0, 'start_secs': 0, 'recording_kind': 'conversation'}
    headers = {'Authorization': 'Bearer ' + create_access_token({'sub': STUDENT, 'role': 'student'}), 'Content-Type': 'audio/wav'}
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test', headers=headers) as client:
        path = f'/api/v1/sessions/{session}/recording/chunks/{identity}'
        assert (await client.put(path, params=params, content=wav_bytes())).status_code == 200
        manifest = (await client.get(f'/api/v1/sessions/{session}/recording')).json()
        assert manifest['captures'][0]['recording_kind'] == 'conversation'
        params['recording_kind'] = 'candidate'
        assert (await client.put(path, params=params, content=wav_bytes())).status_code == 409


@pytest.mark.asyncio
async def test_multiple_voice_signal_is_review_evidence_and_never_changes_marks():
    from sqlalchemy import select
    from app.models.models import AuditLog
    session = await create_session()
    words = [{'word': 'synthetic', 'speaker': speaker} for speaker in (0, 0, 0, 1, 1, 1)]
    await streaming_speech.record_voice_signal(session, words, {'question_text': 'Explain your project.'})
    async with AsyncSessionLocal() as db:
        row = await db.get(VivaSession, session)
        assert row.total_score is None and row.status == SessionStatus.in_progress
        event = await db.scalar(select(AuditLog).where(AuditLog.session_id == session, AuditLog.action == 'voice_activity_signal'))
        assert event.detail['event_type'] == 'multiple_voices'
        assert 'not proof' in event.detail['message']


@pytest.mark.asyncio
async def test_concurrent_ai_and_candidate_writes_keep_unique_evidence_indices():
    from sqlalchemy import select
    from app.api.routes.websocket_interview import InterviewSession
    session = await create_session()
    interview = InterviewSession(None, str(session), session, {}, [])
    await asyncio.gather(interview._save_turn('ai', 'A newly announced question'),
                         interview._save_turn('student', 'An answer received during a phase change'),
                         interview._save_turn('ai', 'A follow-up'))
    async with AsyncSessionLocal() as db:
        turns = (await db.scalars(select(TranscriptTurn).where(TranscriptTurn.session_id == session).order_by(TranscriptTurn.turn_index))).all()
        assert [turn.turn_index for turn in turns] == [0, 1, 2]
        assert len({turn.id for turn in turns}) == 3
