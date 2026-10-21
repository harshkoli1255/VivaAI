"""
TTS (Text-to-Speech) provider abstraction.
Supports: elevenlabs (Flash v2.5 human voice) | deepgram | openai | system (Daniel @ 170wpm) | mock
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import struct
import subprocess
import tempfile
import time
from abc import ABC, abstractmethod
from typing import AsyncIterator, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)

CACHE_DIR = os.path.join(tempfile.gettempdir(), "vivaai_py_tts_cache")
os.makedirs(CACHE_DIR, exist_ok=True)

VOICE_MAP = {
    "alice": "Xb7hH8MSUJpSbSDYk0k2",
    "sarah": "EXAVITQu4vr4xnSDxMaL",
    "george": "JBFqnCBsd6RMkjVDRZzb",
    "brian": "nPczCjzI2devNBz1zQrb",
    "charlie": "IKne3meq5aSn9XLyUdCD",
    "matilda": "XrExE9yKIg1WjnnlVkGX",
    "jessica": "cgSgspJ2msm6clMCkdW9",
    "daniel": "onwK4e9ZLuTAKqWW03F9",
}


class TTSProvider(ABC):
    @abstractmethod
    async def synthesize(self, text: str, voice_id: Optional[str] = None) -> AsyncIterator[bytes]: ...


class SystemSayTTSProvider(TTSProvider):
    """
    High-fidelity local speech synthesis using macOS natural human voices (Daniel/Karen).
    Features natural British/Australian academic cadence (170 wpm) and instant disk caching.
    """

    def __init__(self, voice: str = "Daniel", rate: int = 170):
        self.voice = voice
        self.rate = rate

    async def synthesize(self, text: str, voice_id: Optional[str] = None) -> AsyncIterator[bytes]:
        say_path = "/usr/bin/say"
        if not os.path.exists(say_path):
            logger.warning("/usr/bin/say not found, generating silent frame")
            return

        chosen_voice = self.voice
        if voice_id and voice_id.lower() in ("george", "brian", "daniel", "charlie"):
            chosen_voice = "Daniel"
        elif voice_id and voice_id.lower() in ("sarah", "alice", "matilda", "jessica"):
            chosen_voice = "Karen"

        hash_key = hashlib.md5(f"say_{chosen_voice}_{self.rate}_{text}".encode("utf-8")).hexdigest()
        cached_wav = os.path.join(CACHE_DIR, f"{hash_key}.wav")

        if not os.path.exists(cached_wav):
            temp_out = os.path.join(CACHE_DIR, f"temp_{hash_key}.wav")
            try:
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(
                    None,
                    lambda: subprocess.run(
                        [
                            say_path,
                            "-v", chosen_voice,
                            "-r", str(self.rate),
                            "-o", temp_out,
                            "--data-format=LEI16@22050",
                            text,
                        ],
                        check=True,
                        timeout=15,
                    ),
                )
                if os.path.exists(temp_out):
                    os.replace(temp_out, cached_wav)
            except Exception as e:
                if os.path.exists(temp_out):
                    try:
                        os.remove(temp_out)
                    except OSError:
                        pass
                logger.error(f"System say synthesis failed for text: {e}")
                return

        if os.path.exists(cached_wav):
            chunk_size = 4096
            with open(cached_wav, "rb") as f:
                while True:
                    chunk = f.read(chunk_size)
                    if not chunk:
                        break
                    yield chunk
                    await asyncio.sleep(0.005)


class DeepgramTTSProvider(TTSProvider):
    """
    Studio-grade human speech synthesis using Deepgram Aura neural models.
    Lifelike conversational flow and crisp pronunciation.
    """

    def __init__(self, model: Optional[str] = None):
        self.api_key = settings.DEEPGRAM_API_KEY
        self.model = model or getattr(settings, "DEEPGRAM_VOICE_MODEL", "aura-asteria-en")

    async def synthesize(self, text: str, voice_id: Optional[str] = None) -> AsyncIterator[bytes]:
        if not self.api_key:
            raise RuntimeError("DEEPGRAM_API_KEY is required for Deepgram speech")

        hash_key = hashlib.md5(f"deepgram_{self.model}_{text}".encode("utf-8")).hexdigest()
        cached_mp3 = os.path.join(CACHE_DIR, f"{hash_key}.mp3")

        if os.path.exists(cached_mp3):
            chunk_size = 4096
            with open(cached_mp3, "rb") as f:
                while True:
                    chunk = f.read(chunk_size)
                    if not chunk:
                        break
                    yield chunk
                    await asyncio.sleep(0.005)
            return

        import httpx
        url = f"https://api.deepgram.com/v1/speak?model={self.model}"
        headers = {
            "Authorization": f"Token {self.api_key}",
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        }
        payload = {"text": text}

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                async with client.stream("POST", url, json=payload, headers=headers) as response:
                    if response.status_code == 200:
                        all_chunks = []
                        async for chunk in response.aiter_bytes(chunk_size=4096):
                            all_chunks.append(chunk)
                            yield chunk
                        if all_chunks:
                            try:
                                with open(cached_mp3, "wb") as f:
                                    f.write(b"".join(all_chunks))
                            except Exception:
                                pass
                        return
                    else:
                        err_text = await response.aread()
                        raise RuntimeError(f"Deepgram speech failed (HTTP {response.status_code})")
        except Exception as e:
            logger.warning("Deepgram speech unavailable (%s)", type(e).__name__)
            raise


class ElevenLabsTTSProvider(TTSProvider):
    """
    Studio-grade human speech synthesis using ElevenLabs Flash v2.5.
    Ultra-low latency (~150ms) and lifelike human vocal inflection.
    Falls back to Deepgram Aura neural speech if ElevenLabs is unreachable.
    """

    _blocked_until: dict[str, float] = {}

    def __init__(self, voice_id: Optional[str] = None):
        self.api_key = settings.ELEVENLABS_API_KEY
        self.voice_id = voice_id or getattr(settings, "ELEVENLABS_VOICE_ID", "Xb7hH8MSUJpSbSDYk0k2")
        self._fallback = DeepgramTTSProvider()
        self.last_provider = type(self).__name__

    async def synthesize(self, text: str, voice_id: Optional[str] = None) -> AsyncIterator[bytes]:
        active_voice = voice_id or self.voice_id or "Xb7hH8MSUJpSbSDYk0k2"
        resolved_voice = VOICE_MAP.get(active_voice.lower(), active_voice)

        credential_id = hashlib.sha256(self.api_key.encode()).hexdigest()
        self.last_provider = type(self).__name__
        if not self.api_key:
            self.last_provider = type(self._fallback).__name__
            async for chunk in self._fallback.synthesize(text, voice_id=resolved_voice):
                yield chunk
            return

        hash_key = hashlib.md5(f"eleven_{resolved_voice}_{text}".encode("utf-8")).hexdigest()
        cached_mp3 = os.path.join(CACHE_DIR, f"{hash_key}.mp3")

        if os.path.exists(cached_mp3):
            chunk_size = 4096
            with open(cached_mp3, "rb") as f:
                while True:
                    chunk = f.read(chunk_size)
                    if not chunk:
                        break
                    yield chunk
                    await asyncio.sleep(0.005)
            return

        if self._blocked_until.get(credential_id, 0) > time.monotonic():
            self.last_provider = type(self._fallback).__name__
            async for chunk in self._fallback.synthesize(text, voice_id=resolved_voice):
                yield chunk
            return

        import httpx
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{resolved_voice}/stream"
        headers = {
            "xi-api-key": self.api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        }
        payload = {
            "text": text,
            "model_id": "eleven_flash_v2_5",
            "voice_settings": {
                "stability": 0.5,
                "similarity_boost": 0.75,
            },
        }

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                async with client.stream("POST", url, json=payload, headers=headers) as response:
                    if response.status_code == 200:
                        all_chunks = []
                        async for chunk in response.aiter_bytes(chunk_size=4096):
                            all_chunks.append(chunk)
                            yield chunk
                        if all_chunks:
                            try:
                                with open(cached_mp3, "wb") as f:
                                    f.write(b"".join(all_chunks))
                            except Exception:
                                pass
                        return
                    else:
                        err_bytes = await response.aread()
                        if response.status_code in (401, 403, 429):
                            # Account/quota failures affect every voice and utterance.
                            # Avoid retrying rejected credentials on every question.
                            self._blocked_until[credential_id] = time.monotonic() + 300
                        logger.warning(
                            f"ElevenLabs TTS status {response.status_code}: "
                            f"{err_bytes.decode('utf-8', errors='ignore')}. Falling back to Deepgram Aura."
                        )
        except Exception as e:
            logger.warning(f"ElevenLabs TTS error: {e}. Falling back to Deepgram Aura.")

        self.last_provider = type(self._fallback).__name__
        async for chunk in self._fallback.synthesize(text, voice_id=resolved_voice):
            yield chunk


class OpenAITTSProvider(TTSProvider):
    def __init__(self):
        import openai
        self.client = openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

    async def synthesize(self, text: str, voice_id: Optional[str] = None) -> AsyncIterator[bytes]:
        try:
            async with self.client.audio.speech.with_streaming_response.create(
                model="tts-1",
                voice="nova",
                input=text,
                response_format="mp3",
            ) as response:
                async for chunk in response.iter_bytes(chunk_size=4096):
                    yield chunk
                return
        except Exception as e:
            logger.warning("OpenAI speech unavailable (%s)", type(e).__name__)
            raise


class MockTTSProvider(TTSProvider):
    async def synthesize(self, text: str, voice_id: Optional[str] = None) -> AsyncIterator[bytes]:
        fixture = os.environ.get('VIVAAI_TEST_TTS_FILE')
        if settings.APP_ENV == 'test' and fixture:
            from pathlib import Path
            data = await asyncio.to_thread(Path(fixture).read_bytes)
            for offset in range(0, len(data), 1024):
                yield data[offset:offset + 1024]
                await asyncio.sleep(.06)
            return
        sample_rate = 16000
        duration = 0.5
        num_samples = int(sample_rate * duration)
        data_size = num_samples * 2
        header = struct.pack(
            "<4sI4s4sIHHIIHH4sI",
            b"RIFF", 36 + data_size, b"WAVE",
            b"fmt ", 16, 1, 1,
            sample_rate, sample_rate * 2, 2, 16,
            b"data", data_size,
        )
        samples = bytes(data_size)
        if settings.APP_ENV == 'test' and os.environ.get('VIVAAI_TEST_TONE') == '1':
            import math
            samples = b''.join(struct.pack('<h', round(5000 * math.sin(2 * math.pi * 880 * i / sample_rate))) for i in range(num_samples))
        yield bytes(header) + samples


def get_tts_provider(voice_id: Optional[str] = None) -> TTSProvider:
    if settings.MOCK_MODE and not settings.IS_PRODUCTION:
        return MockTTSProvider()
    provider = settings.TTS_PROVIDER.lower()

    if provider == "elevenlabs":
        logger.info(f"Using ElevenLabs TTS provider ({voice_id or settings.ELEVENLABS_VOICE_ID})")
        return ElevenLabsTTSProvider(voice_id=voice_id)

    if provider == "deepgram":
        logger.info("Using Deepgram Aura TTS provider (aura-asteria-en)")
        return DeepgramTTSProvider()

    if provider == "openai":
        logger.info("Using OpenAI TTS provider")
        return OpenAITTSProvider()

    if provider in ("system", "say", "local"):
        logger.info("Using System Natural Voice TTS provider (Daniel @ 170wpm)")
        return SystemSayTTSProvider()

    raise RuntimeError(f"Unsupported TTS provider: {provider}")
