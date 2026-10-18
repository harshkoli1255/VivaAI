"""All SQLAlchemy ORM models."""
import uuid
from datetime import datetime, timezone
from typing import Optional, List
from enum import Enum as PyEnum

from sqlalchemy import (
    String, Text, Integer, Float, Boolean, DateTime,
    ForeignKey, JSON, Enum, UniqueConstraint, Index,
)
from sqlalchemy import Uuid as UUID
from sqlalchemy.orm import relationship, Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.session import Base


def utcnow():
    return datetime.now(timezone.utc)


# ──────────────────────────────────────────────────────────────
# Enums
# ──────────────────────────────────────────────────────────────

class UserRole(str, PyEnum):
    student = "student"
    faculty = "faculty"
    admin = "admin"


class VivaPhase(str, PyEnum):
    warm_up = "warm_up"
    fundamentals = "fundamentals"
    depth = "depth"
    applied = "applied"
    wrap_up = "wrap_up"
    scoring = "scoring"
    completed = "completed"


class SessionStatus(str, PyEnum):
    scheduled = "scheduled"
    in_progress = "in_progress"
    completed = "completed"
    aborted = "aborted"
    flagged = "flagged"


class QuestionStatus(str, PyEnum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class AnswerLabel(str, PyEnum):
    strong = "strong"
    partial = "partial"
    dont_know = "dont_know"
    off_topic = "off_topic"


class ReviewStatus(str, PyEnum):
    pending = "pending"
    reviewed = "reviewed"
    overridden = "overridden"


# ──────────────────────────────────────────────────────────────
# Users
# ──────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    student_id: Mapped[Optional[str]] = mapped_column(String(64), unique=True, index=True)
    email: Mapped[Optional[str]] = mapped_column(String(256), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(256))
    hashed_password: Mapped[str] = mapped_column(String(256))
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.student)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    sessions: Mapped[List["VivaSession"]] = relationship("VivaSession", back_populates="student", foreign_keys="VivaSession.student_id")


# ──────────────────────────────────────────────────────────────
# Viva Configuration
# ──────────────────────────────────────────────────────────────

class VivaConfig(Base):
    __tablename__ = "viva_configs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    title: Mapped[str] = mapped_column(String(256))
    subject: Mapped[str] = mapped_column(String(256))
    topics: Mapped[List] = mapped_column(JSON, default=list)
    difficulty: Mapped[str] = mapped_column(String(32), default="medium")  # easy|medium|hard
    total_duration_secs: Mapped[int] = mapped_column(Integer, default=900)  # 15 min

    # Phase timings in seconds from start
    phase_timings: Mapped[dict] = mapped_column(JSON, default=lambda: {
        "warm_up": {"start": 0, "end": 60},
        "fundamentals": {"start": 60, "end": 300},
        "depth": {"start": 300, "end": 600},
        "applied": {"start": 600, "end": 780},
        "wrap_up": {"start": 780, "end": 870},
        "scoring": {"start": 870, "end": 900},
    })

    # Rubric weights (must sum to 100)
    rubric_weights: Mapped[dict] = mapped_column(JSON, default=lambda: {
        "conceptual": 30,
        "depth_reasoning": 25,
        "problem_solving": 20,
        "practical_project": 15,
        "communication": 10,
    })

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    questions: Mapped[List["Question"]] = relationship("Question", back_populates="viva_config")
    sessions: Mapped[List["VivaSession"]] = relationship("VivaSession", back_populates="viva_config")


# ──────────────────────────────────────────────────────────────
# Question Bank
# ──────────────────────────────────────────────────────────────

class Question(Base):
    __tablename__ = "questions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    viva_config_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("viva_configs.id"))
    text: Mapped[str] = mapped_column(Text)
    phase: Mapped[VivaPhase] = mapped_column(Enum(VivaPhase))
    topic: Mapped[Optional[str]] = mapped_column(String(256))
    difficulty: Mapped[str] = mapped_column(String(32), default="medium")
    expected_keywords: Mapped[List] = mapped_column(JSON, default=list)
    follow_up_hints: Mapped[List] = mapped_column(JSON, default=list)
    status: Mapped[QuestionStatus] = mapped_column(Enum(QuestionStatus), default=QuestionStatus.pending)
    is_ai_generated: Mapped[bool] = mapped_column(Boolean, default=False)
    reviewed_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    review_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    viva_config: Mapped["VivaConfig"] = relationship("VivaConfig", back_populates="questions")


# ──────────────────────────────────────────────────────────────
# Viva Session
# ──────────────────────────────────────────────────────────────

