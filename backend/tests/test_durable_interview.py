"""Recovery, interruption, revocation and durable job integration regressions."""
import asyncio
import io
import json
import uuid
import wave
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select
from app.main import app
from app.db.session import AsyncSessionLocal
from app.core.security import create_access_token
from app.models.models import VivaSession, SessionStatus, AudioChunk, ScoringJob, ScoreReport, TranscriptTurn
from app.services import scoring_jobs
from app.api.routes.websocket_interview import InterviewSession
from app.workers import tasks

STUDENT = '22222222-2222-2222-2222-222222222222'
CONFIG = '00000000-0000-0000-0000-000000000001'
AUTH = {'Authorization': 'Bearer ' + create_access_token({'sub': STUDENT, 'role': 'student'})}


@pytest_asyncio.fixture
async def session_id():
    async with AsyncSessionLocal() as db:
        session = VivaSession(id=uuid.uuid4(), student_id=uuid.UUID(STUDENT), viva_config_id=uuid.UUID(CONFIG),
            consent_given=True, status=SessionStatus.in_progress)
        db.add(session)
        await db.commit()
        return session.id


def wav_bytes():
    output = io.BytesIO()
    with wave.open(output, 'wb') as sample:
        sample.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
        sample.writeframes((1000).to_bytes(2, 'little', signed=True) * 1600)
    return output.getvalue()


@pytest.mark.asyncio
async def test_recording_reload_preserves_both_captures_and_timeline(session_id):
    sample = wav_bytes()
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test', headers=AUTH) as client:
        for start in [1, 3]:
            capture_id = uuid.uuid4()
            for sequence, payload in enumerate([sample[:60], sample[60:]]):
                chunk_id = uuid.uuid4()
                params = {'capture_id': str(capture_id), 'sequence': sequence, 'start_secs': start}
                path = f'/api/v1/sessions/{session_id}/recording/chunks/{chunk_id}'
                response = await client.put(path, params=params, content=payload, headers={'Content-Type': 'audio/wav'})
                assert response.status_code == 200, response.text
                again = await client.put(path, params=params, content=payload, headers={'Content-Type': 'audio/wav'})
                assert again.json()['duplicate'] is True
                conflict = await client.put(path, params=params, content=b'changed', headers={'Content-Type': 'audio/wav'})
                assert conflict.status_code == 409
        manifest = (await client.get(f'/api/v1/sessions/{session_id}/recording')).json()
        assert manifest['chunk_count'] == 4
        assert len(manifest['captures']) == 2
        assert all(not capture['missing_sequences'] for capture in manifest['captures'])
        audio = await client.get(f'/api/v1/sessions/{session_id}/audio/stream')
        assert audio.status_code == 200, audio.text[:200] if audio.status_code != 200 else ''
        with wave.open(io.BytesIO(audio.content)) as reconstructed:
            assert 3.09 < reconstructed.getnframes() / 16000 < 3.11
            frames = reconstructed.readframes(reconstructed.getnframes())
            assert frames[:32000] == bytes(32000)
            assert int.from_bytes(frames[32000:32002], 'little', signed=True) == 1000
            assert int.from_bytes(frames[96000:96002], 'little', signed=True) == 1000
        assert audio.headers['cache-control'] == 'private, no-store'
    async with AsyncSessionLocal() as db:
        assert len(list((await db.scalars(select(AudioChunk).where(AudioChunk.session_id == session_id))).all())) == 4


@pytest.mark.asyncio
async def test_chunk_ownership_and_missing_sequences(session_id):
    other = {'Authorization': 'Bearer ' + create_access_token({'sub': '33333333-3333-3333-3333-333333333333', 'role': 'student'})}
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        path = f'/api/v1/sessions/{session_id}/recording/chunks/{uuid.uuid4()}'
        params = {'capture_id': str(uuid.uuid4()), 'sequence': 1, 'start_secs': 0}
        assert (await client.put(path, params=params, content=wav_bytes(), headers={**other, 'Content-Type': 'audio/wav'})).status_code == 403
        assert (await client.put(path, params=params, content=wav_bytes(), headers={**AUTH, 'Content-Type': 'audio/wav'})).status_code == 200
        assert (await client.get(f'/api/v1/sessions/{session_id}/audio/stream', headers=AUTH)).status_code == 409


