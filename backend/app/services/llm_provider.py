"""
Provider-agnostic LLM wrapper with explicit mock selection.
Supports: openai | anthropic | mock
"""
from __future__ import annotations

import asyncio
import json
import logging
import random
import re
from abc import ABC, abstractmethod
from typing import AsyncIterator, Optional

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

    async def chat_json_fast(self, messages: list[dict], temperature: float = 0.0,
                             max_tokens: int = 128) -> dict:
        """Compatibility path for test/custom providers; hosted providers select the fast model."""
        return await self.chat_json(messages, temperature=temperature, max_tokens=max_tokens)


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
        full_content = " ".join(m.get("content", "") for m in messages).lower()

        # Check for hints requested by examiner controller
        if "hint" in full_content:
            return random.choice(self.HINTS)

        # Check for unified examiner transition
        if "transition" in full_content or "acknowledges their answer" in full_content:
            return "Good explanation on those core concepts. Moving to our next question: Can you explain what a process is versus a thread?"

        # Check for deep follow-up probing
        if "follow-up" in full_content or "probe" in full_content or "deeper" in full_content:
            return random.choice(self.FOLLOW_UPS)

        # Pick a question for the phase if detected
        for phase, questions in self.QUESTION_BANK.items():
            if phase in full_content:
                return random.choice(questions)

        return random.choice(self.FOLLOW_UPS)

    async def chat_json(self, messages: list[dict], temperature: float = 0.0,
                        max_tokens: int = 1024) -> dict:
        await asyncio.sleep(0.1)
        last = messages[-1]["content"].lower() if messages else ""

        # Dispatch from trusted instructions, never keywords in a candidate's answer.
        system = ' '.join(message.get('content', '') for message in messages if message.get('role') == 'system').lower()
        if 'answer classifier' in system:
            return dict(self.CLASSIFIER_RESPONSES['partial'])

        # Scoring mock
        if "score" in last or "evaluate" in last or "rubric" in last:
            import re
            result = self._mock_score()
            indices = [int(x) for x in re.findall(r"\[Turn (\d+)\] STUDENT", messages[-1]["content"])]
            for dimension in ("conceptual", "depth_reasoning", "problem_solving", "practical_project", "communication"):
                result[f"{dimension}_turn_ids"] = indices[:3]
            result["feedback_turn_ids"] = [indices[:1], indices[1:2] or indices[:1], indices[-1:]]
            return result

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
                "Communication was clear and structured.",
            ],
            "feedback_turn_ids": [[], [], []],
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
            client_kwargs = {"api_key": settings.OPENAI_API_KEY, "timeout": 12.0}
            if getattr(settings, "OPENAI_BASE_URL", None):
                client_kwargs["base_url"] = settings.OPENAI_BASE_URL
            self.client = openai.AsyncOpenAI(**client_kwargs)
            self.fast_model = fast_model
            self.strong_model = strong_model
        except ImportError:
            raise RuntimeError("openai package not installed")

    async def chat(self, messages: list[dict], temperature: float = 0.7,
                   max_tokens: int = 512) -> str:
        try:
            response = await self.client.chat.completions.create(
                model=self.fast_model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
            )
            return response.choices[0].message.content or ""
        except Exception as e:
            logger.warning("OpenAI/Groq chat completion unavailable (%s)", type(e).__name__)
            raise

    async def chat_json_fast(self, messages: list[dict], temperature: float = 0.0,
                             max_tokens: int = 128) -> dict:
        return await self.chat_json(messages, temperature=temperature,
                                    max_tokens=max_tokens, model=self.fast_model)

    async def chat_json(self, messages: list[dict], temperature: float = 0.0,
                        max_tokens: int = 1024, *, model: Optional[str] = None) -> dict:
        try:
            response = await self.client.chat.completions.create(
                model=model or self.strong_model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                response_format={"type": "json_object"},
            )
            content = (response.choices[0].message.content or "{}").strip()
            if "```" in content:
                match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", content)
                if match:
                    content = match.group(1).strip()
            try:
                return json.loads(content)
            except json.JSONDecodeError:
                match = re.search(r"\{[\s\S]*\}", content)
                if match:
                    return json.loads(match.group(0))
                raise
        except Exception as e:
            logger.warning(f"OpenAI/Groq chat_json completion unavailable ({e}); evaluation failed.")
            raise


# ──────────────────────────────────────────────────────────────
# Anthropic provider
# ──────────────────────────────────────────────────────────────

