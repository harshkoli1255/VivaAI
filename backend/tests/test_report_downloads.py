"""Downloads must work for faculty-only marks and never invent an AI assessment."""
import uuid
from functools import partial

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, func

from app.main import app
from app.core.security import create_access_token
from app.db.session import AsyncSessionLocal
from app.models.models import VivaSession, SessionStatus, ReviewStatus, User
from app.services import pdf_report
from conftest import TEST_SESSION_ID, STUDENT1_ID, CONFIG_ID


def headers(role='faculty', subject='11111111-1111-1111-1111-111111111111'):
    return {'Authorization': 'Bearer ' + create_access_token({'sub': subject, 'role': role})}


@pytest.mark.asyncio
async def test_faculty_only_report_download_preserves_manual_mark(monkeypatch):
    session_id = uuid.uuid4()
    async with AsyncSessionLocal() as db:
        db.add(VivaSession(id=session_id, student_id=STUDENT1_ID, viva_config_id=CONFIG_ID,
            status=SessionStatus.flagged, review_status=ReviewStatus.overridden,
            override_score=88.8, override_reason='Faculty reviewed the recorded answer.',
            override_by=uuid.UUID('11111111-1111-1111-1111-111111111111')))
        await db.commit()
        reviewer = await db.get(User, uuid.UUID('11111111-1111-1111-1111-111111111111'))
        expected_reviewer = reviewer.name
    received = {}
    original = pdf_report.generate_session_pdf_report
    def capture(**kwargs):
        received.update(kwargs)
        return original(**kwargs)
    monkeypatch.setattr(pdf_report, 'generate_session_pdf_report', capture)
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        path = f'/api/v1/scores/{session_id}/pdf'
        for auth in (headers(), headers('student', str(STUDENT1_ID))):
            response = await client.get(path, headers=auth)
            assert response.status_code == 200
            assert response.content.startswith(b'%PDF-')
            assert 'attachment;' in response.headers['content-disposition']
            assert response.headers['cache-control'] == 'private, no-store'
        assert received['total_score'] is None
        assert received['override_score'] == 88.8
        assert received['rubric_entries'] == {}
        assert received['feedback_lines'] == []
        assert received['reviewer_name'] == expected_reviewer
        assert (await client.get(path, headers=headers('student', '33333333-3333-3333-3333-333333333333'))).status_code == 403
        assert (await client.get(path)).status_code == 401


@pytest.mark.parametrize('withheld,manual', [(False, True), (True, False)])
def test_report_labels_missing_or_withheld_ai_scores(monkeypatch, withheld, manual):
    # Uncompressed PDF text allows assertions without adding a PDF parser dependency.
    monkeypatch.setattr(pdf_report, 'SimpleDocTemplate', partial(pdf_report.SimpleDocTemplate, pageCompression=0))
    data = pdf_report.generate_session_pdf_report(
        session_id=str(uuid.uuid4()), student_name='Test Candidate', student_id='TEST',
        viva_title='Synthetic Viva', subject='Testing', started_at=None, ended_at=None,
        total_score=0 if withheld else None, override_score=88.8 if manual else None,
        override_reason='Faculty review completed.' if manual else None,
        review_status='overridden' if manual else 'pending', rubric_entries={},
        rubric_weights={}, feedback_lines=[], proctoring_events=[], score_withheld=withheld)
    assert b'ACCREDITED' not in data
    assert b'Proctoring Verified' not in data
    assert b'0.0 / 100' not in data
    assert b'Distinction' not in data  # Grade thresholds have not been approved.
    if manual:
        assert b'88.8 / 100' in data
        assert b'Unavailable' in data
        assert b'No AI rubric assessment' in data
    else:
        assert all(word in data for word in (b'Withheld', b'faculty', b'review', b'required'))


@pytest.mark.asyncio
@pytest.mark.parametrize('reason', ['     ', '   a   '])
async def test_override_rejects_blank_or_short_trimmed_reason(reason):
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        response = await client.post(f'/api/v1/sessions/{TEST_SESSION_ID}/override',
            json={'override_score': 88, 'reason': reason}, headers=headers())
        assert response.status_code == 422


@pytest.mark.asyncio
async def test_dashboard_average_uses_faculty_adjustments():
    async with AsyncSessionLocal() as db:
        session = await db.get(VivaSession, TEST_SESSION_ID)
        session.override_score = 92.5
        await db.commit()
        expected = await db.scalar(select(func.avg(func.coalesce(VivaSession.override_score, VivaSession.total_score))))
        scored = await db.scalar(select(func.count(func.coalesce(VivaSession.override_score, VivaSession.total_score))))
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        response = await client.get('/api/v1/dashboard/stats', headers=headers())
        assert response.json()['average_score'] == round(expected, 1)
        assert response.json()['scored_sessions'] == scored
