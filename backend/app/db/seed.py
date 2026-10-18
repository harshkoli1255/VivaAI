"""
Seed script — populates DB with 5 demo vivas, question bank, faculty + student accounts.
Run once after `alembic upgrade head`.
Usage: python -m app.db.seed
"""
import asyncio
import uuid
from datetime import datetime, timezone, timedelta
import random

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import AsyncSessionLocal
from app.core.security import hash_password
from app.models.models import (
    User, UserRole, VivaConfig, Question, VivaPhase, QuestionStatus,
    VivaSession, SessionStatus, TranscriptTurn, ScoreReport, AuditLog,
    ReviewStatus, AnswerLabel,
)

# ── Demo accounts ─────────────────────────────────────────────
FACULTY = [
    {"name": "Dr. Priya Sharma", "email": "priya.sharma@university.edu", "role": "faculty"},
    {"name": "Prof. Rahul Gupta", "email": "rahul.gupta@university.edu", "role": "faculty"},
]

STUDENTS = [
    {"name": "Arjun Mehta", "student_id": "STU001", "email": "arjun@student.edu"},
    {"name": "Sneha Patel", "student_id": "STU002", "email": "sneha@student.edu"},
    {"name": "Vikram Singh", "student_id": "STU003", "email": "vikram@student.edu"},
    {"name": "Priya Nair", "student_id": "STU004", "email": "priya.n@student.edu"},
    {"name": "Rohan Das", "student_id": "STU005", "email": "rohan@student.edu"},
]

# ── Question bank ──────────────────────────────────────────────
QUESTIONS = [
    # Warm-up
    {"text": "Can you briefly introduce yourself and your background in computer science?",
     "phase": "warm_up", "difficulty": "easy", "topic": "introduction"},
    {"text": "What programming languages are you most comfortable with?",
     "phase": "warm_up", "difficulty": "easy", "topic": "introduction"},

    # Fundamentals
    {"text": "What is the difference between a process and a thread?",
     "phase": "fundamentals", "difficulty": "easy", "topic": "operating systems",
     "keywords": ["process", "thread", "memory", "context switch"]},
    {"text": "Explain the concept of polymorphism in OOP with an example.",
     "phase": "fundamentals", "difficulty": "medium", "topic": "object-oriented programming",
     "keywords": ["polymorphism", "inheritance", "method overriding"]},
    {"text": "What is a RESTful API? How does it differ from GraphQL?",
     "phase": "fundamentals", "difficulty": "medium", "topic": "web APIs",
     "keywords": ["REST", "HTTP", "stateless", "GraphQL", "query"]},
    {"text": "Can you explain the OSI model? Name and describe at least 4 layers.",
     "phase": "fundamentals", "difficulty": "medium", "topic": "networking",
     "keywords": ["OSI", "physical", "transport", "application", "network"]},
    {"text": "What is the difference between stack and heap memory?",
     "phase": "fundamentals", "difficulty": "easy", "topic": "memory management",
     "keywords": ["stack", "heap", "allocation", "lifecycle"]},

    # Depth
    {"text": "How does garbage collection work in modern runtimes like JVM or V8?",
     "phase": "depth", "difficulty": "hard", "topic": "memory management",
     "keywords": ["GC", "mark-and-sweep", "reference counting", "generational"]},
    {"text": "Explain the CAP theorem with a concrete distributed system example.",
     "phase": "depth", "difficulty": "hard", "topic": "distributed systems",
     "keywords": ["CAP", "consistency", "availability", "partition tolerance"]},
    {"text": "What are the trade-offs between SQL and NoSQL databases?",
     "phase": "depth", "difficulty": "medium", "topic": "databases",
     "keywords": ["ACID", "schema", "scalability", "join", "document"]},
    {"text": "How does async/await work under the hood in Python or JavaScript?",
     "phase": "depth", "difficulty": "hard", "topic": "concurrency",
     "keywords": ["event loop", "coroutine", "callback", "promise"]},

    # Applied
    {"text": "Design a URL shortener like bit.ly. Walk me through the system design.",
     "phase": "applied", "difficulty": "hard", "topic": "system design",
     "keywords": ["hash", "database", "cache", "redirect", "scalability"]},
    {"text": "How would you implement a rate limiter for a high-traffic REST API?",
     "phase": "applied", "difficulty": "hard", "topic": "system design",
     "keywords": ["token bucket", "sliding window", "Redis", "throttle"]},
    {"text": "Given a list of 1M records, how would you efficiently find duplicates?",
     "phase": "applied", "difficulty": "medium", "topic": "algorithms",
     "keywords": ["hash map", "sort", "O(n)", "space complexity"]},

    # Wrap-up
    {"text": "Is there anything from our discussion you'd like to revisit or clarify?",
     "phase": "wrap_up", "difficulty": "easy", "topic": "review"},
    {"text": "What aspect of computer science are you most excited to learn more about?",
     "phase": "wrap_up", "difficulty": "easy", "topic": "reflection"},
]


