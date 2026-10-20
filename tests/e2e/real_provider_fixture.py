"""Prepare synthetic speech and verify real models without logging credentials."""
import asyncio
import json
import subprocess
import sys
import time
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from app.core.config import settings
from app.services.llm_provider import get_llm_provider
from app.services.tts_provider import get_tts_provider
import imageio_ffmpeg


async def main():
    assert not settings.MOCK_MODE and settings.LLM_PROVIDER != 'mock'
    llm = get_llm_provider()
    plain = await llm.chat([{'role': 'user', 'content': 'Reply with the single word ready.'}], max_tokens=128)
    assert 'ready' in plain.lower(), 'Real fast model returned no usable output'
    structured = await llm.chat_json([{'role': 'user', 'content': 'Return a JSON object with ready set to true.'}], max_tokens=512)
    assert structured.get('ready') is True, 'Real scoring model JSON support failed'
    tts = get_tts_provider()
    assert type(tts).__name__ not in ('MockTTSProvider', 'SystemSayTTSProvider')
    text = ('Processes isolate memory. Threads share process memory and need mutexes to protect shared state. '
            f'This is a synthetic interview test number {int(time.time()) % 10000}.')
    audio = b''.join([chunk async for chunk in tts.synthesize(text)])
    assert len(audio) > 1000, 'Cloud speech provider returned no audio'
    sample = Path(sys.argv[1])
    encoded = sample.with_suffix('.mp3')
    encoded.write_bytes(audio)
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-y', '-i', str(encoded),
                    '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', str(sample)], check=True)
    # Give Chrome's speech endpointer an ambient baseline and a real pause.
    with wave.open(str(sample), 'rb') as recording:
        params = recording.getparams()
        frames = recording.readframes(recording.getnframes())
    with wave.open(str(sample), 'wb') as recording:
        recording.setparams(params)
        recording.writeframes(bytes(48000 * 2 * 2) + frames + bytes(48000 * 2 * 3))
    Path(sys.argv[2]).write_text(json.dumps({'llm': type(llm).__name__, 'fast_model': settings.LLM_FAST_MODEL,
        'scoring_model': settings.LLM_STRONG_MODEL, 'tts': type(tts).__name__,
        'tts_effective': getattr(tts, 'last_provider', type(tts).__name__),
        'stt': 'DeepgramSTTProvider', 'mock_mode': False, 'synthetic_input_only': True}, indent=2))
    print('Real LLM, structured output and cloud speech fixture verified.')


if __name__ == '__main__':
    asyncio.run(main())