class AnthropicProvider(LLMProvider):
    def __init__(self, fast_model: str = "claude-3-5-haiku-20241022", strong_model: str = "claude-3-5-sonnet-20241022"):
        try:
            import anthropic
            self.client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
            self.fast_model = fast_model if "claude" in fast_model.lower() else "claude-3-5-haiku-20241022"
            self.strong_model = strong_model if "claude" in strong_model.lower() else "claude-3-5-sonnet-20241022"
        except ImportError:
            raise RuntimeError("anthropic package not installed")

    def _split_system_messages(self, messages: list[dict]) -> tuple[str, list[dict]]:
        system_parts = []
        user_assistant_messages = []
        for msg in messages:
            if msg.get("role") == "system":
                system_parts.append(msg.get("content", ""))
            else:
                user_assistant_messages.append({"role": msg.get("role"), "content": msg.get("content", "")})

        if not user_assistant_messages:
            user_assistant_messages = [{"role": "user", "content": "Hello"}]

        return "\n\n".join(system_parts), user_assistant_messages

    async def chat(self, messages: list[dict], temperature: float = 0.7,
                   max_tokens: int = 512) -> str:
        try:
            system_prompt, filtered_messages = self._split_system_messages(messages)
            kwargs = {
                "model": self.fast_model,
                "messages": filtered_messages,
                "max_tokens": max_tokens,
                "temperature": temperature,
            }
            if system_prompt:
                kwargs["system"] = system_prompt

            response = await self.client.messages.create(**kwargs)
            if response.content and len(response.content) > 0:
                return response.content[0].text
            return ""
        except Exception as e:
            logger.warning("Anthropic chat completion unavailable (%s)", type(e).__name__)
            raise

    async def chat_json_fast(self, messages: list[dict], temperature: float = 0.0,
                             max_tokens: int = 128) -> dict:
        return await self.chat_json(messages, temperature=temperature,
                                    max_tokens=max_tokens, model=self.fast_model)

    async def chat_json(self, messages: list[dict], temperature: float = 0.0,
                        max_tokens: int = 1024, *, model: Optional[str] = None) -> dict:
        try:
            system_prompt, filtered_messages = self._split_system_messages(messages)
            json_instruction = "\nIMPORTANT: Return valid parseable JSON only. Do not wrap in markdown or include extra explanations."
            system_prompt = (system_prompt + json_instruction).strip()

            kwargs = {
                "model": model or self.strong_model,
                "messages": filtered_messages,
                "max_tokens": max_tokens,
                "temperature": temperature,
                "system": system_prompt,
            }

            response = await self.client.messages.create(**kwargs)
            raw_text = ""
            if response.content and len(response.content) > 0:
                raw_text = response.content[0].text.strip()

            if "```" in raw_text:
                match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", raw_text)
                if match:
                    raw_text = match.group(1).strip()

            return json.loads(raw_text)
        except Exception as e:
            logger.warning(f"Anthropic chat_json completion unavailable ({e}); evaluation failed.")
            raise


# ──────────────────────────────────────────────────────────────
# Factory
# ──────────────────────────────────────────────────────────────

def get_llm_provider(force_mock: bool = False) -> LLMProvider:
    if settings.IS_PRODUCTION and (force_mock or settings.MOCK_MODE or settings.LLM_PROVIDER.lower() == "mock"):
        raise RuntimeError("Mock evaluation is not permitted in production")
    if force_mock or settings.MOCK_MODE:
        logger.info("Using Mock LLM provider (MOCK_MODE=True)")
        return MockLLMProvider()

    provider = settings.LLM_PROVIDER.lower()
    if provider == "openai":
        if not settings.OPENAI_API_KEY:
            raise RuntimeError("OPENAI_API_KEY is required when mock mode is disabled")
        logger.info("Using OpenAI LLM provider")
        return OpenAIProvider(settings.LLM_FAST_MODEL, settings.LLM_STRONG_MODEL)

    if provider == "anthropic":
        if not settings.ANTHROPIC_API_KEY:
            raise RuntimeError("ANTHROPIC_API_KEY is required when mock mode is disabled")
        logger.info("Using Anthropic LLM provider")
        return AnthropicProvider(settings.LLM_FAST_MODEL, settings.LLM_STRONG_MODEL)

    if provider == "mock" and not settings.IS_PRODUCTION:
        return MockLLMProvider()
    raise RuntimeError(f"Unsupported LLM provider: {provider}")
