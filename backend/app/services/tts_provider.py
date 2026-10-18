"""
TTS (Text-to-Speech) provider abstraction.
Supports: elevenlabs | openai | mock
"""
from __future__ import annotations

import asyncio
import logging
import struct
import math
from abc import ABC, abstractmethod
from typing import AsyncIterator

from app.core.config import settings

logger = logging.getLogger(__name__)


class TTSProvider(ABC):
    @abstractmethod
    async def synthesize(self, text: str) -> AsyncIterator[bytes]: ...


class MockTTSProvider(TTSProvider):
    """Generates a synthetic WAV-like audio chunk for testing."""

    async def synthesize(self, text: str) -> AsyncIterator[bytes]:
        await asyncio.sleep(0.1)
        # Generate a simple sine wave as mock audio (PCM 16-bit, 16kHz, 1ch)
        sample_rate = 16000
        duration = min(len(text) * 0.05, 3.0)  # ~50ms per char, max 3s
        frequency = 440  # A4 tone
        num_samples = int(sample_rate * duration)

        # WAV header
        data_size = num_samples * 2
        header = struct.pack(
            "<4sI4s4sIHHIIHH4sI",
            b"RIFF", 36 + data_size, b"WAVE",
            b"fmt ", 16, 1, 1,
            sample_rate, sample_rate * 2, 2, 16,
            b"data", data_size,
        )

        samples = bytearray()
        for i in range(num_samples):
            value = int(32767 * math.sin(2 * math.pi * frequency * i / sample_rate) * 0.3)
            samples.extend(struct.pack("<h", value))

        chunk_size = 4096
        audio = bytes(header) + bytes(samples)
        for i in range(0, len(audio), chunk_size):
            yield audio[i:i + chunk_size]
            await asyncio.sleep(0.01)


class OpenAITTSProvider(TTSProvider):
    def __init__(self):
        import openai
        self.client = openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

    async def synthesize(self, text: str) -> AsyncIterator[bytes]:
        async with self.client.audio.speech.with_streaming_response.create(
            model="tts-1",
            voice="nova",
            input=text,
            response_format="pcm",
        ) as response:
            async for chunk in response.iter_bytes(chunk_size=4096):
                yield chunk


def get_tts_provider() -> TTSProvider:
    if settings.MOCK_MODE or not settings.OPENAI_API_KEY:
        logger.info("Using Mock TTS provider")
        return MockTTSProvider()

    provider = settings.TTS_PROVIDER.lower()
    if provider == "openai":
        logger.info("Using OpenAI TTS provider")
        return OpenAITTSProvider()

    logger.warning(f"Unknown TTS provider '{provider}', falling back to mock")
    return MockTTSProvider()
