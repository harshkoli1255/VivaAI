"""Evidence and recognition failures must never become invented academic marks."""
import uuid
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select

from app.main import app
from app.core.security import create_access_token, decode_token
from app.db.session import AsyncSessionLocal
from app.models.models import VivaSession, TranscriptTurn, SessionStatus, ScoringJob, ScoreReport, AuditLog
from app.services.adaptive_questions import AdaptiveQuestions, repeats
from app.services.speech_review import sign_draft, verify_draft
from app.services.scorer import score_session
from app.services.llm_provider import MockLLMProvider
from app.services.scoring_jobs import enqueue_scoring, process_one_job
from app.services.classifier import classify_answer

STUDENT = '22222222-2222-2222-2222-222222222222'
CONFIG = '00000000-0000-0000-0000-000000000001'
DIMS = ['conceptual', 'depth_reasoning', 'problem_solving', 'practical_project', 'communication']


def test_speech_receipt_is_bound_to_session_and_not_a_login_token():
    receipt = sign_draft({'session_id': 'one', 'text': 'mutex', 'confidence': .4, 'words': []})
    assert verify_draft(receipt, 'one')['text'] == 'mutex'
    for invalid, session in [(receipt, 'two'), (receipt + 'x', 'one')]:
        with pytest.raises(ValueError): verify_draft(invalid, session)
    with pytest.raises(Exception): decode_token(receipt)


def test_expired_receipt_rejected(monkeypatch):
    receipt = sign_draft({'session_id': 'one'})
    monkeypatch.setattr('app.services.speech_review.time.time', lambda: 10**12)
    with pytest.raises(ValueError): verify_draft(receipt, 'one')


@pytest.mark.asyncio
async def test_grading_rejects_ai_citations_and_unconfirmed_speech():
    raw = MockLLMProvider()._mock_score()
    for dim in DIMS: raw[f'{dim}_turn_ids'] = [0]
    llm = SimpleNamespace(chat_json=AsyncMock(return_value=raw))
    turns = [{'turn_index': 0, 'speaker': 'ai', 'text': 'The answer is a mutex.'},
             {'turn_index': 1, 'speaker': 'student', 'text': 'new taxes', 'stt_confidence': .3}]
    result = await score_session('one', turns, {'conceptual': 100}, llm)
    assert result['needs_faculty_review']
    assert all(result[f'{dim}_turn_ids'] == [] for dim in DIMS)
    assert any('Unconfirmed' in reason for reason in result['low_confidence_reasons'])


@pytest.mark.asyncio
async def test_reviewed_correction_is_not_penalized_for_original_stt_confidence():
    turns = [{'turn_index': 1, 'speaker': 'student', 'text': 'A mutex protects shared state.',
              'stt_confidence': .2, 'answer_metadata': {'reviewed': True, 'original_text': 'new taxes'}}]
    result = await score_session('one', turns, {'conceptual': 100}, MockLLMProvider())
    assert not any('Unconfirmed' in reason for reason in result.get('low_confidence_reasons', []))
    assert result['conceptual_turn_ids'] == [1]


@pytest.mark.asyncio
async def test_classifier_rejects_nonfinite_confidence():
    llm = SimpleNamespace(chat_json=AsyncMock(return_value={'label': 'strong', 'confidence': float('nan')}))
    result = await classify_answer('Question?', 'An answer', llm)
    assert result.confidence == .5
    assert result.label.value == 'partial'


@pytest.mark.asyncio
async def test_auto_submitted_browser_speech_requires_transcript_verification():
    turns = [{'turn_index': i, 'speaker': 'student', 'text': 'A mutex protects shared state.',
              'answer_metadata': {'automatic_submission': True, 'reviewed': False}} for i in range(3)]
    result = await score_session('one', turns, {'conceptual': 100}, MockLLMProvider())
    assert result['needs_faculty_review']
    assert any('Automatically submitted' in reason for reason in result['low_confidence_reasons'])


