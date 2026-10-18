"""
Interview Controller — deterministic state machine.

The controller (NOT the LLM) owns the interview state, phase transitions,
timer, and policy decisions. The LLM only provides question text and
evaluations — it never controls flow.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────
# Phase definitions
# ──────────────────────────────────────────────────────────────

class Phase(str, Enum):
    warm_up = "warm_up"
    fundamentals = "fundamentals"
    depth = "depth"
    applied = "applied"
    wrap_up = "wrap_up"
    scoring = "scoring"
    completed = "completed"


DEFAULT_PHASE_TIMINGS: Dict[Phase, Dict[str, int]] = {
    Phase.warm_up:     {"start": 0,   "end": 60},
    Phase.fundamentals: {"start": 60,  "end": 300},
    Phase.depth:       {"start": 300, "end": 600},
    Phase.applied:     {"start": 600, "end": 780},
    Phase.wrap_up:     {"start": 780, "end": 870},
    Phase.scoring:     {"start": 870, "end": 900},
}

PHASE_ORDER = [
    Phase.warm_up,
    Phase.fundamentals,
    Phase.depth,
    Phase.applied,
    Phase.wrap_up,
    Phase.scoring,
    Phase.completed,
]

# Policy constants
MAX_ANSWER_SECS = 90       # redirect if student talks > 90s
SILENCE_PROMPT_SECS = 15   # prompt student after 15s silence
TOTAL_SECS = 900           # hard 15-min cutoff


# ──────────────────────────────────────────────────────────────
# Answer classifier labels
# ──────────────────────────────────────────────────────────────

class AnswerLabel(str, Enum):
    strong = "strong"
    partial = "partial"
    dont_know = "dont_know"
    off_topic = "off_topic"


# Alias for backwards compatibility
ControllerLabel = AnswerLabel


@dataclass
class ClassificationResult:
    label: AnswerLabel
    confidence: float
    reason: str = ""


# ──────────────────────────────────────────────────────────────
# Turn record
# ──────────────────────────────────────────────────────────────

@dataclass
class Turn:
    index: int
    speaker: str   # "ai" | "student"
    text: str
    timestamp_secs: float
    phase: Phase
    question_id: Optional[str] = None
    is_variant: bool = False
    answer_label: Optional[AnswerLabel] = None
    classifier_confidence: Optional[float] = None
    stt_confidence: Optional[float] = None
    duration_secs: Optional[float] = None


# ──────────────────────────────────────────────────────────────
# Controller state
# ──────────────────────────────────────────────────────────────

@dataclass
class ControllerState:
    session_id: str
    phase: Phase = Phase.warm_up
    elapsed_secs: float = 0.0
    turns: List[Turn] = field(default_factory=list)
    phase_timings: Dict[Phase, Dict[str, int]] = field(default_factory=lambda: dict(DEFAULT_PHASE_TIMINGS))

    # Per-turn tracking
    current_question_id: Optional[str] = None
    hint_given: bool = False          # for partial answers
    questions_asked_this_phase: int = 0
    consecutive_dont_knows: int = 0

    # Silence / long-answer tracking
    last_student_turn_at: float = 0.0
    student_speaking_since: Optional[float] = None

    # Stats
    tab_switch_count: int = 0
    long_silence_count: int = 0
    stt_low_conf_count: int = 0

    # Termination
    is_active: bool = True
    wrap_up_initiated: bool = False


# ──────────────────────────────────────────────────────────────
# Policy engine
# ──────────────────────────────────────────────────────────────

@dataclass
class PolicyDecision:
    action: str   # "ask_follow_up" | "give_hint" | "move_on" | "redirect" | "end_phase" | "end_interview"
    message: Optional[str] = None   # polite message for redirects etc.
    next_question_topic: Optional[str] = None


class InterviewController:
    """
    Pure-Python deterministic controller. No I/O, fully unit-testable.
    Feed it tick() calls and events; it returns actions.
    """

    def __init__(self, state: ControllerState):
        self.state = state

    # ── Time management ────────────────────────────────────────

    def tick(self, elapsed_secs: float) -> Optional[PolicyDecision]:
        """
        Called periodically with the current elapsed time.
        Returns a PolicyDecision if a phase transition or timeout triggers.
        """
        if not self.state.is_active:
            return None

        self.state.elapsed_secs = elapsed_secs

        # Hard cutoff
        if elapsed_secs >= TOTAL_SECS:
            return self._end_interview("Time limit reached.")

        # Phase transition
        next_phase = self._compute_phase(elapsed_secs)
        if next_phase != self.state.phase:
            old = self.state.phase
            self.state.phase = next_phase
            self.state.questions_asked_this_phase = 0
            self.state.hint_given = False
            logger.info("Phase transition", extra={
                "session_id": self.state.session_id,
                "from": old,
                "to": next_phase,
                "elapsed": elapsed_secs,
            })
            if next_phase == Phase.scoring:
                return PolicyDecision(action="end_interview",
                                      message="Thank you! We're now wrapping up.")
            return PolicyDecision(action="end_phase",
                                  message=self._phase_transition_message(old, next_phase))

        # Silence check (only during active student turns)
        if self.state.student_speaking_since is None:
            silence = elapsed_secs - self.state.last_student_turn_at
            if silence > SILENCE_PROMPT_SECS and self.state.last_student_turn_at > 0:
                self.state.last_student_turn_at = elapsed_secs  # reset so we don't spam
                self.state.long_silence_count += 1
                return PolicyDecision(action="prompt_silence",
                                      message="Take your time. Feel free to share what you know.")

        return None

    def _compute_phase(self, elapsed: float) -> Phase:
        for phase in PHASE_ORDER[:-1]:
            timing = self.state.phase_timings.get(phase, DEFAULT_PHASE_TIMINGS.get(phase))
            if timing and timing["start"] <= elapsed < timing["end"]:
                return phase
        return Phase.scoring

    # ── Event handlers ────────────────────────────────────────

    def on_student_answer(
        self,
        text: str,
        classification: ClassificationResult,
        elapsed_secs: float,
        duration_secs: float,
        stt_confidence: Optional[float] = None,
    ) -> PolicyDecision:
        """
        Called when the student finishes speaking.
        Returns the next policy action.
        """
        self.state.elapsed_secs = elapsed_secs
        self.state.last_student_turn_at = elapsed_secs
        self.state.student_speaking_since = None

        if stt_confidence is not None and stt_confidence < 0.6:
            self.state.stt_low_conf_count += 1

        label = classification.label

        # Long answer redirect
        if duration_secs > MAX_ANSWER_SECS:
            return PolicyDecision(
                action="redirect",
                message="Thanks — let's keep moving. I'd like to ask about something else.",
            )

        # Off-topic
        if label == AnswerLabel.off_topic:
            return PolicyDecision(
                action="redirect",
                message="Interesting. Let's focus back on the topic. "
                        "Could you relate that to the concept we were discussing?",
            )

        # Don't know
        if label == AnswerLabel.dont_know:
            self.state.consecutive_dont_knows += 1
            return PolicyDecision(
                action="move_on",
                message="That's fine — no worries. Let's try a different question.",
            )

        self.state.consecutive_dont_knows = 0

        # Strong answer
        if label == AnswerLabel.strong:
            return PolicyDecision(
                action="ask_follow_up",
                message=None,  # LLM generates the follow-up
            )

        # Partial answer
        if label == AnswerLabel.partial:
            if not self.state.hint_given:
                self.state.hint_given = True
                return PolicyDecision(
                    action="give_hint",
                    message=None,  # LLM generates the hint
                )
            else:
                # Already gave one hint — move on
                self.state.hint_given = False
                return PolicyDecision(
                    action="move_on",
                    message="Good effort. Let's move on to the next area.",
                )

        return PolicyDecision(action="move_on")

    def on_student_speaking_start(self, elapsed_secs: float):
        self.state.student_speaking_since = elapsed_secs

    def on_student_speaking_end(self, elapsed_secs: float):
        self.state.student_speaking_since = None
        self.state.last_student_turn_at = elapsed_secs

    def on_tab_switch(self):
        self.state.tab_switch_count += 1
        logger.warning("Tab switch detected", extra={
            "session_id": self.state.session_id,
            "count": self.state.tab_switch_count,
        })

    # ── Internal helpers ──────────────────────────────────────

    def _end_interview(self, reason: str) -> PolicyDecision:
        self.state.is_active = False
        self.state.phase = Phase.completed
        logger.info("Interview ended", extra={
            "session_id": self.state.session_id,
            "reason": reason,
        })
        return PolicyDecision(
            action="end_interview",
            message="That's the end of our session. Thank you for your time. "
                    "Your responses will be reviewed shortly.",
        )

    def _phase_transition_message(self, old: Phase, new: Phase) -> str:
        messages = {
            Phase.fundamentals: "Great! Now let's explore some core concepts.",
            Phase.depth:        "Excellent — let's go deeper into some topics.",
            Phase.applied:      "Now, let's work through a practical problem together.",
            Phase.wrap_up:      "We're almost done. A couple of wrap-up questions.",
            Phase.scoring:      "Thank you — that concludes the interview.",
        }
        return messages.get(new, "Moving on to the next section.")

    # ── State snapshot (for DB persistence) ──────────────────

    def to_snapshot(self) -> Dict[str, Any]:
        return {
            "session_id": self.state.session_id,
            "phase": self.state.phase.value,
            "elapsed_secs": self.state.elapsed_secs,
            "is_active": self.state.is_active,
            "tab_switch_count": self.state.tab_switch_count,
            "long_silence_count": self.state.long_silence_count,
            "stt_low_conf_count": self.state.stt_low_conf_count,
        }

    @classmethod
    def from_snapshot(cls, snapshot: Dict[str, Any],
                      phase_timings: Optional[Dict] = None) -> "InterviewController":
        state = ControllerState(
            session_id=snapshot["session_id"],
            phase=Phase(snapshot.get("phase", Phase.warm_up)),
            elapsed_secs=snapshot.get("elapsed_secs", 0.0),
            is_active=snapshot.get("is_active", True),
            tab_switch_count=snapshot.get("tab_switch_count", 0),
            long_silence_count=snapshot.get("long_silence_count", 0),
            stt_low_conf_count=snapshot.get("stt_low_conf_count", 0),
        )
        if phase_timings:
            state.phase_timings = {Phase(k): v for k, v in phase_timings.items()}
        return cls(state)