class VivaSession(Base):
    __tablename__ = "viva_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    viva_config_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("viva_configs.id"))
    student_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))

    status: Mapped[SessionStatus] = mapped_column(Enum(SessionStatus), default=SessionStatus.scheduled)
    current_phase: Mapped[VivaPhase] = mapped_column(Enum(VivaPhase), default=VivaPhase.warm_up)

    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    elapsed_secs: Mapped[int] = mapped_column(Integer, default=0)  # for resume

    # Audio
    audio_s3_key: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)

    # Consent
    consent_given: Mapped[bool] = mapped_column(Boolean, default=False)
    consent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Flags
    tab_switch_count: Mapped[int] = mapped_column(Integer, default=0)
    long_silence_count: Mapped[int] = mapped_column(Integer, default=0)
    stt_low_confidence_count: Mapped[int] = mapped_column(Integer, default=0)

    # Final score
    total_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    score_breakdown: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    score_prompt_version: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)

    # Review
    review_status: Mapped[ReviewStatus] = mapped_column(Enum(ReviewStatus), default=ReviewStatus.pending)
    override_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    override_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    override_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    override_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    viva_config: Mapped["VivaConfig"] = relationship("VivaConfig", back_populates="sessions")
    student: Mapped["User"] = relationship("User", back_populates="sessions", foreign_keys=[student_id])
    turns: Mapped[List["TranscriptTurn"]] = relationship("TranscriptTurn", back_populates="session", order_by="TranscriptTurn.turn_index")
    score_report: Mapped[Optional["ScoreReport"]] = relationship("ScoreReport", back_populates="session", uselist=False)
    audit_logs: Mapped[List["AuditLog"]] = relationship("AuditLog", back_populates="session")


# ──────────────────────────────────────────────────────────────
# Transcript
# ──────────────────────────────────────────────────────────────

class TranscriptTurn(Base):
    __tablename__ = "transcript_turns"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("viva_sessions.id"))
    turn_index: Mapped[int] = mapped_column(Integer)  # 0-based ordering
    speaker: Mapped[str] = mapped_column(String(16))  # "ai" | "student"

    text: Mapped[str] = mapped_column(Text)
    timestamp_secs: Mapped[float] = mapped_column(Float)  # seconds from session start
    duration_secs: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # STT metadata
    stt_confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    stt_words: Mapped[Optional[List]] = mapped_column(JSON, nullable=True)

    # Question tracking
    question_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("questions.id"), nullable=True)
    is_variant: Mapped[bool] = mapped_column(Boolean, default=False)
    phase: Mapped[Optional[VivaPhase]] = mapped_column(Enum(VivaPhase), nullable=True)

    # Classification (student turns only)
    answer_label: Mapped[Optional[AnswerLabel]] = mapped_column(Enum(AnswerLabel), nullable=True)
    classifier_confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    session: Mapped["VivaSession"] = relationship("VivaSession", back_populates="turns")

    __table_args__ = (
        Index("ix_transcript_session_idx", "session_id", "turn_index"),
    )


# ──────────────────────────────────────────────────────────────
# Score Report
# ──────────────────────────────────────────────────────────────

class ScoreReport(Base):
    __tablename__ = "score_reports"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("viva_sessions.id"), unique=True)
    prompt_version: Mapped[str] = mapped_column(String(32))

    # Dimension scores (0-5 raw, converted to /100 with weights)
    conceptual_score: Mapped[float] = mapped_column(Float)
    depth_reasoning_score: Mapped[float] = mapped_column(Float)
    problem_solving_score: Mapped[float] = mapped_column(Float)
    practical_project_score: Mapped[float] = mapped_column(Float)
    communication_score: Mapped[float] = mapped_column(Float)

    # Reasons and evidence
    conceptual_reason: Mapped[str] = mapped_column(Text)
    depth_reasoning_reason: Mapped[str] = mapped_column(Text)
    problem_solving_reason: Mapped[str] = mapped_column(Text)
    practical_project_reason: Mapped[str] = mapped_column(Text)
    communication_reason: Mapped[str] = mapped_column(Text)

    # Turn ID citations per dimension
    conceptual_turn_ids: Mapped[List] = mapped_column(JSON, default=list)
    depth_reasoning_turn_ids: Mapped[List] = mapped_column(JSON, default=list)
    problem_solving_turn_ids: Mapped[List] = mapped_column(JSON, default=list)
    practical_project_turn_ids: Mapped[List] = mapped_column(JSON, default=list)
    communication_turn_ids: Mapped[List] = mapped_column(JSON, default=list)

    total_score: Mapped[float] = mapped_column(Float)  # /100
    feedback_lines: Mapped[List] = mapped_column(JSON, default=list)  # 3-5 items

    low_confidence_flag: Mapped[bool] = mapped_column(Boolean, default=False)
    low_confidence_reasons: Mapped[List] = mapped_column(JSON, default=list)

    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    model_used: Mapped[str] = mapped_column(String(128))

    session: Mapped["VivaSession"] = relationship("VivaSession", back_populates="score_report")


# ──────────────────────────────────────────────────────────────
# Audit Log
# ──────────────────────────────────────────────────────────────

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("viva_sessions.id"))
    actor_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(128))  # e.g. "score_override", "question_approved"
    detail: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    session: Mapped["VivaSession"] = relationship("VivaSession", back_populates="audit_logs")
