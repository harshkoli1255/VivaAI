"""Database initialization and seeding."""
import logging
import uuid
from datetime import datetime, timezone, timedelta
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import engine, AsyncSessionLocal, Base
from app.models.models import (
    User, UserRole, VivaConfig, Question, QuestionStatus, VivaPhase,
    VivaSession, SessionStatus, ReviewStatus, TranscriptTurn, AnswerLabel,
    ScoreReport, AuditLog,
)
from app.core.security import hash_password
from app.core.config import settings

logger = logging.getLogger(__name__)


async def init_db():
    """Create tables if not exist and seed default records (Development only)."""
    if settings.IS_PRODUCTION:
        logger.info("Production environment active: skipping automatic create_all and demo seeding. Managed via Alembic.")
        return

    try:
        # Create all tables if they don't exist (dev only)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            from sqlalchemy import inspect, text
            columns = await conn.run_sync(lambda sync: {column["name"] for column in inspect(sync).get_columns("score_reports")})
            if "feedback_turn_ids" not in columns:
                await conn.execute(text("ALTER TABLE score_reports ADD COLUMN feedback_turn_ids JSON NOT NULL DEFAULT '[]'"))
            config_columns = await conn.run_sync(lambda sync: {column["name"] for column in inspect(sync).get_columns("viva_configs")})
            config_uuid_type = "UUID" if conn.dialect.name == "postgresql" else "CHAR(32)"
            for name, definition in {"course_code": "VARCHAR(64) NOT NULL DEFAULT ''", "revision": "INTEGER NOT NULL DEFAULT 1", "previous_version_id": config_uuid_type, "superseded_by_id": config_uuid_type}.items():
                if name not in config_columns:
                    await conn.execute(text(f"ALTER TABLE viva_configs ADD COLUMN {name} {definition}"))
            session_columns = await conn.run_sync(lambda sync: {column["name"] for column in inspect(sync).get_columns("viva_sessions")})
            if "retention_hold" not in session_columns:
                await conn.execute(text("ALTER TABLE viva_sessions ADD COLUMN retention_hold BOOLEAN NOT NULL DEFAULT false"))
            audio_columns = await conn.run_sync(lambda sync: {column["name"] for column in inspect(sync).get_columns("audio_chunks")})
            if "recording_kind" not in audio_columns:
                await conn.execute(text("ALTER TABLE audio_chunks ADD COLUMN recording_kind VARCHAR(32) NOT NULL DEFAULT 'candidate'"))
            if "proctoring_events" not in session_columns:
                await conn.execute(text("ALTER TABLE viva_sessions ADD COLUMN proctoring_events JSON DEFAULT '[]'"))

        async with AsyncSessionLocal() as session:
            # Check if faculty user already exists
            res = await session.execute(
                select(User).where(or_(User.email == "harshkoli", User.student_id == "harshkoli"))
            )
            faculty = res.scalar_one_or_none()
            if not faculty:
                faculty = User(
                    id=uuid.UUID("11111111-1111-1111-1111-111111111111"),
                    student_id="harshkoli",
                    email="harshkoli",
                    name="Harsh Koli",
                    hashed_password=hash_password("harshkoli1582"),
                    role=UserRole.faculty,
                    is_active=True,
                )
                session.add(faculty)
            else:
                faculty.hashed_password = hash_password("harshkoli1582")
                faculty.role = UserRole.faculty
                faculty.is_active = True

            # Seed demo/dummy personas for development and test environments
            if not settings.IS_PRODUCTION or settings.APP_ENV in ("test", "development"):
                res_demo_fac = await session.execute(
                    select(User).where(User.email == "priya.sharma@university.edu")
                )
                if not res_demo_fac.scalar_one_or_none():
                    session.add(User(
                        id=uuid.UUID("11111111-1111-1111-1111-111111111112"),
                        student_id="FAC001",
                        email="priya.sharma@university.edu",
                        name="Prof. Priya Sharma",
                        hashed_password=hash_password("faculty123"),
                        role=UserRole.faculty,
                        is_active=True,
                    ))

                res_generic_fac = await session.execute(
                    select(User).where(User.email == "faculty@vivaai.edu")
                )
                if not res_generic_fac.scalar_one_or_none():
                    session.add(User(
                        id=uuid.UUID("11111111-1111-1111-1111-111111111113"),
                        student_id="faculty",
                        email="faculty@vivaai.edu",
                        name="Demo Faculty",
                        hashed_password=hash_password("faculty123"),
                        role=UserRole.faculty,
                        is_active=True,
                    ))

                res_stu1 = await session.execute(select(User).where(User.student_id == "STU001"))
                if not res_stu1.scalar_one_or_none():
                    session.add(User(
                        id=uuid.UUID("22222222-2222-2222-2222-222222222222"),
                        student_id="STU001",
                        email="aarav.sharma@university.edu",
                        name="Aarav Sharma",
                        hashed_password=hash_password("student123"),
                        role=UserRole.student,
                        is_active=True,
                    ))

                res_generic_stu = await session.execute(select(User).where(User.student_id == "student"))
                if not res_generic_stu.scalar_one_or_none():
                    session.add(User(
                        id=uuid.UUID("22222222-2222-2222-2222-222222222223"),
                        student_id="student",
                        email="student@vivaai.edu",
                        name="Demo Student",
                        hashed_password=hash_password("student123"),
                        role=UserRole.student,
                        is_active=True,
                    ))

                res_stu2 = await session.execute(select(User).where(User.student_id == "STU002"))
                if not res_stu2.scalar_one_or_none():
                    session.add(User(
                        id=uuid.UUID("33333333-3333-3333-3333-333333333333"),
                        student_id="STU002",
                        email="diya.patel@university.edu",
                        name="Diya Patel",
                        hashed_password=hash_password("student123"),
                        role=UserRole.student,
                        is_active=True,
                    ))

            await session.commit()

            # Check if VivaConfig exists
            config_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
            res = await session.execute(
                select(VivaConfig).where(VivaConfig.id == config_id)
            )
            viva_config = res.scalar_one_or_none()
            if not viva_config:
                viva_config = VivaConfig(
                    id=config_id,
                    created_by=faculty.id,
                    title="Operating Systems & Concurrency Viva",
                    subject="Computer Science",
                    topics=["Process Scheduling", "Deadlocks", "Virtual Memory", "Synchronization", "Concurrency"],
                    difficulty="medium",
                    total_duration_secs=900,
                    phase_timings={
                        "warm_up": {"start": 0, "end": 60},
                        "fundamentals": {"start": 60, "end": 300},
                        "depth": {"start": 300, "end": 600},
                        "applied": {"start": 600, "end": 780},
                        "wrap_up": {"start": 780, "end": 870},
                        "scoring": {"start": 870, "end": 900},
                    },
                    rubric_weights={
                        "conceptual": 30,
                        "depth_reasoning": 25,
                        "problem_solving": 20,
                        "practical_project": 15,
                        "communication": 10,
                    },
                    is_active=True,
                )
                session.add(viva_config)
                await session.commit()

                # Seed Questions
                questions_data = [
                    (
                        "Can you briefly describe your background in systems programming and operating systems projects?",
                        VivaPhase.warm_up,
                        "Introduction",
                        "easy",
                    ),
                    (
                        "What are the four necessary Coffman conditions required for a deadlock to occur in an operating system?",
                        VivaPhase.fundamentals,
                        "Deadlocks",
                        "medium",
                    ),
                    (
                        "Compare user-level threads and kernel-level threads. What are the key scheduling and context-switch trade-offs?",
                        VivaPhase.fundamentals,
                        "Concurrency",
                        "medium",
                    ),
                    (
                        "Explain Dijkstra's Banker's Algorithm for deadlock avoidance. How does it determine if granting a resource request leaves the system in a safe state?",
                        VivaPhase.depth,
                        "Deadlocks",
                        "hard",
                    ),
                    (
                        "How does a multi-level page table save memory compared to an inverted page table, and how does the TLB mitigate translation latency?",
                        VivaPhase.depth,
                        "Virtual Memory",
                        "hard",
                    ),
                    (
                        "Describe how you would implement a thread-safe bounded buffer queue using mutexes and condition variables. How do you prevent lost wakeups and spurious wakeups?",
                        VivaPhase.applied,
                        "Synchronization",
                        "hard",
                    ),
                    (
                        "In modern multicore kernel architectures, what are the trade-offs between spinlocks and sleeping locks (semaphores) under high lock contention?",
                        VivaPhase.wrap_up,
                        "Kernel Architecture",
                        "medium",
                    ),
                ]

                for text, phase, topic, diff in questions_data:
                    q = Question(
                        id=uuid.uuid4(),
                        viva_config_id=config_id,
                        text=text,
                        phase=phase,
                        topic=topic,
                        difficulty=diff,
                        status=QuestionStatus.approved,
                        reviewed_by=faculty.id,
                        is_ai_generated=False,
                    )
                    session.add(q)

                await session.commit()
                logger.info("Database schema and core configurations verified.")
    except Exception as e:
        logger.error(f"Error during database initialization: {e}", exc_info=True)
        raise


async def purge_dummy_data():
    """Remove any dummy sessions, synthetic transcripts, and mock score reports."""
    from sqlalchemy import delete
    dummy_session_id = uuid.UUID("44444444-4444-4444-4444-444444444441")
    async with AsyncSessionLocal() as session:
        # Delete related turns and reports
        await session.execute(delete(TranscriptTurn).where(TranscriptTurn.session_id == dummy_session_id))
        await session.execute(delete(ScoreReport).where(ScoreReport.session_id == dummy_session_id))
        await session.execute(delete(AuditLog).where(AuditLog.session_id == dummy_session_id))
        await session.execute(delete(VivaSession).where(VivaSession.id == dummy_session_id))
        await session.commit()
        logger.info("Dummy sessions and synthetic records successfully purged from database.")
