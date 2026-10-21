"""Version publication must preserve running, resumed, and not-yet-scored interviews."""
import uuid
from copy import deepcopy

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select
from app.main import app
from app.core.security import create_access_token
from app.db.session import AsyncSessionLocal
from app.models.models import VivaSession, VivaConfig, Question, TranscriptTurn, SessionStatus

STUDENT = '22222222-2222-2222-2222-222222222222'
FACULTY = '11111111-1111-1111-1111-111111111111'


def auth(role='faculty'):
    return {'Authorization': 'Bearer ' + create_access_token({'sub': FACULTY if role == 'faculty' else STUDENT, 'role': role})}


def payload():
    return {'title': 'Concurrency viva', 'subject': 'Operating Systems', 'course_code': 'CS302',
        'topics': ['Locks'], 'difficulty': 'medium', 'total_duration_secs': 900,
        'questions': [{'text': 'Explain a mutex.', 'phase': 'fundamentals', 'topic': 'Locks',
        'difficulty': 'medium', 'status': 'approved', 'expected_keywords': ['mutex'], 'follow_up_hints': ['fairness']}]}


@pytest.mark.asyncio
async def test_publish_version_preserves_existing_interview_and_evidence():
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        created = await client.post('/api/v1/viva-configs', json=payload(), headers=auth())
        assert created.status_code == 200, created.text
        original_id = created.json()['id']
        original = (await client.get(f'/api/v1/viva-configs/{original_id}', headers=auth())).json()
        old_question = original['questions'][0]
        student_session = (await client.post('/api/v1/sessions', json={'viva_config_id': original_id, 'consent_given': True}, headers=auth('student'))).json()
        session_id = uuid.UUID(student_session['id'])
        async with AsyncSessionLocal() as db:
            session = await db.get(VivaSession, session_id)
            session.status = SessionStatus.in_progress
            db.add(TranscriptTurn(session_id=session_id, turn_index=0, speaker='ai', text=old_question['text'], timestamp_secs=10, question_id=uuid.UUID(old_question['id'])))
            await db.commit()
        changes = payload()
        changes.update(title='Revised concurrency viva', expected_updated_at=original['updated_at'], rubric_weights={
            'conceptual':20, 'depth_reasoning':30, 'problem_solving':25, 'practical_project':15, 'communication':10})
        changes['questions'][0]['text'] = 'Explain semaphore fairness.'
        published = await client.post(f'/api/v1/viva-configs/{original_id}/versions', json=changes, headers=auth())
        assert published.status_code == 200, published.text
        latest = published.json()
        assert latest['revision'] == 2 and latest['previous_version_id'] == original_id
        preserved = (await client.get(f'/api/v1/viva-configs/{original_id}', headers=auth())).json()
        assert preserved['questions'][0] == old_question
        assert preserved['title'] == original['title']
        assert preserved['rubric_weights'] == original['rubric_weights']
        assert preserved['phase_timings'] == original['phase_timings']
        assert not preserved['is_active'] and preserved['superseded_by_id'] == latest['id']
        assert (await client.post('/api/v1/sessions', json={'viva_config_id': original_id}, headers=auth('student'))).status_code == 409
        next_session = await client.post('/api/v1/sessions', json={'viva_config_id': latest['id'], 'consent_given': True}, headers=auth('student'))
        assert next_session.status_code == 200
        detail = (await client.get(f'/api/v1/sessions/{session_id}', headers=auth('student'))).json()
        assert detail['viva_config_id'] == original_id
        assert detail['viva_config']['title'] == original['title']
        async with AsyncSessionLocal() as db:
            assert (await db.get(VivaSession, session_id)).viva_config_id == uuid.UUID(original_id)
            assert await db.get(Question, uuid.UUID(old_question['id']))
            assert await db.scalar(select(TranscriptTurn).where(TranscriptTurn.session_id == session_id, TranscriptTurn.question_id == uuid.UUID(old_question['id'])))
        # Old bank mutation endpoints cannot bypass the versioned editor.
        for method, path, body in [('PATCH', f"/api/v1/questions/{old_question['id']}", {'text':'Changed'}),
                                  ('PATCH', f"/api/v1/questions/{old_question['id']}/review", {'status':'rejected'}),
                                  ('DELETE', f"/api/v1/questions/{old_question['id']}", None)]:
            response = await client.request(method, path, json=body, headers=auth())
            assert response.status_code == 409
        assert (await client.post(f'/api/v1/viva-configs/{original_id}/versions', json=changes, headers=auth())).status_code == 409


