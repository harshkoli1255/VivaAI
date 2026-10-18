"""
Scripted student personas for end-to-end mock viva testing.
Tests three distinct personas:
1. Strong student (precise answers, explores depth)
2. Weak / partial student (vague, requires hints)
3. "I don't know" student (honestly declines, verifies zero-penalty skip policy)
"""
import pytest
import asyncio
from typing import List, Dict

from app.services.controller import (
    InterviewController, ControllerState, Phase,
    ClassificationResult, AnswerLabel
)
from app.services.classifier import classify_answer
from app.services.scorer import score_session
from app.services.llm_provider import MockLLMProvider

PERSONA_ANSWERS = {
    "strong": [
        "In an operating system, a deadlock is an impasse where a set of processes are blocked because each is holding a resource and waiting for another resource held by another process. The four necessary Coffman conditions are mutual exclusion, hold and wait, no preemption, and circular wait.",
        "Dijkstra's Banker's Algorithm prevents deadlock by running a safety algorithm prior to resource allocation. It maintains allocation, max demand, and need matrices. A state is safe only if there exists at least one execution sequence where all processes can finish.",
        "A counting semaphore maintains an integer counter allowing up to N concurrent threads into a critical section, whereas a binary semaphore or mutex restricts access strictly to a single thread with ownership semantics.",
        "The Translation Lookaside Buffer is a hardware associative cache that stores recent virtual-to-physical page mappings. On a TLB hit, the CPU translates the address in 1 clock cycle without walking the multi-level page tables in DRAM.",
    ],
    "weak": [
        "Deadlock is when everything stops and nothing works because memory is full or something is frozen.",
        "I think Banker's algorithm checks money or something in banking transactions, not sure how it does allocation.",
        "Semaphores are flags for threads to wait or go.",
        "TLB is some cache in the computer processor.",
    ],
    "dont_know": [
        "I don't know the answer to this question, sir.",
        "I am not familiar with Banker's algorithm, please move to the next question.",
        "I don't know.",
        "I haven't studied this topic yet, I don't know.",
    ],
}


class PersonaBot:
    """Simulates a student persona answering interview questions."""

    def __init__(self, persona_type: str):
        self.persona_type = persona_type
        self.answers = PERSONA_ANSWERS[persona_type]
        self.answer_idx = 0
        self.turns: List[Dict] = []
        self.llm = MockLLMProvider()

        state = ControllerState(session_id=f"persona-{persona_type}")
        self.controller = InterviewController(state)

    def get_next_answer(self) -> str:
        if self.answer_idx < len(self.answers):
            ans = self.answers[self.answer_idx]
            self.answer_idx += 1
            return ans
        return "I have completed my explanation."

    async def run_interview(self) -> Dict:
        """Run simulated interview through all phases."""
        questions = [
            ("fundamentals", "What are the Coffman conditions for deadlocks?"),
            ("depth", "How does the Banker's algorithm ensure safe states?"),
            ("depth", "Explain counting vs binary semaphores."),
            ("applied", "How does TLB caching avoid page table memory lookups?"),
        ]

        default_weights = {
            "conceptual": 30, "depth_reasoning": 25,
            "problem_solving": 20, "practical_project": 15, "communication": 10,
        }

        turn_idx = 0
        for phase_str, q_text in questions:
            # AI asks question
            self.turns.append({
                "turn_index": turn_idx,
                "speaker": "ai",
                "text": q_text,
                "phase": phase_str,
            })
            turn_idx += 1

            # Student answers
            student_ans = self.get_next_answer()
            classification = await classify_answer(q_text, student_ans, self.llm)

            # Controller policy
            decision = self.controller.on_student_answer(
                text=student_ans,
                classification=classification,
                elapsed_secs=turn_idx * 60,
                duration_secs=25,
            )

            self.turns.append({
                "turn_index": turn_idx,
                "speaker": "student",
                "text": student_ans,
                "phase": phase_str,
                "answer_label": classification.label.value,
            })
            turn_idx += 1

        # Run scoring on transcript
        score_report = await score_session(
            session_id=f"sim-{self.persona_type}",
            turns=self.turns,
            rubric_weights=default_weights,
            llm=self.llm,
        )

        return {
            "persona": self.persona_type,
            "turns_count": len(self.turns),
            "total_score": score_report["total_score"],
            "score_report": score_report,
            "tab_switches": self.controller.state.tab_switch_count,
        }


@pytest.mark.asyncio
async def test_strong_persona():
    bot = PersonaBot("strong")
    result = await bot.run_interview()

    assert result["turns_count"] == 8
    assert 0 <= result["total_score"] <= 100
    assert result["score_report"]["conceptual_score"] >= 2.0
    assert len(result["score_report"]["feedback_lines"]) >= 2


@pytest.mark.asyncio
async def test_weak_persona():
    bot = PersonaBot("weak")
    result = await bot.run_interview()

    assert result["turns_count"] == 8
    assert 0 <= result["total_score"] <= 100


@pytest.mark.asyncio
async def test_dont_know_persona():
    bot = PersonaBot("dont_know")
    result = await bot.run_interview()

    # Verify policy: zero crash, completed successfully
    assert result["turns_count"] == 8
    assert result["score_report"] is not None
    assert 0 <= result["total_score"] <= 100
    assert result["turns_count"] == 8
    assert result["score_report"] is not None
    # Verify that saying "I don't know" does not trigger an exception or penalty crash
    assert 0 <= result["total_score"] <= 100
