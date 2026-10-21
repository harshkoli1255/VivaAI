import os
import subprocess
import tempfile
import hashlib
import logging
from fastapi import APIRouter, Query, HTTPException, Depends
from app.core.security import get_current_user
from fastapi.responses import Response

from app.services.tts_provider import get_tts_provider

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tts", tags=["TTS"])

CACHE_DIR = os.path.join(tempfile.gettempdir(), "vivaai_py_tts_cache")
os.makedirs(CACHE_DIR, exist_ok=True)


@router.get("/synthesize")
async def synthesize_speech(
    text: str = Query(..., min_length=1, max_length=5000, description="Text to synthesize into oral speech"),
    voice: str = Query("alice", max_length=128, description="Voice profile name or ElevenLabs voice ID"),
    current: dict = Depends(get_current_user),
):
    text = text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    provider = get_tts_provider(voice_id=voice)
    provider_name = type(provider).__name__
    if os.environ.get("VIVAAI_TEST_TONE") == "1":
        provider_name += "-test-tone"
    hash_key = hashlib.md5(f"{provider_name}_{voice}_{text}".encode("utf-8")).hexdigest()

    cached_mp3 = os.path.join(CACHE_DIR, f"{hash_key}.mp3")
    cached_wav = os.path.join(CACHE_DIR, f"{hash_key}.wav")

    if os.path.exists(cached_mp3):
        with open(cached_mp3, "rb") as f:
            return Response(content=f.read(), media_type="audio/mpeg")
    if os.path.exists(cached_wav):
        with open(cached_wav, "rb") as f:
            return Response(content=f.read(), media_type="audio/wav")

    # 1. Synthesize via primary provider (ElevenLabs Flash v2.5 / Deepgram / SystemSay)
    try:
        chunks = []
        async for chunk in provider.synthesize(text, voice_id=voice):
            chunks.append(chunk)
        if chunks:
            audio_bytes = b"".join(chunks)
            # Detect audio format (RIFF = WAV, otherwise MPEG)
            is_wav = audio_bytes.startswith(b"RIFF")
            media_type = "audio/wav" if is_wav else "audio/mpeg"
            target_cache = cached_wav if is_wav else cached_mp3
            with open(target_cache, "wb") as f:
                f.write(audio_bytes)
            return Response(content=audio_bytes, media_type=media_type)
    except Exception as e:
        logger.warning(f"Configured TTS provider ({provider_name}) failed: {e}. Falling back to Deepgram Aura.")

    # 2. Neural Cloud Fallback: Deepgram Aura
    try:
        from app.services.tts_provider import DeepgramTTSProvider
        dg = DeepgramTTSProvider()
        chunks = []
        async for chunk in dg.synthesize(text):
            chunks.append(chunk)
        if chunks:
            audio_bytes = b"".join(chunks)
            with open(cached_mp3, "wb") as f:
                f.write(audio_bytes)
            return Response(content=audio_bytes, media_type="audio/mpeg")
    except Exception as dg_err:
        logger.warning(f"Deepgram Aura fallback failed: {dg_err}")

    raise HTTPException(status_code=503, detail="Neural TTS service temporarily unavailable")