@pytest.mark.asyncio
async def test_pause_enrollment_and_stale_editor_conflicts():
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        created = (await client.post('/api/v1/viva-configs', json=payload(), headers=auth())).json()
        id = created['id']
        original = (await client.get(f'/api/v1/viva-configs/{id}', headers=auth())).json()
        scheduled = (await client.post('/api/v1/sessions', json={'viva_config_id': id}, headers=auth('student'))).json()
        paused = await client.patch(f'/api/v1/viva-configs/{id}/enrollment', json={'is_active':False,'expected_updated_at':original['updated_at']}, headers=auth())
        assert paused.status_code == 200
        assert (await client.get(f"/api/v1/sessions/{scheduled['id']}", headers=auth('student'))).status_code == 200
        visible = (await client.get('/api/v1/viva-configs', headers=auth('student'))).json()
        assert id not in [item['id'] for item in visible]
        assert (await client.post('/api/v1/sessions', json={'viva_config_id': id}, headers=auth('student'))).status_code == 409
        changes = {**payload(), 'expected_updated_at': original['updated_at']}
        assert (await client.post(f'/api/v1/viva-configs/{id}/versions', json=changes, headers=auth())).status_code == 409
        reopened = await client.patch(f'/api/v1/viva-configs/{id}/enrollment', json={'is_active':True,'expected_updated_at':paused.json()['updated_at']}, headers=auth())
        assert reopened.status_code == 200
        assert (await client.get('/api/v1/viva-configs/manage', headers=auth('student'))).status_code == 403
        assert (await client.post(f'/api/v1/viva-configs/{id}/versions', json=changes, headers=auth('student'))).status_code == 403
        assert any(row['id'] == id for row in (await client.get('/api/v1/viva-configs/manage', headers=auth())).json())


@pytest.mark.asyncio
async def test_invalid_publication_is_atomic_and_bank_is_private():
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        created = (await client.post('/api/v1/viva-configs', json=payload(), headers=auth())).json()
        id = created['id']
        original = (await client.get(f'/api/v1/viva-configs/{id}', headers=auth())).json()
        for mutation in [{'questions': []}, {'questions': [{'text':'','phase':'fundamentals'}]}, {'rubric_weights':{'conceptual':99}}]:
            changes = {**deepcopy(payload()), 'expected_updated_at': original['updated_at'], **mutation}
            response = await client.post(f'/api/v1/viva-configs/{id}/versions', json=changes, headers=auth())
            assert response.status_code == 422, response.text
        latest = (await client.get(f'/api/v1/viva-configs/{id}', headers=auth())).json()
        assert latest['is_active'] and latest['updated_at'] == original['updated_at']
        assert latest['superseded_by_id'] is None
        assert (await client.get(f'/api/v1/viva-configs/{id}', headers=auth('student'))).status_code == 403
        visible = (await client.get('/api/v1/viva-configs', headers=auth('student'))).json()
        assert all('questions' not in item for item in visible)
        # Per-viva review and CSV filters agree, including zero rows.
        sessions = (await client.get('/api/v1/dashboard/sessions', params={'config_id':id}, headers=auth())).json()
        assert sessions['total'] == 0
        csv = await client.get('/api/v1/dashboard/export/csv', params={'config_id':id}, headers=auth())
        assert len(csv.text.splitlines()) == 1


@pytest.mark.asyncio
async def test_two_editors_cannot_silently_overwrite_each_other():
    import asyncio
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        created = (await client.post('/api/v1/viva-configs', json=payload(), headers=auth())).json()
        source = (await client.get(f"/api/v1/viva-configs/{created['id']}", headers=auth())).json()
        changes = {**payload(), 'expected_updated_at':source['updated_at']}
        results = await asyncio.gather(*[client.post(f"/api/v1/viva-configs/{created['id']}/versions", json={**changes,'title':f'Editor {i}'}, headers=auth()) for i in range(2)])
        assert sorted(response.status_code for response in results) == [200,409]
        winner = next(response.json() for response in results if response.status_code == 200)
        current = (await client.get(f"/api/v1/viva-configs/{created['id']}", headers=auth())).json()
        assert current['superseded_by_id'] == winner['id']
