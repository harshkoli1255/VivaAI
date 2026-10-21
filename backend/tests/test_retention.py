"""Policy gating, review/appeal holds, pending work and isolated purge semantics."""
import uuid
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.core.config import settings
from app.core.security import create_access_token
from app.db.session import AsyncSessionLocal
from app.models.models import VivaSession, SessionStatus, ReviewStatus, TranscriptTurn, AuditLog, ScoringJob
from app.services import retention

STUDENT = '22222222-2222-2222-2222-222222222222'
FACULTY = '11111111-1111-1111-1111-111111111111'
CONFIG = '00000000-0000-0000-0000-000000000001'


def policy(monkeypatch):
    monkeypatch.setattr(settings, 'RETENTION_DAYS', 30)
    monkeypatch.setattr(settings, 'RETENTION_POLICY_ID', 'isolated-test-only')


async def record(**overrides):
    values = dict(id=uuid.uuid4(), student_id=uuid.UUID(STUDENT), viva_config_id=uuid.UUID(CONFIG),
                  consent_given=True, status=SessionStatus.completed, review_status=ReviewStatus.reviewed,
                  ended_at=datetime.now(timezone.utc) - timedelta(days=40))
    values.update(overrides)
    async with AsyncSessionLocal() as db:
        row = VivaSession(**values); db.add(row); await db.commit(); return row.id


def test_retention_is_disabled_without_both_approved_settings(monkeypatch):
    monkeypatch.setattr(settings, 'RETENTION_DAYS', 0)
    monkeypatch.setattr(settings, 'RETENTION_POLICY_ID', '')
    with pytest.raises(ValueError, match='disabled'): retention.approved_cutoff()
    monkeypatch.setattr(settings, 'RETENTION_DAYS', 30)
    with pytest.raises(ValueError, match='disabled'): retention.approved_cutoff()


@pytest.mark.asyncio
async def test_plan_excludes_holds_unreviewed_recent_active_and_queued_records(monkeypatch):
    policy(monkeypatch)
    eligible = await record()
    excluded = [await record(retention_hold=True), await record(review_status=ReviewStatus.pending),
                await record(ended_at=datetime.now(timezone.utc)), await record(status=SessionStatus.in_progress)]
    queued = await record(); excluded.append(queued)
    async with AsyncSessionLocal() as db:
        db.add(ScoringJob(session_id=queued, status='queued')); await db.commit()
        result = await retention.plan(db)
    assert str(eligible) in result['eligible_session_ids']
    assert not set(map(str, excluded)) & set(result['eligible_session_ids'])


@pytest.mark.asyncio
async def test_purge_rechecks_hold_and_fails_closed_on_audio_deletion_error(monkeypatch):
    policy(monkeypatch)
    held = await record(retention_hold=True)
    failing = await record()
    delete_audio = AsyncMock(side_effect=RuntimeError('Object store unavailable'))
    async with AsyncSessionLocal() as db:
        assert not await retention.purge_one(db, held, delete_audio)
        delete_audio.assert_not_awaited()
        with pytest.raises(RuntimeError): await retention.purge_one(db, failing, delete_audio)
        await db.rollback()
        assert await db.get(VivaSession, failing) is not None


@pytest.mark.asyncio
async def test_purge_removes_session_children_only_from_isolated_test_database(monkeypatch):
    policy(monkeypatch)
    identity = await record()
    async with AsyncSessionLocal() as db:
        db.add(TranscriptTurn(session_id=identity, turn_index=0, speaker='student', text='Synthetic test only', timestamp_secs=1))
        db.add(AuditLog(session_id=identity, actor_id=uuid.UUID(FACULTY), action='test', detail={}))
        await db.commit()
        delete_audio = AsyncMock()
        assert await retention.purge_one(db, identity, delete_audio)
        assert await db.get(VivaSession, identity) is None
        delete_audio.assert_awaited_once()


@pytest.mark.asyncio
async def test_only_faculty_can_change_hold_and_reason_is_audited():
    identity = await record()
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        path = f'/api/v1/sessions/{identity}/retention-hold'
        def auth(principal, role): return {'Authorization': 'Bearer ' + create_access_token({'sub': principal, 'role': role})}
        body = {'hold': True, 'reason': 'Synthetic appeal review in isolated test'}
        assert (await client.post(path, json=body, headers=auth(STUDENT, 'student'))).status_code == 403
        assert (await client.post(path, json={'hold': True, 'reason': '     '}, headers=auth(FACULTY, 'faculty'))).status_code == 422
        response = await client.post(path, json=body, headers=auth(FACULTY, 'faculty'))
        assert response.status_code == 200 and response.json()['retention_hold']
    async with AsyncSessionLocal() as db:
        from sqlalchemy import select
        audit = await db.scalar(select(AuditLog).where(AuditLog.session_id == identity, AuditLog.action == 'retention_hold_changed'))
        assert audit.detail['reason'] == body['reason']
        assert audit.actor_id == uuid.UUID(FACULTY)