@pytest.mark.asyncio
async def test_malformed_numeric_score_gets_one_bounded_schema_repair():
    valid = MockLLMProvider()._mock_score()
    for dimension in DIMS: valid[f'{dimension}_turn_ids'] = [1, 3, 5]
    invalid = dict(valid, practical_project_score='Explanation accidentally returned in numeric field')
    llm = SimpleNamespace(chat_json=AsyncMock(side_effect=[invalid, valid]))
    turns = [{'turn_index': index, 'speaker': 'student', 'text': 'A clear candidate answer.'} for index in (1, 3, 5)]
    result = await score_session('repair', turns, {'conceptual': 100}, llm)
    assert llm.chat_json.await_count == 2
    assert isinstance(result['practical_project_score'], float)
    assert not result['needs_faculty_review']
    llm.chat_json = AsyncMock(return_value=invalid)
    with pytest.raises(ValueError): await score_session('repair', turns, {'conceptual': 100}, llm)
    assert llm.chat_json.await_count == 2


def test_adaptation_requires_two_confident_answers_and_preserves_coverage():
    plan = AdaptiveQuestions()
    plan.observe('strong', .1)
    plan.observe('strong', .95)
    assert plan.difficulty == 'medium'
    plan.observe('strong', .95)
    assert plan.difficulty == 'hard'
    questions = [{'id': 'a', 'text': 'Explain mutexes.', 'topic': 'locks', 'difficulty': 'hard'},
                 {'id': 'b', 'text': 'Explain paging.', 'topic': 'memory', 'difficulty': 'hard'},
                 {'id': 'c', 'text': 'Explain mutexes!', 'topic': 'locks', 'difficulty': 'hard'}]
    asked = set()
    assert plan.choose(questions, asked)['id'] == 'a'
    assert plan.choose(questions, asked)['id'] == 'b'
    assert plan.choose(questions, asked) is None
    assert repeats('Explain mutexes?', plan.asked)


@pytest.mark.asyncio
async def test_cloud_draft_auth_ownership_and_no_automatic_grading():
    session_id = uuid.uuid4()
    async with AsyncSessionLocal() as db:
        db.add(VivaSession(id=session_id, student_id=uuid.UUID(STUDENT), viva_config_id=uuid.UUID(CONFIG),
                          consent_given=True, status=SessionStatus.in_progress))
        await db.commit()
    path = f'/api/v1/sessions/{session_id}/speech-draft'
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        assert (await client.post(path, content=b'audio', headers={'Content-Type': 'audio/webm'})).status_code == 401
        other = create_access_token({'sub': '33333333-3333-3333-3333-333333333333', 'role': 'student'})
        assert (await client.post(path, content=b'audio', headers={'Content-Type': 'audio/webm', 'Authorization': f'Bearer {other}'})).status_code == 403
        token = create_access_token({'sub': STUDENT, 'role': 'student'})
        response = await client.post(path, content=b'audio', headers={'Content-Type': 'audio/webm', 'Authorization': f'Bearer {token}'})
        assert response.status_code == 200, response.text
        draft = verify_draft(response.json()['receipt'], str(session_id))
        assert draft['text'] and draft['confidence'] > 0
    async with AsyncSessionLocal() as db:
        assert not await db.scalar(select(TranscriptTurn).where(TranscriptTurn.session_id == session_id))
        assert not await db.get(ScoringJob, session_id)


@pytest.mark.asyncio
async def test_missing_evidence_is_terminal_review_without_numeric_report():
    session_id = uuid.uuid4()
    async with AsyncSessionLocal() as db:
        db.add(VivaSession(id=session_id, student_id=uuid.UUID(STUDENT), viva_config_id=uuid.UUID(CONFIG),
                          consent_given=True, status=SessionStatus.completed))
        await db.flush()
        await enqueue_scoring(db, session_id)
        await db.commit()
    assert await process_one_job()
    assert not await process_one_job()
    async with AsyncSessionLocal() as db:
        assert (await db.get(ScoringJob, session_id)).status == 'review_required'
        assert not await db.scalar(select(ScoreReport).where(ScoreReport.session_id == session_id))
        assert (await db.get(VivaSession, session_id)).total_score is None
        assert await db.scalar(select(AuditLog).where(AuditLog.session_id == session_id, AuditLog.action == 'scoring_review_required'))
    student = create_access_token({'sub': STUDENT, 'role': 'student'})
    faculty = create_access_token({'sub': '11111111-1111-1111-1111-111111111111', 'role': 'faculty'})
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        path = f'/api/v1/scores/{session_id}'
        assert (await client.get(path, headers={'Authorization': f'Bearer {student}'})).status_code == 409
        assert (await client.get(path + '/pdf', headers={'Authorization': f'Bearer {student}'})).status_code == 404
        response = await client.post(f'/api/v1/sessions/{session_id}/override',
            json={'override_score': 76, 'reason': 'Faculty reviewed the candidate recording and rubric evidence.'},
            headers={'Authorization': f'Bearer {faculty}'})
        assert response.status_code == 200
        report = (await client.get(path, headers={'Authorization': f'Bearer {student}'})).json()
        assert report['effective_score'] == 76
        assert report['model_used'] == 'faculty'
        assert report['dimensions'] == {}  # Do not invent dimension marks.


