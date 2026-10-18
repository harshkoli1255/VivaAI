"""
Provider-agnostic LLM wrapper with retry + fallback.
Supports: openai | anthropic | mock
"""
from __future__ import annotations

import asyncio
import json
import logging
import random
from abc import ABC, abstractmethod
from typing import AsyncIterator, Optional

from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from app.core.config import settings

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────
# Abstract interface
# ──────────────────────────────────────────────────────────────

class LLMProvider(ABC):
    @abstractmethod
    async def chat(self, messages: list[dict], temperature: float = 0.7,
                   max_tokens: int = 512) -> str: ...

    @abstractmethod
    async def chat_json(self, messages: list[dict], temperature: float = 0.0,
                        max_tokens: int = 1024) -> dict: ...


# ──────────────────────────────────────────────────────────────
# Mock provider (no API keys needed)
# ──────────────────────────────────────────────────────────────

class MockLLMProvider(LLMProvider):
    """Deterministic mock for development and testing."""

    QUESTION_BANK = {
        "warm_up": [
            "Can you tell me a bit about yourself and your background in this subject?",
            "What's your experience with this topic so far?",
            "What aspect of this subject do you find most interesting?",
        ],
        "fundamentals": [
            "Can you explain what a process is versus a thread?",
            "What is the difference between stack and heap memory?",
            "Can you explain what polymorphism means in object-oriented programming?",
            "What is a RESTful API and how does it work?",
            "Can you describe the OSI model and name a few layers?",
        ],
        "depth": [
            "How does garbage collection work in modern runtimes?",
            "What trade-offs do you consider when designing a database schema?",
            "Explain the CAP theorem and give an example of each combination.",
            "How would you design a rate limiter for a web API?",
            "What is eventual consistency, and when would you use it?",
        ],
        "applied": [
            "Given a list of transactions, how would you detect duplicates efficiently?",
            "How would you design a URL shortener like bit.ly?",
            "Walk me through debugging a memory leak in a Python application.",
            "How would you implement a caching layer for a high-traffic web service?",
        ],
        "wrap_up": [
            "Is there anything from our discussion you'd like to clarify or expand on?",
            "What topic from today's viva would you most like to study further?",
        ],
    }

    FOLLOW_UPS = [
        "Excellent! Can you go deeper — what happens at the implementation level?",
        "Good answer. Can you give me a real-world example of that?",
        "Interesting — how would that behave under high load?",
        "That's correct. What are the trade-offs of that approach?",
    ]

    HINTS = [
        "Think about what happens to the data when the function returns.",
        "Consider the time complexity — can we do better than O(n²)?",
        "Hint: think about how the CPU schedules this.",
        "Think about the lifecycle of a request end-to-end.",
    ]

    CLASSIFIER_RESPONSES = {
        "strong": {"label": "strong", "confidence": 0.9, "reason": "Comprehensive and correct answer"},
        "partial": {"label": "partial", "confidence": 0.7, "reason": "Partially correct, missing depth"},
        "dont_know": {"label": "dont_know", "confidence": 0.95, "reason": "Student indicated no knowledge"},
        "off_topic": {"label": "off_topic", "confidence": 0.8, "reason": "Answer does not address the question"},
    }

    async def chat(self, messages: list[dict], temperature: float = 0.7,
                   max_tokens: int = 512) -> str:
        await asyncio.sleep(0.1)  # simulate latency
        last = messages[-1]["content"] if messages else ""

        # Pick a question for the phase if detected
        for phase, questions in self.QUESTION_BANK.items():
            if phase in last.lower():
                return random.choice(questions)

        return random.choice(self.FOLLOW_UPS)

    async def chat_json(self, messages: list[dict], temperature: float = 0.0,
                        max_tokens: int = 1024) -> dict:
        await asyncio.sleep(0.1)
        last = messages[-1]["content"].lower() if messages else ""

        # Scoring mock
        if "score" in last or "evaluate" in last or "rubric" in last:
            return self._mock_score()

        # Classifier mock
        if "classify" in last or "label" in last:
            # Rotate through labels for variety
            labels = list(self.CLASSIFIER_RESPONSES.keys())
            return self.CLASSIFIER_RESPONSES[random.choice(labels)]

        # Question generation mock
        if "generate" in last or "question" in last:
            return {
                "questions": [
                    {"text": q, "phase": "fundamentals", "difficulty": "medium"}
                    for q in self.QUESTION_BANK["fundamentals"][:3]
                ]
            }

        return {"response": random.choice(self.FOLLOW_UPS)}

    def _mock_score(self) -> dict:
        import random
        r = lambda: round(random.uniform(2.5, 5.0), 1)
        return {
            "conceptual_score": r(),
            "depth_reasoning_score": r(),
            "problem_solving_score": r(),
            "practical_project_score": r(),
            "communication_score": r(),
            "conceptual_reason": "Demonstrated solid understanding of core concepts.",
            "depth_reasoning_reason": "Showed good reasoning ability with some gaps.",
            "problem_solving_reason": "Approached the problem systematically.",
            "practical_project_reason": "Linked theory to practical examples effectively.",
            "communication_reason": "Clear and articulate throughout.",
            "conceptual_turn_ids": [],
            "depth_reasoning_turn_ids": [],
            "problem_solving_turn_ids": [],
            "practical_project_turn_ids": [],
            "communication_turn_ids": [],
            "feedback_lines": [
                "Strong grasp of fundamentals with room to deepen implementation knowledge.",
                "Problem-solving approach was methodical and well-reasoned.",
                "Communication was clear; minor language mixing noted but did not impede understanding.",
            ],
            "low_confidence_flag": False,
            "low_confidence_reasons": [],
        }


# ──────────────────────────────────────────────────────────────
# OpenAI provider
# ──────────────────────────────────────────────────────────────

class OpenAIProvider(LLMProvider):
    def __init__(self, fast_model: str = "gpt-4o-mini", strong_model: str = "gpt-4o"):
        try:
            import openai
            self.client = openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
            self.fast_model = fast_model
            self.strong_model = strong_model
        except ImportError:
            raise RuntimeError("openai package not installed")

    @retry(stop=stop_after_attempt(3),
           wait=wait_exponential(multiplier=1, min=1, max=10),
           retry=retry_if_exception_type(Exception))
    async def chat(self, messages: list[dict], temperature: float = 0.7,
                   max_tokens: int = 512) -> str:
        response = await self.client.chat.completions.create(
            model=self.fast_model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return response.choices[0].message.content or ""

    @retry(stop=stop_after_attempt(3),
           wait=wait_exponential(multiplier=1, min=1, max=10))
    async def chat_json(self, messages: list[dict], temperature: float = 0.0,
                        max_tokens: int = 1024) -> dict:
        response = await self.client.chat.completions.create(
            model=self.strong_model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content or "{}"
        return json.loads(content)


# ──────────────────────────────────────────────────────────────
# Factory
# ──────────────────────────────────────────────────────────────

def get_llm_provider(force_mock: bool = False) -> LLMProvider:
    if force_mock or settings.MOCK_MODE or not settings.OPENAI_API_KEY:
        logger.info("Using Mock LLM provider")
        return MockLLMProvider()

    provider = settings.LLM_PROVIDER.lower()
    if provider == "openai":
        logger.info("Using OpenAI LLM provider")
        return OpenAIProvider(settings.LLM_FAST_MODEL, settings.LLM_STRONG_MODEL)

    logger.warning(f"Unknown LLM provider '{provider}', falling back to mock")
    return MockLLMProvider()
