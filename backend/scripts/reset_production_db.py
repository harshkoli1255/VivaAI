"""Reset production database and seed faculty credentials."""
import asyncio
import uuid
from datetime import datetime, timezone
from sqlalchemy import text, select
from app.db.session import engine, AsyncSessionLocal
from app.models.models import (
    User, UserRole, VivaConfig, Question, QuestionStatus, VivaPhase,
)
from app.core.security import hash_password, verify_password

async def reset_production():
    print("=" * 60)
    print("VIVAAI PRODUCTION DATABASE PURGE & SETUP")
    print("=" * 60)

    async with engine.begin() as conn:
        print("1. Truncating all tables with CASCADE...")
        tables = [
            "audio_chunks",
            "audit_logs",
            "auth_rate_limits",
            "auth_sessions",
            "score_reports",
            "scoring_jobs",
            "transcript_turns",
            "viva_sessions",
            "questions",
            "viva_configs",
            "users",
        ]
        stmt = f"TRUNCATE TABLE {', '.join(tables)} CASCADE;"
        await conn.execute(text(stmt))
        print("   All tables truncated successfully.")

    async with AsyncSessionLocal() as session:
        print("\n2. Creating faculty and dummy users...")
        faculty_id = uuid.UUID("11111111-1111-1111-1111-111111111111")
        hashed = hash_password("harshkoli1582")
        faculty = User(
            id=faculty_id,
            student_id="harshkoli",
            email="harshkoli",
            name="Harsh Koli",
            hashed_password=hashed,
            role=UserRole.faculty,
            is_active=True,
            created_at=datetime.now(timezone.utc),
        )
        session.add(faculty)

        # Dummy Faculty: Prof. Priya Sharma & Demo Faculty
        demo_fac_1 = User(
            id=uuid.UUID("11111111-1111-1111-1111-111111111112"),
            student_id="FAC001",
            email="priya.sharma@university.edu",
            name="Prof. Priya Sharma",
            hashed_password=hash_password("faculty123"),
            role=UserRole.faculty,
            is_active=True,
            created_at=datetime.now(timezone.utc),
        )
        session.add(demo_fac_1)

        demo_fac_2 = User(
            id=uuid.UUID("11111111-1111-1111-1111-111111111113"),
            student_id="faculty",
            email="faculty@vivaai.edu",
            name="Demo Faculty",
            hashed_password=hash_password("faculty123"),
            role=UserRole.faculty,
            is_active=True,
            created_at=datetime.now(timezone.utc),
        )
        session.add(demo_fac_2)

        # Dummy Students: Aarav Sharma (STU001) & Demo Student
        demo_stu_1 = User(
            id=uuid.UUID("22222222-2222-2222-2222-222222222222"),
            student_id="STU001",
            email="aarav.sharma@university.edu",
            name="Aarav Sharma",
            hashed_password=hash_password("student123"),
            role=UserRole.student,
            is_active=True,
            created_at=datetime.now(timezone.utc),
        )
        session.add(demo_stu_1)

        demo_stu_2 = User(
            id=uuid.UUID("22222222-2222-2222-2222-222222222223"),
            student_id="student",
            email="student@vivaai.edu",
            name="Demo Student",
            hashed_password=hash_password("student123"),
            role=UserRole.student,
            is_active=True,
            created_at=datetime.now(timezone.utc),
        )
        session.add(demo_stu_2)

        await session.flush()
        print(f"   Faculty created: Harsh Koli ({faculty.email})")
        print(f"   Dummy Faculty created: Prof. Priya Sharma (priya.sharma@university.edu) & Demo Faculty (faculty@vivaai.edu)")
        print(f"   Dummy Students created: Aarav Sharma (STU001) & Demo Student (student / student@vivaai.edu)")

        print("\n3. Creating production VivaConfig...")
        config_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        config = VivaConfig(
            id=config_id,
            created_by=faculty_id,
            title="Operating Systems & Systems Architecture Viva",
            subject="Computer Science & Engineering",
            topics=[
                "Process Scheduling & Concurrency",
                "Deadlocks & Synchronization",
                "Virtual Memory & Paging",
                "Distributed Systems & Scalability",
                "System Design & Algorithms",
            ],
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
        session.add(config)
        await session.flush()
        print(f"   VivaConfig created: ID={config.id}, Title='{config.title}'")

        print("\n4. Seeding production question bank...")
        questions_data = [
            (
                "Can you briefly describe your background in software engineering, systems programming, or key technical projects you have built?",
                VivaPhase.warm_up,
                "Introduction & Background",
                "easy",
            ),
            (
                "What are the four necessary Coffman conditions required for a deadlock to occur, and how does deadlock avoidance differ from deadlock detection?",
                VivaPhase.fundamentals,
                "Deadlocks",
                "medium",
            ),
            (
                "Compare user-level threads and kernel-level threads. What are the key scheduling and context-switch trade-offs?",
                VivaPhase.fundamentals,
                "Concurrency & Threading",
                "medium",
            ),
            (
                "Explain how virtual memory address translation works with multi-level page tables, and describe how a Translation Lookaside Buffer (TLB) minimizes latency.",
                VivaPhase.depth,
                "Virtual Memory & Architecture",
                "hard",
            ),
            (
                "In concurrent systems, what is the ABA problem in lock-free data structures, and how do generation counts or hazard pointers resolve it?",
                VivaPhase.depth,
                "Lock-Free Concurrency",
                "hard",
            ),
            (
                "Describe how you would implement a thread-safe bounded buffer queue using mutexes and condition variables. How do you prevent lost wakeups and spurious wakeups?",
                VivaPhase.applied,
                "Synchronization Primitives",
                "hard",
            ),
            (
                "In modern multicore kernel architectures, what are the trade-offs between spinlocks and sleeping locks (semaphores) under high lock contention?",
                VivaPhase.wrap_up,
                "Kernel Architecture & Scalability",
                "medium",
            ),
        ]

        for text_q, phase, topic, diff in questions_data:
            q = Question(
                id=uuid.uuid4(),
                viva_config_id=config_id,
                text=text_q,
                phase=phase,
                topic=topic,
                difficulty=diff,
                status=QuestionStatus.approved,
                reviewed_by=faculty_id,
                is_ai_generated=False,
            )
            session.add(q)

        await session.commit()
        print(f"   Seeded {len(questions_data)} approved questions.")

    print("\n5. Verifying database state...")
    async with engine.connect() as conn:
        for t in tables:
            cnt = await conn.execute(text(f'SELECT count(*) FROM "{t}"'))
            print(f"   {t}: {cnt.scalar()} rows")

    async with AsyncSessionLocal() as session:
        for ident, pwd, expected_role in [
            ("harshkoli", "harshkoli1582", "faculty"),
            ("priya.sharma@university.edu", "faculty123", "faculty"),
            ("faculty@vivaai.edu", "faculty123", "faculty"),
            ("STU001", "student123", "student"),
            ("student", "student123", "student"),
        ]:
            res = await session.execute(
                select(User).where((User.email == ident) | (User.student_id == ident))
            )
            u = res.scalar_one_or_none()
            assert u is not None, f"User {ident} not found!"
            assert verify_password(pwd, u.hashed_password), f"Password verification failed for {ident}!"
            assert u.role.value == expected_role, f"Role mismatch for {ident}!"
            print(f"   Verification passed: {u.name} (ident: {ident}), role: {u.role.value}")

    print("\nDATABASE PURGE & SETUP COMPLETE! Production ready.")

if __name__ == "__main__":
    asyncio.run(reset_production())
