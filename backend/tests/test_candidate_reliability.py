"""Regressions for candidate privacy, reconnection, timing and grading integrity."""
import asyncio
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.api.routes import websocket_interview as live
from app.core.config import settings
from app.core.security import create_access_token, create_ws_ticket, decode_token
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.models import VivaSession, SessionStatus, ScoreReport, TranscriptTurn
from app.services.controller import InterviewController, ControllerState, Phase, ClassificationResult, AnswerLabel
from app.services.llm_provider import MockLLMProvider
from app.services.scorer import score_session
from app.workers import tasks

STUDENT = '22222222-2222-2222-2222-222222222222'
OTHER = '33333333-3333-3333-3333-333333333333'
CONFIG = '00000000-0000-0000-0000-000000000001'
COMPLETED = '44444444-4444-4444-4444-444444444441'


def headers(student=STUDENT):
    return {'Authorization': f'Bearer {create_access_token({"sub": student, "role": "student"})}'}


@pytest_asyncio.fixture
async def candidate_session():
    async with AsyncSessionLocal() as db:
        session = VivaSession(id=uuid.uuid4(), student_id=uuid.UUID(STUDENT), viva_config_id=uuid.UUID(CONFIG),
                              status=SessionStatus.scheduled, consent_given=True, elapsed_secs=120)
        db.add(session)
        await db.commit()
        return str(session.id)


class Socket:
    def __init__(self):
        self.close_code = None
        self.messages = []
    async def accept(self):
        pass
    async def close(self, code, reason):
        self.close_code = code
    async def send_text(self, text):
        self.messages.append(text)


@pytest.mark.asyncio
@pytest.mark.parametrize('student,expected', [(None, 401), (OTHER, 403), (STUDENT, 404)])
async def test_recording_stream_requires_ownership(student, expected, monkeypatch):
    # Return no recording even if a local developer has one for this fixture ID.
    monkeypatch.setattr('app.api.routes.sessions.get_audio_storage', lambda: SimpleNamespace(get_local_audio_path=lambda key: None))
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        response = await client.get(f'/api/v1/sessions/{COMPLETED}/audio/stream', headers=headers(student) if student else {})
    assert response.status_code == expected


def test_ws_ticket_cannot_be_used_as_api_access_token():
    ticket = create_ws_ticket(COMPLETED, STUDENT, 'student')
    with pytest.raises(HTTPException) as exc:
        decode_token(ticket)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_ws_ticket_is_consumed_once(candidate_session, monkeypatch):
    run = AsyncMock()
    monkeypatch.setattr(live.InterviewSession, 'run', run)
    ticket = create_ws_ticket(candidate_session, STUDENT, 'student')
    first, second = Socket(), Socket()
    await live.interview_websocket(first, candidate_session, ticket=ticket, token=None, voice='alice')
    await live.interview_websocket(second, candidate_session, ticket=ticket, token=None, voice='alice')
    assert first.close_code is None
    assert second.close_code == 4401
    assert run.await_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('consent,status,expected', [(False, SessionStatus.scheduled, 4403), (True, SessionStatus.completed, 4409)])
async def test_socket_cannot_manufacture_consent_or_reopen_completed_exam(candidate_session, consent, status, expected):
    async with AsyncSessionLocal() as db:
        session = await db.get(VivaSession, uuid.UUID(candidate_session))
        session.consent_given, session.status = consent, status
        await db.commit()
    socket = Socket()
    ticket = create_ws_ticket(candidate_session, STUDENT, 'student')
    await live.interview_websocket(socket, candidate_session, ticket=ticket, token=None, voice='alice')
    assert socket.close_code == expected


