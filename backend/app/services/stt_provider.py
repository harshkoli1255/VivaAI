"""
STT (Speech-to-Text) provider abstraction.
Supports: deepgram | mock
"""
from __future__ import annotations

import asyncio
import logging
import random
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import AsyncIterator, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)


@dataclass
class STTResult:
    text: str
    confidence: float
    is_final: bool
    words: list = None

    def __post_init__(self):
        if self.words is None:
            self.words = []


class STTProvider(ABC):
    @abstractmethod
    async def transcribe_stream(
        self, audio_chunks: AsyncIterator[bytes]
    ) -> AsyncIterator[STTResult]: ...


class MockSTTProvider(STTProvider):
    """Returns canned transcriptions for testing."""

    RESPONSES = [
        ("I believe a process is an independent program in execution with its own memory space, "
         "while a thread is a unit of execution within a process that shares the same memory.", 0.95),
        ("Garbage collection automatically manages memory by reclaiming objects that are no longer reachable.", 0.92),
        ("REST stands for Representational State Transfer. It uses HTTP methods like GET, POST, PUT, DELETE.", 0.88),
        ("I'm not entirely sure about that one.", 0.91),
        ("The CAP theorem states that a distributed system can only guarantee two of three properties: "
         "consistency, availability, and partition tolerance.", 0.94),
    ]

    async def transcribe_stream(
        self, audio_chunks: AsyncIterator[bytes]
    ) -> AsyncIterator[STTResult]:
        # Drain the input
        async for _ in audio_chunks:
            pass

        # Return a simulated result
        await asyncio.sleep(0.3)
        text, conf = random.choice(self.RESPONSES)

        # Yield interim
        yield STTResult(text=text[:len(text)//2] + "...", confidence=0.5, is_final=False)
        await asyncio.sleep(0.2)
        yield STTResult(text=text, confidence=conf, is_final=True)


class DeepgramSTTProvider(STTProvider):
    def __init__(self):
        try:
            from deepgram import DeepgramClient, LiveTranscriptionEvents, LiveOptions
            self.client = DeepgramClient(api_key=settings.DEEPGRAM_API_KEY)
            self.LiveTranscriptionEvents = LiveTranscriptionEvents
            self.LiveOptions = LiveOptions
        except ImportError:
            raise RuntimeError("deepgram-sdk not installed")

    async def transcribe_stream(
        self, audio_chunks: AsyncIterator[bytes]
    ) -> AsyncIterator[STTResult]:
        # Deepgram streaming implementation
        # This is a simplified version — production would use their WebSocket SDK
        results_queue: asyncio.Queue[STTResult] = asyncio.Queue()

        async def consume():
            async for chunk in audio_chunks:
                # In production, send chunk to Deepgram connection
                pass
            await results_queue.put(None)  # sentinel

        asyncio.create_task(consume())

        while True:
            result = await results_queue.get()
            if result is None:
                break
            yield result


def get_stt_provider() -> STTProvider:
    if settings.MOCK_MODE or not settings.DEEPGRAM_API_KEY:
        logger.info("Using Mock STT provider")
        return MockSTTProvider()
    logger.info("Using Deepgram STT provider")
    return DeepgramSTTProvider()
