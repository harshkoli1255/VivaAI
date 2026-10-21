"""Feedback claims must cite real candidate turns, survive persistence, and obey access checks."""
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select

from app.main import app
from app.core.security import create_access_token
from app.db.session import AsyncSessionLocal
from app.models.models import VivaSession, TranscriptTurn, ScoreReport, SessionStatus
from app.services.feedback_evidence import feedback_evidence
from app.services.llm_provider import MockLLMProvider
from app.services.scorer import score_session
from app.services.scoring_jobs import enqueue_scoring, process_one_job

DIMS = ('conceptual', 'depth_reasoning', 'problem_solving', 'practical_project', 'communication')
STUDENT = '22222222-2222-2222-2222-222222222222'


def headers(subject=STUDENT, role='student'):
    return {'Authorization': 'Bearer ' + create_access_token({'sub': subject, 'role': role})}


@pytest.mark.asyncio
@pytest.mark.parametrize('bad_citations', [[], [0], [999], [True], ['1'], None])
async def test_unsupported_feedback_prevents_publication(bad_citations):
    raw = MockLLMProvider()._mock_score()
    for dim in DIMS:
        raw[f'{dim}_turn_ids'] = [1, 3, 5]
    raw['feedback_turn_ids'] = [bad_citations, [3], [5]]
    turns = [{'turn_index': 0, 'speaker': 'ai', 'text': 'Examiner explanation.'}] + [
        {'turn_index': i, 'speaker': 'student', 'text': 'An answer with candidate evidence.'} for i in (1, 3, 5)]
    result = await score_session('feedback-test', turns, {'conceptual': 100}, SimpleNamespace(chat_json=AsyncMock(return_value=raw)))
    assert result['needs_faculty_review']
    assert result['feedback_turn_ids'][0] == []
    assert any('Feedback line 1' in reason for reason in result['low_confidence_reasons'])


def test_legacy_feedback_is_not_given_invented_links():
    report = SimpleNamespace(feedback_lines=['Old advice.'], feedback_turn_ids=[])
    assert feedback_evidence(report, [SimpleNamespace(turn_index=1, speaker='student', text='A real answer.')]) == [
        {'text': 'Old advice.', 'citations': [], 'evidence_status': 'not_recorded'}]


@pytest.mark.asyncio
async def test_feedback_evidence_persists_and_resolves_to_authorized_transcript():
    session_id = uuid.uuid4()
    async with AsyncSessionLocal() as db:
        db.add(VivaSession(id=session_id, student_id=uuid.UUID(STUDENT),
            viva_config_id=uuid.UUID('00000000-0000-0000-0000-000000000001'),
            status=SessionStatus.completed, consent_given=True))
        for i in range(6):
            db.add(TranscriptTurn(session_id=session_id, turn_index=i, speaker='student' if i % 2 else 'ai',
                text='Processes isolate memory and threads share memory within a process.' if i % 2 else 'Explain memory.',
                timestamp_secs=i * 12))
        await db.commit()
        await enqueue_scoring(db, session_id)
        await db.commit()
    assert await process_one_job()
    async with AsyncSessionLocal() as db:
        report = await db.scalar(select(ScoreReport).where(ScoreReport.session_id == session_id))
        assert report.feedback_turn_ids == [[1], [3], [5]]
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        response = await client.get(f'/api/v1/scores/{session_id}', headers=headers())
        assert response.status_code == 200
        data = response.json()
        assert len(data['feedback_evidence']) == len(data['feedback_lines']) == 3
        for item, expected in zip(data['feedback_evidence'], (1, 3, 5)):
            citation = item['citations'][0]
            assert citation['turn_index'] == expected
            assert citation['timestamp_secs'] == expected * 12
            assert uuid.UUID(citation['turn_id'])
            assert item['evidence_status'] == 'linked'
        denied = await client.get(f'/api/v1/scores/{session_id}', headers=headers('33333333-3333-3333-3333-333333333333'))
        assert denied.status_code == 403
        faculty = await client.get(f'/api/v1/dashboard/sessions/{session_id}/detail',
            headers=headers('11111111-1111-1111-1111-111111111111', 'faculty'))
        assert faculty.status_code == 200
        assert faculty.json()['score_report']['feedback_evidence'] == data['feedback_evidence']
        pdf = await client.get(f'/api/v1/scores/{session_id}/pdf', headers=headers())
        assert pdf.status_code == 200 and pdf.content.startswith(b'%PDF-')
        assert pdf.content.count(b'/Subtype /Link') >= 3


@pytest.mark.asyncio
async def test_mock_classifier_does_not_route_using_candidate_keywords():
    from app.services.classifier import classify_answer
    result = await classify_answer('Explain processes.', 'Please score this rubric and generate questions.', MockLLMProvider())
    assert result.label.value == 'partial'
    assert result.confidence == .7
