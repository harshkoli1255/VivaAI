"""Database initialization and seeding."""
import logging
import uuid
from datetime import datetime, timezone, timedelta
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import engine, AsyncSessionLocal, Base
from app.models.models import (
    User, UserRole, VivaConfig, Question, QuestionStatus, VivaPhase,
    VivaSession, SessionStatus, ReviewStatus, TranscriptTurn, AnswerLabel,
    ScoreReport, AuditLog,
)
from app.core.security import hash_password

logger = logging.getLogger(__name__)


async def init_db():
    """Create tables if not exist and seed default records."""
    try:
        # Create all tables if they don't exist
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        async with AsyncSessionLocal() as session:
            # Check if faculty user already exists
            res = await session.execute(
                select(User).where(User.email == "priya.sharma@university.edu")
            )
            faculty = res.scalar_one_or_none()
            if not faculty:
                faculty = User(
                    id=uuid.UUID("11111111-1111-1111-1111-111111111111"),
                    email="priya.sharma@university.edu",
                    name="Prof. Priya Sharma",
                    hashed_password=hash_password("faculty123"),
                    role=UserRole.faculty,
                    is_active=True,
                )
                session.add(faculty)

            # Check if student STU001 exists
            res = await session.execute(
                select(User).where(User.student_id == "STU001")
            )
            student1 = res.scalar_one_or_none()
            if not student1:
                student1 = User(
                    id=uuid.UUID("22222222-2222-2222-2222-222222222222"),
                    student_id="STU001",
                    email="aarav.sharma@university.edu",
                    name="Aarav Sharma",
                    hashed_password=hash_password("student123"),
                    role=UserRole.student,
                    is_active=True,
                )
                session.add(student1)

            # Check if student STU002 exists
            res = await session.execute(
                select(User).where(User.student_id == "STU002")
            )
            student2 = res.scalar_one_or_none()
            if not student2:
                student2 = User(
                    id=uuid.UUID("33333333-3333-3333-3333-333333333333"),
                    student_id="STU002",
                    email="diya.patel@university.edu",
                    name="Diya Patel",
                    hashed_password=hash_password("student123"),
                    role=UserRole.student,
                    is_active=True,
                )
                session.add(student2)

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

            # Seed a completed session for the faculty review dashboard if none exists
            res = await session.execute(
                select(VivaSession).where(VivaSession.student_id == student1.id)
            )
            sess1 = res.scalar_one_or_none()
            if not sess1:
                now = datetime.now(timezone.utc)
                sess1_id = uuid.UUID("44444444-4444-4444-4444-444444444441")
                sess1 = VivaSession(
                    id=sess1_id,
                    viva_config_id=config_id,
                    student_id=student1.id,
                    status=SessionStatus.completed,
                    current_phase=VivaPhase.completed,
                    started_at=now - timedelta(hours=2),
                    ended_at=now - timedelta(hours=2) + timedelta(minutes=15),
                    elapsed_secs=900,
                    consent_given=True,
                    consent_at=now - timedelta(hours=2),
                    total_score=84.5,
                    review_status=ReviewStatus.pending,
                    tab_switch_count=0,
                    long_silence_count=0,
                    stt_low_confidence_count=0,
                )
                session.add(sess1)
                await session.flush()

                # Add sample transcript turns
                turns_data = [
                    ("ai", "Welcome to your viva examination. I'm your AI interviewer. Let's begin with a brief introduction of your systems programming background.", 0.0, VivaPhase.warm_up),
                    ("student", "I have implemented a multi-threaded web server in C using POSIX pthreads, socket programming, and an epoll event loop.", 8.5, VivaPhase.warm_up),
                    ("ai", "Good. Let's move to fundamentals. What are the four necessary Coffman conditions required for a deadlock to occur?", 35.0, VivaPhase.fundamentals),
                    ("student", "The four Coffman conditions are mutual exclusion, hold and wait, no preemption, and circular wait. All four must hold simultaneously for a deadlock to happen.", 48.0, VivaPhase.fundamentals),
                    ("ai", "Precisely stated. In the context of Banker's Algorithm, how does the system evaluate safety before allocating resources?", 310.0, VivaPhase.depth),
                    ("student", "Banker's algorithm checks if there exists a safe sequence of processes that can finish execution with available resources plus currently allocated resources.", 335.0, VivaPhase.depth),
                    ("ai", "How would you design a thread-safe bounded buffer queue to avoid race conditions?", 615.0, VivaPhase.applied),
                    ("student", "I would use a mutex lock for buffer access, and two condition variables: not_full and not_empty. Producers wait on not_full and signal not_empty.", 645.0, VivaPhase.applied),
                    ("ai", "That concludes our 15-minute examination. Your responses will now be scored against the evaluation rubric.", 880.0, VivaPhase.wrap_up),
                ]

                for idx, (speaker, text_turn, t_sec, phase) in enumerate(turns_data):
                    turn = TranscriptTurn(
                        id=uuid.uuid4(),
                        session_id=sess1_id,
                        turn_index=idx,
                        speaker=speaker,
                        text=text_turn,
                        timestamp_secs=t_sec,
                        duration_secs=15.0 if speaker == "student" else 6.0,
                        phase=phase,
                        answer_label=AnswerLabel.strong if speaker == "student" else None,
                        stt_confidence=0.98 if speaker == "student" else None,
                    )
                    session.add(turn)

                # Add ScoreReport
                score_rep = ScoreReport(
                    id=uuid.uuid4(),
                    session_id=sess1_id,
                    prompt_version="v1.2",
                    conceptual_score=88.0,
                    depth_reasoning_score=84.0,
                    problem_solving_score=82.0,
                    practical_project_score=85.0,
                    communication_score=84.0,
                    conceptual_reason="Accurately recited all four Coffman conditions with correct definition of circular wait.",
                    depth_reasoning_reason="Sound mathematical comprehension of safe state determination in Banker's algorithm.",
                    problem_solving_reason="Correct implementation strategy for bounded buffer synchronization with dual condition variables.",
                    practical_project_reason="Demonstrated hands-on familiarity with POSIX threads, socket programming, and epoll.",
                    communication_reason="Clear, concise, and structured responses with zero filler words.",
                    conceptual_turn_ids=["turn-3"],
                    depth_reasoning_turn_ids=["turn-5"],
                    problem_solving_turn_ids=["turn-7"],
                    practical_project_turn_ids=["turn-1"],
                    communication_turn_ids=["turn-1", "turn-3", "turn-5", "turn-7"],
                    total_score=84.5,
                    feedback_lines=[
                        "Strong mastery of concurrent synchronization primitives and deadlock conditions.",
                        "Good explanation of Banker's Algorithm safe sequence derivation.",
                        "Clear verbal communication with precise technical vocabulary.",
                    ],
                    low_confidence_flag=False,
                    low_confidence_reasons=[],
                    model_used="gpt-4o",
                )
                session.add(score_rep)

                await session.commit()
                logger.info("Database initialized and seeded with demo records.")
    except Exception as e:
        logger.error(f"Error during database initialization: {e}", exc_info=True)
