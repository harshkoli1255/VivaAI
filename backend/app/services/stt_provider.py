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
        self.api_key = settings.DEEPGRAM_API_KEY
        self.model = settings.DEEPGRAM_STT_MODEL
        self.vocabulary = []
        self.language = "en"

    async def transcribe_stream(
        self, audio_chunks: AsyncIterator[bytes]
    ) -> AsyncIterator[STTResult]:
        # The interview sends a complete encoded answer, not raw live PCM.
        # Preserve the container header and use Deepgram's prerecorded endpoint.
        import httpx
        audio = bytearray()
        async for chunk in audio_chunks:
            audio.extend(chunk)
            if len(audio) > 2 * 1024 * 1024:
                raise ValueError("Audio answer exceeds 2 MB")
        if not audio:
            return
        async with httpx.AsyncClient(timeout=30.0) as client:
            params = [("model", self.model), ("smart_format", "true"), ("language", self.language), ("diarize", "true")]
            # Nova-2 uses keywords; Nova-3 uses keyterm. Keep boosts modest:
            # this is recognition context, never an instruction to invent words.
            for term in self.vocabulary[:30]:
                params.append(("keyterm", term) if self.model.startswith("nova-3") else ("keywords", f"{term}:1.2"))
            response = await client.post(
                "https://api.deepgram.com/v1/listen",
                params=params,
                headers={"Authorization": f"Token {self.api_key}", "Content-Type": "application/octet-stream"},
                content=bytes(audio),
            )
            response.raise_for_status()
            alternative = response.json()["results"]["channels"][0]["alternatives"][0]
            yield STTResult(text=alternative["transcript"], confidence=alternative["confidence"],
                            is_final=True, words=alternative.get("words", []))


def get_stt_provider() -> STTProvider:
    if settings.MOCK_MODE:
        logger.info("Using Mock STT provider")
        return MockSTTProvider()
    if not settings.DEEPGRAM_API_KEY:
        raise RuntimeError("DEEPGRAM_API_KEY is required when mock mode is disabled")
    logger.info("Using Deepgram STT provider")
    return DeepgramSTTProvider()


async def deepgram_live(audio_chunks, *, api_key, model, vocabulary=(), language='en'):
    """Forward container fragments immediately; yield interim and finalized segments.

    CloseStream flushes the remaining audio before the provider closes. Never
    buffer an entire answer or expose the provider credential to the browser.
    """
    import json
    from urllib.parse import urlencode
    import websockets
    params = [('model', model), ('interim_results', 'true'), ('smart_format', 'true'),
              ('endpointing', '300'), ('language', language), ('diarize', 'true')]
    for term in vocabulary[:30]:
        params.append(('keyterm', term) if model.startswith('nova-3') else ('keywords', f'{term}:1.2'))
    url = 'wss://api.deepgram.com/v1/listen?' + urlencode(params)
    async with websockets.connect(url, extra_headers={'Authorization': f'Token {api_key}'},
                                  open_timeout=10, close_timeout=3, max_size=1024 * 1024) as socket:
        async def send():
            async for chunk in audio_chunks:
                if chunk:
                    await socket.send(chunk)
            await socket.send(json.dumps({'type': 'CloseStream'}))
        sender = asyncio.create_task(send())
        try:
            async for raw in socket:
                payload = json.loads(raw)
                if payload.get('type') == 'Error':
                    raise RuntimeError('Streaming transcription provider rejected the stream')
                if payload.get('type') != 'Results':
                    continue
                alt = payload.get('channel', {}).get('alternatives', [{}])[0]
                text = alt.get('transcript', '')
                if text:
                    yield STTResult(text=text, confidence=alt.get('confidence', 0),
                                    is_final=bool(payload.get('is_final')), words=alt.get('words', []))
            await sender
        finally:
            sender.cancel()
            await asyncio.gather(sender, return_exceptions=True)


async def transcribe_live(provider, audio_chunks, language='en'):
    if isinstance(provider, DeepgramSTTProvider):
        async for result in deepgram_live(audio_chunks, api_key=provider.api_key,
                model=(settings.DEEPGRAM_MULTILINGUAL_MODEL if language in ("hi", "multi") else provider.model), vocabulary=provider.vocabulary, language=language):
            yield result
    elif isinstance(provider, MockSTTProvider):
        # A deterministic transport fixture, not a speech-accuracy result.
        received = False
        async for chunk in audio_chunks:
            if chunk and not received:
                received = True
                yield STTResult('A mutex protects', .8, False)
        if received:
            yield STTResult('A mutex protects shared state through mutual exclusion.', .95, True)
    else:
        raise RuntimeError('This speech provider does not support live transcription')
