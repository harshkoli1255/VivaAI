"""Pytest test fixtures and test database isolation."""
import os
import tempfile
import uuid

# Configure isolation before importing application modules or creating an engine.
_test_files = tempfile.TemporaryDirectory(prefix="vivaai-tests-")
os.environ["APP_ENV"] = "test"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_test_files.name}/test.db"
os.environ["AUDIO_LOCAL_DIR"] = f"{_test_files.name}/audio"
os.environ["MOCK_MODE"] = "true"
os.environ["LLM_PROVIDER"] = "mock"

from datetime import datetime, timezone, timedelta
import pytest
import pytest_asyncio
from sqlalchemy import select, delete

from app.db.init_db import init_db
from app.db.session import AsyncSessionLocal
from app.models.models import (
    VivaSession, SessionStatus, ReviewStatus, ScoreReport,
    TranscriptTurn, AuditLog, AudioChunk, ScoringJob, AuthRateLimit
)

TEST_SESSION_ID = uuid.UUID("44444444-4444-4444-4444-444444444441")
STUDENT1_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")
CONFIG_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")


@pytest_asyncio.fixture(autouse=True)
async def setup_test_data():
    """Ensure schema and base config exist, and provision test fixture session for integration tests."""
    await init_db()
    async with AsyncSessionLocal() as cleanup:
        await cleanup.execute(delete(AuthRateLimit))
        await cleanup.execute(delete(ScoringJob))
        await cleanup.commit()

    async with AsyncSessionLocal() as session:
        # Check if test session exists
        res = await session.execute(
            select(VivaSession).where(VivaSession.id == TEST_SESSION_ID)
        )
        existing = res.scalar_one_or_none()
        if not existing:
            now = datetime.now(timezone.utc)
            test_session = VivaSession(
                id=TEST_SESSION_ID,
                student_id=STUDENT1_ID,
                viva_config_id=CONFIG_ID,
                status=SessionStatus.completed,
                review_status=ReviewStatus.pending,
                started_at=now - timedelta(minutes=15),
                ended_at=now,
                elapsed_secs=900,
                total_score=84.5,
                tab_switch_count=0,
                long_silence_count=0,
                consent_given=True,
                consent_at=now - timedelta(minutes=16),
            )
            session.add(test_session)

            report = ScoreReport(
                id=uuid.UUID("55555555-5555-5555-5555-555555555551"),
                session_id=TEST_SESSION_ID,
                prompt_version="1.0",
                conceptual_score=4.5,
                depth_reasoning_score=4.0,
                problem_solving_score=4.0,
                practical_project_score=4.5,
                communication_score=4.5,
                conceptual_reason="Accurate definitions",
                depth_reasoning_reason="Solid architectural depth",
                problem_solving_reason="Good edge case handling",
                practical_project_reason="Practical understanding",
                communication_reason="Clear explanations",
                conceptual_turn_ids=[],
                depth_reasoning_turn_ids=[],
                problem_solving_turn_ids=[],
                practical_project_turn_ids=[],
                communication_turn_ids=[],
                total_score=84.5,
                feedback_lines=[
                    "Strong grasp of concurrency fundamentals.",
                    "Review NUMA memory hierarchies and lockless queues.",
                ],
                low_confidence_flag=False,
                low_confidence_reasons=[],
                model_used="mock",
            )
            session.add(report)

            turn = TranscriptTurn(
                id=uuid.UUID("66666666-6666-6666-6666-666666666661"),
                session_id=TEST_SESSION_ID,
                turn_index=0,
                speaker="interviewer",
                text="Welcome to your viva examination.",
                timestamp_secs=2.0,
                phase="warm_up",
            )
            session.add(turn)
            await session.commit()

    yield

    # Clean up test session after test run
    async with AsyncSessionLocal() as session:
        await session.execute(delete(AudioChunk).where(AudioChunk.session_id == TEST_SESSION_ID))
        await session.execute(delete(ScoringJob).where(ScoringJob.session_id == TEST_SESSION_ID))
        await session.execute(delete(TranscriptTurn).where(TranscriptTurn.session_id == TEST_SESSION_ID))
        await session.execute(delete(ScoreReport).where(ScoreReport.session_id == TEST_SESSION_ID))
        await session.execute(delete(AuditLog).where(AuditLog.session_id == TEST_SESSION_ID))
        await session.execute(delete(VivaSession).where(VivaSession.id == TEST_SESSION_ID))
        await session.commit()