@pytest.mark.asyncio
async def test_logout_revokes_cookie_token_and_previously_issued_ticket(session_id):
    from app.core.security import decode_ws_ticket, validate_principal
    from fastapi import HTTPException
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        login = await client.post('/api/v1/auth/login', json={'student_id': 'STU001', 'password': 'student123'})
        assert login.status_code == 200
        token = login.json()['access_token']
        ticket = (await client.post(f'/api/v1/sessions/{session_id}/ws-ticket')).json()['ticket']
        assert (await client.get('/api/v1/auth/me')).status_code == 200
        assert (await client.post('/api/v1/auth/logout')).status_code == 200
        assert (await client.get('/api/v1/auth/me', headers={'Authorization': f'Bearer {token}'})).status_code == 401
        claims = decode_ws_ticket(ticket, str(session_id))
        with pytest.raises(HTTPException):
            await validate_principal({**claims, 'jti': claims['auth_session_id']})


@pytest.mark.asyncio
async def test_login_attempts_are_throttled():
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        for _ in range(20):
            response = await client.post('/api/v1/auth/login', json={'student_id': 'nonexistent', 'password': 'incorrect'})
            assert response.status_code == 401
        response = await client.post('/api/v1/auth/login', json={'student_id': 'nonexistent', 'password': 'incorrect'})
        assert response.status_code == 429
        assert response.headers['retry-after'] == '60'


@pytest.mark.asyncio
async def test_completion_enqueues_and_restart_worker_scores_once(session_id):
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test', headers=AUTH) as client:
        assert (await client.post(f'/api/v1/sessions/{session_id}/end')).json()['scoring'] == 'queued'
        assert (await client.post(f'/api/v1/sessions/{session_id}/end')).json()['scoring'] == 'already_requested'
    # Simulate a worker dying after claiming the job, then a new worker taking over.
    first = await scoring_jobs.claim_job()
    assert first[0] == session_id
    async with AsyncSessionLocal() as db:
        job = await db.get(ScoringJob, session_id)
        job.lease_until = datetime.now(timezone.utc) - timedelta(seconds=1)
        await db.commit()
    assert await scoring_jobs.process_one_job()
    assert not await scoring_jobs.process_one_job()
    async with AsyncSessionLocal() as db:
        job = await db.get(ScoringJob, session_id)
        # This fixture has no candidate answers. Recovery must finish in
        # review without inventing a numeric score for an empty interview.
        assert job.status == 'review_required'
        assert job.attempts == 2
        assert len(list((await db.scalars(select(ScoreReport).where(ScoreReport.session_id == session_id))).all())) == 0


@pytest.mark.asyncio
async def test_scoring_failure_retries_then_requires_review(session_id, monkeypatch):
    monkeypatch.setattr(tasks, '_score_session_async', AsyncMock(side_effect=RuntimeError('provider unavailable')))
    async with AsyncSessionLocal() as db:
        await scoring_jobs.enqueue_scoring(db, session_id)
        await db.commit()
    for attempt in range(3):
        assert await scoring_jobs.process_one_job()
        async with AsyncSessionLocal() as db:
            job = await db.get(ScoringJob, session_id)
            assert job.status == ('failed' if attempt == 2 else 'queued')
            job.available_at = datetime.now(timezone.utc) - timedelta(seconds=1)
            await db.commit()
    async with AsyncSessionLocal() as db:
        session = await db.get(VivaSession, session_id)
        assert session.status == SessionStatus.flagged
        assert session.total_score is None


