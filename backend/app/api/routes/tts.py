import os
import subprocess
import tempfile
import hashlib
from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import Response

router = APIRouter(prefix="/tts", tags=["TTS"])

CACHE_DIR = os.path.join(tempfile.gettempdir(), "vivaai_py_tts_cache")
os.makedirs(CACHE_DIR, exist_ok=True)

@router.get("/synthesize")
async def synthesize_speech(
    text: str = Query(..., description="Text to synthesize into oral speech"),
    voice: str = Query("Samantha", description="Voice profile name"),
):
    text = text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    hash_key = hashlib.md5(f"{voice}_{text}".encode("utf-8")).hexdigest()
    cached_path = os.path.join(CACHE_DIR, f"{hash_key}.wav")

    if os.path.exists(cached_path):
        with open(cached_path, "rb") as f:
            audio_bytes = f.read()
        return Response(content=audio_bytes, media_type="audio/wav")

    say_path = "/usr/bin/say"
    if os.path.exists(say_path):
        temp_out = os.path.join(CACHE_DIR, f"temp_{hash_key}.wav")
        try:
            subprocess.run(
                [say_path, "-v", voice, "-o", temp_out, "--data-format=LEI16@22050", text],
                check=True,
                timeout=15,
            )
            if os.path.exists(temp_out):
                os.replace(temp_out, cached_path)
                with open(cached_path, "rb") as f:
                    audio_bytes = f.read()
                return Response(content=audio_bytes, media_type="audio/wav")
        except Exception as e:
            if os.path.exists(temp_out):
                os.remove(temp_out)
            raise HTTPException(status_code=500, detail=f"TTS synthesis failed: {e}")

    # Fallback to MockTTSProvider
    from app.services.tts_provider import MockTTSProvider
    provider = MockTTSProvider()
    chunks = []
    async for chunk in provider.synthesize(text):
        chunks.append(chunk)
    audio_bytes = b"".join(chunks)
    return Response(content=audio_bytes, media_type="audio/wav")