async def seed():
    async with AsyncSessionLocal() as db:
        # ── Faculty users ──────────────────────────────────────
        faculty_ids = []
        for f in FACULTY:
            user = User(
                id=uuid.uuid4(),
                name=f["name"],
                email=f["email"],
                hashed_password=hash_password("faculty123"),
                role=UserRole.faculty,
            )
            db.add(user)
            faculty_ids.append(user.id)

        # ── Student users ──────────────────────────────────────
        student_ids = []
        for s in STUDENTS:
            user = User(
                id=uuid.uuid4(),
                name=s["name"],
                student_id=s["student_id"],
                email=s["email"],
                hashed_password=hash_password("student123"),
                role=UserRole.student,
            )
            db.add(user)
            student_ids.append(user.id)

        await db.flush()

        # ── Viva config ────────────────────────────────────────
        config = VivaConfig(
            id=uuid.uuid4(),
            created_by=faculty_ids[0],
            title="Computer Science Fundamentals Viva",
            subject="Computer Science",
            topics=["Operating Systems", "OOP", "Networking", "Databases", "Algorithms", "Distributed Systems"],
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
                "conceptual": 30, "depth_reasoning": 25,
                "problem_solving": 20, "practical_project": 15, "communication": 10,
            },
        )
        db.add(config)
        await db.flush()

        # ── Questions ──────────────────────────────────────────
        q_ids = []
        for qd in QUESTIONS:
            q = Question(
                id=uuid.uuid4(),
                viva_config_id=config.id,
                text=qd["text"],
                phase=VivaPhase(qd["phase"]),
                topic=qd.get("topic", ""),
                difficulty=qd.get("difficulty", "medium"),
                expected_keywords=qd.get("keywords", []),
                status=QuestionStatus.approved,
            )
            db.add(q)
            q_ids.append(q.id)

        await db.flush()

        # ── 5 Demo sessions with full transcripts + scores ─────
        personas = [
            {"name": "strong", "label": AnswerLabel.strong, "scores": [4.5, 4.2, 4.0, 3.8, 4.3]},
            {"name": "average", "label": AnswerLabel.partial, "scores": [3.0, 2.8, 3.1, 2.5, 3.2]},
            {"name": "weak", "label": AnswerLabel.dont_know, "scores": [1.5, 1.8, 1.2, 2.0, 2.5]},
            {"name": "strong2", "label": AnswerLabel.strong, "scores": [4.8, 4.5, 4.3, 4.0, 4.6]},
            {"name": "average2", "label": AnswerLabel.partial, "scores": [2.8, 3.0, 2.5, 2.7, 3.0]},
        ]

        ai_questions = [
            "Can you tell me about yourself?",
            "What is the difference between a process and a thread?",
            "How does garbage collection work?",
            "Design a URL shortener. Walk me through the architecture.",
            "Is there anything you'd like to clarify?",
        ]
        student_answers = {
            "strong": [
                "I'm a final year CS student with strong experience in Python, Java, and distributed systems.",
                "A process has its own memory space while a thread shares memory within a process. Context switching is faster for threads but they require synchronization.",
                "Garbage collection in JVM uses generational GC. Young generation uses minor GC, old generation uses major GC. It identifies unreachable objects and reclaims their memory.",
                "I'd use a hash function to map URLs to short codes, store mappings in a DB with a cache layer. For high traffic I'd use Redis, consistent hashing for distribution, and a CDN.",
                "I think I covered everything well. Thank you for the thorough session.",
            ],
            "average": [
                "I'm a CS student. I know Python and some Java.",
                "Processes are programs running on the OS. Threads are smaller, they're part of a process I think.",
                "GC cleans up memory when objects are no longer used. It runs automatically.",
                "I'd use a database and generate a random short code for each URL.",
                "I would have liked more time on some questions.",
            ],
            "weak": [
                "I study computer science.",
                "I'm not sure about the exact difference.",
                "I don't know how GC works internally.",
                "I don't know how to design that.",
                "No, I think that's all.",
            ],
            "strong2": [
                "Final year student, strong in algorithms, system design, and distributed systems.",
                "Process is an independent execution unit with its own address space. Thread is a lightweight unit within a process sharing the same memory. Threads are cheaper to create but need synchronization primitives.",
                "Modern GC like G1 in JVM uses region-based GC with concurrent marking. Objects are promoted from young to old generation based on survival count.",
                "URL shortener: base-62 encoding for short codes, PostgreSQL for persistence, Redis for hot cache, Nginx for load balancing. Can handle millions of redirects per second.",
                "Everything was covered thoroughly. Great session!",
            ],
            "average2": [
                "I'm in third year CS. I know web development mainly.",
                "Processes run programs, threads are lighter and share some resources.",
                "GC removes objects that aren't needed anymore. It prevents memory leaks.",
                "I'd have a table mapping short URLs to long ones and use a random ID generator.",
                "I'd like to review distributed systems more.",
            ],
        }

        for i, (student_id, persona) in enumerate(zip(student_ids, personas)):
            persona_name = persona["name"]
            answers = student_answers[persona_name]

            start_t = datetime.now(timezone.utc) - timedelta(days=i+1)
            end_t = start_t + timedelta(minutes=15)

            session = VivaSession(
                id=uuid.uuid4(),
                viva_config_id=config.id,
                student_id=student_id,
                status=SessionStatus.completed,
                current_phase=VivaPhase.completed if i < 4 else VivaPhase.scoring,
                consent_given=True,
                consent_at=start_t,
                started_at=start_t,
                ended_at=end_t,
                elapsed_secs=900,
                tab_switch_count=random.randint(0, 2),
                long_silence_count=random.randint(0, 3),
                review_status=ReviewStatus.reviewed,
            )
            db.add(session)
            await db.flush()

            # Transcript turns
            phases = [VivaPhase.warm_up, VivaPhase.fundamentals, VivaPhase.depth,
                      VivaPhase.applied, VivaPhase.wrap_up]
            t_idx = 0
            for j, (ai_q, stu_a, phase) in enumerate(zip(ai_questions, answers, phases)):
                # AI turn
                db.add(TranscriptTurn(
                    id=uuid.uuid4(), session_id=session.id, turn_index=t_idx,
                    speaker="ai", text=ai_q, timestamp_secs=j * 150.0,
                    phase=phase,
                ))
                t_idx += 1
                # Student turn
                label = persona["label"] if j > 0 else None
                db.add(TranscriptTurn(
                    id=uuid.uuid4(), session_id=session.id, turn_index=t_idx,
                    speaker="student", text=stu_a, timestamp_secs=j * 150.0 + 5,
                    duration_secs=random.uniform(15, 60),
                    phase=phase, answer_label=label,
                    stt_confidence=random.uniform(0.8, 0.99),
                ))
                t_idx += 1

            await db.flush()

            # Score
            scores = persona["scores"]
            weights = {"conceptual": 30, "depth_reasoning": 25,
                       "problem_solving": 20, "practical_project": 15, "communication": 10}
            dims = ["conceptual", "depth_reasoning", "problem_solving", "practical_project", "communication"]
            total = sum((s / 5.0) * w for s, w in zip(scores, weights.values()))

            report = ScoreReport(
                id=uuid.uuid4(), session_id=session.id, prompt_version="v1",
                conceptual_score=scores[0],
                depth_reasoning_score=scores[1],
                problem_solving_score=scores[2],
                practical_project_score=scores[3],
                communication_score=scores[4],
                conceptual_reason="Demonstrated strong conceptual understanding." if scores[0] > 3.5 else "Basic concepts understood.",
                depth_reasoning_reason="Excellent reasoning depth." if scores[1] > 3.5 else "Shallow reasoning.",
                problem_solving_reason="Systematic approach to problems." if scores[2] > 3.5 else "Limited problem solving.",
                practical_project_reason="Good practical examples." if scores[3] > 3.5 else "Minimal practical knowledge.",
                communication_reason="Clear and articulate." if scores[4] > 3.5 else "Adequate communication.",
                conceptual_turn_ids=[1, 3], depth_reasoning_turn_ids=[3, 5],
                problem_solving_turn_ids=[7], practical_project_turn_ids=[7],
                communication_turn_ids=[1, 3, 5, 7, 9],
                total_score=round(total, 1),
                feedback_lines=[
                    f"Overall performance: {'strong' if total > 70 else 'average' if total > 50 else 'needs improvement'}.",
                    f"Conceptual understanding {'well demonstrated' if scores[0] > 3.5 else 'needs deepening'}.",
                    f"Problem-solving {'systematic and effective' if scores[2] > 3.5 else 'requires more practice'}.",
                ],
                low_confidence_flag=persona["name"] == "weak",
                low_confidence_reasons=["Multiple don't-know answers"] if persona["name"] == "weak" else [],
                model_used="mock",
            )
            db.add(report)
            session.total_score = round(total, 1)
            session.score_breakdown = dict(zip(dims, scores))
            session.score_prompt_version = "v1"

        await db.commit()
        print("✅ Seed complete!")
        print("   Faculty: priya.sharma@university.edu / faculty123")
        print("   Student: STU001 / student123")


if __name__ == "__main__":
    asyncio.run(seed())