@pytest.mark.asyncio
async def test_stale_worker_cannot_publish_a_grade(session_id):
    async with AsyncSessionLocal() as db:
        await scoring_jobs.enqueue_scoring(db, session_id)
        await db.commit()
    _, old_token = await scoring_jobs.claim_job()
    async with AsyncSessionLocal() as db:
        job = await db.get(ScoringJob, session_id)
        job.claim_token = uuid.uuid4()
        await db.commit()
    await tasks._score_session_async(str(session_id), claim_token=old_token)
    async with AsyncSessionLocal() as db:
        assert await db.scalar(select(ScoreReport).where(ScoreReport.session_id == session_id)) is None


@pytest.mark.asyncio
async def test_barge_in_cancels_slow_speech_without_ending_exam(session_id):
    started, cancelled = asyncio.Event(), asyncio.Event()
    class SlowSpeech:
        async def synthesize(self, *args, **kwargs):
            try:
                started.set()
                yield b'audio'
                await asyncio.Event().wait()
            finally:
                cancelled.set()
    class Socket:
        def __init__(self):
            self.incoming, self.outgoing = asyncio.Queue(), []
        async def receive_text(self):
            return await self.incoming.get()
        async def send_text(self, text):
            self.outgoing.append(json.loads(text))
    socket = Socket()
    interview = InterviewSession(socket, str(session_id), session_id, {}, [])
    interview.tts = SlowSpeech()
    run = asyncio.create_task(interview.run())
    try:
        await asyncio.wait_for(started.wait(), 2)
        await socket.incoming.put(json.dumps({'type': 'barge_in'}))
        await asyncio.wait_for(cancelled.wait(), .5)
        assert not run.done()
        await socket.incoming.put(json.dumps({'type': 'ping'}))
        for _ in range(100):
            if any(message['type'] == 'pong' for message in socket.outgoing): break
            await asyncio.sleep(.01)
        assert any(message['type'] == 'ai_interrupted' for message in socket.outgoing)
        assert any(message['type'] == 'pong' for message in socket.outgoing)
        assert not any(message['type'] == 'interview_ended' for message in socket.outgoing)
    finally:
        run.cancel()
        await asyncio.gather(run, return_exceptions=True)


@pytest.mark.asyncio
async def test_completed_legacy_session_is_recovered_into_durable_queue(session_id):
    async with AsyncSessionLocal() as db:
        session = await db.get(VivaSession, session_id)
        session.status = SessionStatus.completed
        await db.commit()
    await scoring_jobs.reconcile_completed_sessions()
    await scoring_jobs.reconcile_completed_sessions()
    async with AsyncSessionLocal() as db:
        jobs = list((await db.scalars(select(ScoringJob).where(ScoringJob.session_id == session_id))).all())
        assert len(jobs) == 1
        assert jobs[0].status == 'queued'


@pytest.mark.asyncio
async def test_received_answer_survives_classifier_timeout(session_id, monkeypatch):
    from app.api.routes import websocket_interview as live
    started = asyncio.Event()
    async def slow_classifier(**kwargs):
        started.set()
        await asyncio.Event().wait()
    monkeypatch.setattr(live, 'classify_answer', slow_classifier)
    answer_id = uuid.uuid4()
    class Socket:
        async def receive_text(self):
            return json.dumps({'type': 'candidate_answer', 'answer_id': str(answer_id), 'text': 'My final answer.'})
        async def send_text(self, text):
            pass
    interview = InterviewSession(Socket(), str(session_id), session_id, {}, [])
    processing = asyncio.create_task(interview._receive_loop())
    try:
        await asyncio.wait_for(started.wait(), 2)
        processing.cancel()
        await asyncio.gather(processing, return_exceptions=True)
        async with AsyncSessionLocal() as db:
            saved = await db.get(TranscriptTurn, answer_id)
            assert saved.text == 'My final answer.'
            assert saved.answer_label is None
    finally:
        processing.cancel()
        await asyncio.gather(processing, return_exceptions=True)