@pytest.mark.asyncio
async def test_supported_evidence_publishes_one_numeric_report():
    session_id = uuid.uuid4()
    async with AsyncSessionLocal() as db:
        db.add(VivaSession(id=session_id, student_id=uuid.UUID(STUDENT), viva_config_id=uuid.UUID(CONFIG),
                          consent_given=True, status=SessionStatus.completed))
        await db.flush()
        for index in range(3):
            db.add(TranscriptTurn(session_id=session_id, turn_index=index, speaker='student',
                                  text='A mutex protects shared state through mutual exclusion.', timestamp_secs=index * 30))
        await enqueue_scoring(db, session_id)
        await db.commit()
    assert await process_one_job()
    assert not await process_one_job()
    async with AsyncSessionLocal() as db:
        assert (await db.get(ScoringJob, session_id)).status == 'completed'
        reports = (await db.scalars(select(ScoreReport).where(ScoreReport.session_id == session_id))).all()
        assert len(reports) == 1
        assert 0 <= reports[0].total_score <= 100
        assert reports[0].conceptual_turn_ids


@pytest.mark.asyncio
async def test_reviewed_speech_preserves_original_and_earlier_question(monkeypatch):
    from app.api.routes import websocket_interview as live
    from app.services.controller import Phase, ClassificationResult, AnswerLabel
    session_id = uuid.uuid4()
    async with AsyncSessionLocal() as db:
        db.add(VivaSession(id=session_id, student_id=uuid.UUID(STUDENT), viva_config_id=uuid.UUID(CONFIG),
                          consent_given=True, status=SessionStatus.in_progress))
        await db.commit()
    answer_id = uuid.uuid4()
    receipt = sign_draft({'session_id': str(session_id), 'text': 'new taxes', 'confidence': .3,
        'words': [{'word': 'taxes', 'confidence': .3}], 'question_text': 'Explain mutexes.',
        'question_id': None, 'question_phase': 'warm_up'})
    class Socket:
        def __init__(self):
            self.messages = []
            self.incoming = iter([json.dumps({'type': 'candidate_answer', 'answer_id': str(answer_id),
                'text': 'A mutex protects shared state.', 'speech_receipt': receipt}), json.dumps({'type': 'end_session'})])
        async def receive_text(self): return next(self.incoming)
        async def send_text(self, value): self.messages.append(json.loads(value))
    socket = Socket()
    classify = AsyncMock(return_value=ClassificationResult(AnswerLabel.strong, .95))
    monkeypatch.setattr(live, 'classify_answer', classify)
    interview = live.InterviewSession(socket, str(session_id), session_id, {}, [])
    interview.controller.state.phase = Phase.depth
    interview.current_question_text = 'A later question?'
    interview._end_interview = AsyncMock()
    interview.speak = AsyncMock()
    await interview._receive_loop()
    assert classify.await_args.kwargs['question'] == 'Explain mutexes.'
    assert any(message['type'] == 'answer_saved_previous_question' for message in socket.messages)
    async with AsyncSessionLocal() as db:
        turn = await db.get(TranscriptTurn, answer_id)
        assert turn.text == 'A mutex protects shared state.'
        assert turn.answer_metadata['original_text'] == 'new taxes'
        assert turn.answer_metadata['corrected'] is True
        assert turn.classifier_confidence == .95
        assert turn.stt_words[0]['confidence'] == .3