def test_restored_interview_preserves_time_question_and_turn_indices():
    question = uuid.uuid4()
    turns = [SimpleNamespace(turn_index=4, speaker='ai', question_id=question, text='Explain a mutex.')]
    session = live.InterviewSession(Socket(), 'test', uuid.uuid4(), {}, [], elapsed_secs=320, previous_turns=turns,
                                    session_stats={'tab_switch_count': 3})
    assert 320 <= session.elapsed() < 322
    assert session.turn_index == 5
    assert session.current_question_text == 'Explain a mutex.'
    assert str(question) in session._asked_ids
    assert session.controller.state.phase == Phase.depth
    assert session.controller.state.tab_switch_count == 3


def test_answer_at_phase_boundary_advances_even_without_idle_tick():
    controller = InterviewController(ControllerState(session_id='test'))
    decision = controller.on_student_answer('Answer', ClassificationResult(AnswerLabel.strong, .95), 61, 20)
    assert decision.action == 'end_phase'
    assert controller.state.phase == Phase.fundamentals


def test_custom_duration_is_enforced_while_candidate_speaks():
    controller = InterviewController(ControllerState(session_id='test', phase_timings={Phase.warm_up: {'start': 0, 'end': 120}}))
    controller.on_student_speaking_start(110)
    assert controller.tick(120).action == 'end_interview'


@pytest.mark.asyncio
async def test_end_rest_endpoint_is_idempotent(monkeypatch):
    dispatch = AsyncMock()
    monkeypatch.setattr(tasks, '_score_session_async', dispatch)
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        response = await client.post(f'/api/v1/sessions/{COMPLETED}/end', headers=headers())
    assert response.status_code == 200
    assert response.json()['scoring'] == 'already_requested'
    dispatch.assert_not_called()


@pytest.mark.asyncio
async def test_restarting_completed_session_is_rejected():
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        response = await client.post(f'/api/v1/sessions/{COMPLETED}/start', headers=headers())
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_audio_upload_size_is_bounded(candidate_session, monkeypatch):
    monkeypatch.setattr(settings, 'MAX_AUDIO_UPLOAD_BYTES', 8)
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        response = await client.post(f'/api/v1/sessions/{candidate_session}/audio', headers=headers(),
                                     files={'file': ('audio.webm', b'x' * 9, 'audio/webm')})
    assert response.status_code == 413


@pytest.mark.asyncio
async def test_websocket_completion_dispatches_scoring_only_once(candidate_session, monkeypatch):
    from app.models.models import ScoringJob
    session = live.InterviewSession(Socket(), candidate_session, uuid.UUID(candidate_session), {}, [])
    await session._end_interview()
    await session._end_interview()
    async with AsyncSessionLocal() as db:
        jobs = list((await db.scalars(select(ScoringJob).where(ScoringJob.session_id == uuid.UUID(candidate_session)))).all())
        assert len(jobs) == 1
        assert jobs[0].status == 'queued'


@pytest.mark.asyncio
async def test_provider_failure_never_creates_invented_marks(candidate_session, monkeypatch):
    class BrokenProvider:
        async def chat_json(self, *args, **kwargs):
            raise RuntimeError('provider unavailable')
    monkeypatch.setattr(tasks, 'get_llm_provider', lambda: BrokenProvider())
    with pytest.raises(RuntimeError):
        await tasks._score_session_async(candidate_session)
    async with AsyncSessionLocal() as db:
        session = await db.get(VivaSession, uuid.UUID(candidate_session))
        report = await db.scalar(select(ScoreReport).where(ScoreReport.session_id == session.id))
        assert session.status == SessionStatus.flagged
        assert session.total_score is None
        assert report is None


@pytest.mark.asyncio
async def test_null_stt_confidence_does_not_crash_typed_answer_scoring():
    turns = [{'turn_index': 0, 'speaker': 'student', 'text': 'A mutex protects shared state.', 'stt_confidence': None}]
    report = await score_session('test', turns, {'conceptual': 100}, MockLLMProvider())
    assert 0 <= report['total_score'] <= 100


@pytest.mark.asyncio
async def test_speech_endpoint_requires_authentication():
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        response = await client.get('/api/v1/tts/synthesize', params={'text': 'test'})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_duplicate_answer_id_is_acknowledged_without_double_grading(candidate_session, monkeypatch):
    import json
    answer_id = str(uuid.uuid4())
    payload = {'type': 'candidate_answer', 'answer_id': answer_id, 'text': 'A mutex protects shared data.'}
    class AnswerSocket(Socket):
        def __init__(self):
            super().__init__()
            self.incoming = iter([json.dumps(payload), json.dumps(payload), json.dumps({'type': 'end_session'})])
        async def receive_text(self):
            return next(self.incoming)
    socket = AnswerSocket()
    classify = AsyncMock(return_value=ClassificationResult(AnswerLabel.strong, .9))
    monkeypatch.setattr(live, 'classify_answer', classify)
    session = live.InterviewSession(socket, candidate_session, uuid.UUID(candidate_session), {}, [])
    session.speak = AsyncMock()
    session._generate_intelligent_follow_up = AsyncMock(return_value='What are the trade-offs?')
    session._end_interview = AsyncMock()
    await session._receive_loop()
    assert classify.await_count == 1
    acknowledgements = [json.loads(msg) for msg in socket.messages if json.loads(msg)['type'] == 'answer_received']
    assert len(acknowledgements) == 2
    async with AsyncSessionLocal() as db:
        turns = list((await db.scalars(select(TranscriptTurn).where(TranscriptTurn.session_id == uuid.UUID(candidate_session)))).all())
        assert len(turns) == 1
        assert str(turns[0].id) == answer_id


@pytest.mark.asyncio
async def test_only_one_connection_can_own_a_session():
    from app.services.interview_lease import interview_lease
    first, second, third = Socket(), Socket(), Socket()
    async with interview_lease('lease-test', first) as acquired:
        assert acquired
        async with interview_lease('lease-test', second) as duplicate:
            assert not duplicate
            assert second.close_code == 4409
    async with interview_lease('lease-test', third) as acquired:
        assert acquired


@pytest.mark.parametrize('duration', [600, 900, 1200, 1800])
def test_faculty_duration_creates_matching_contiguous_phases(duration):
    from app.api.routes.viva_configs import CreateVivaConfigRequest
    config = CreateVivaConfigRequest(title='Test', subject='Algorithms', total_duration_secs=duration)
    previous = 0
    for interval in config.phase_timings.values():
        assert interval['start'] == previous
        previous = interval['end']
    assert previous == duration


@pytest.mark.parametrize('weights', [
    {'conceptual': 100},
    {'conceptual': 30, 'depth_reasoning': 25, 'problem_solving': 20, 'practical_project': 15, 'communication': -1},
    {'conceptual': 100, 'depth_reasoning': 25, 'problem_solving': 20, 'practical_project': 15, 'communication': 10},
])
def test_invalid_rubrics_are_rejected(weights):
    from pydantic import ValidationError
    from app.api.routes.viva_configs import CreateVivaConfigRequest
    with pytest.raises(ValidationError):
        CreateVivaConfigRequest(title='Test', subject='Algorithms', rubric_weights=weights)


@pytest.mark.asyncio
@pytest.mark.parametrize('path', ['/api/v1/questions/config/invalid', '/api/v1/viva-configs/invalid', '/api/v1/dashboard/sessions/invalid/detail'])
async def test_malformed_faculty_ids_return_validation_errors(path):
    auth = {'Authorization': 'Bearer ' + create_access_token({'sub': '11111111-1111-1111-1111-111111111111', 'role': 'faculty'})}
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        response = await client.get(path, headers=auth)
    assert response.status_code == 422


def test_production_cannot_create_mock_grades(monkeypatch):
    from app.services.llm_provider import get_llm_provider
    monkeypatch.setattr(settings, 'APP_ENV', 'production')
    monkeypatch.setattr(settings, 'MOCK_MODE', True)
    with pytest.raises(RuntimeError, match='Mock evaluation'):
        get_llm_provider()
