"""Provider failure and payload contracts; live calls belong to the opt-in E2E."""
from unittest.mock import AsyncMock

import httpx
import pytest

from app.core.config import settings
from app.services.stt_provider import DeepgramSTTProvider, get_stt_provider
from app.services.tts_provider import DeepgramTTSProvider, get_tts_provider
from app.services.llm_provider import OpenAIProvider
from app.services.scorer import _build_transcript_text
from app.core.logging import RedactCredentials
import logging
import uuid
from types import SimpleNamespace
from contextlib import asynccontextmanager


async def audio_chunks():
    yield b'RIFF'
    yield b'synthetic-wave'


@pytest.mark.asyncio
async def test_stt_submits_complete_container_and_returns_final_transcript(monkeypatch):
    def handle(request):
        assert request.content == b'RIFFsynthetic-wave'
        assert request.url.params['model'] == settings.DEEPGRAM_STT_MODEL
        assert request.headers['content-type'] == 'application/octet-stream'
        return httpx.Response(200, json={'results': {'channels': [{'alternatives': [
            {'transcript': 'Threads share memory.', 'confidence': .98, 'words': []}
        ]}]}})
    client_type = httpx.AsyncClient
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kwargs: client_type(transport=httpx.MockTransport(handle), **kwargs))
    results = [result async for result in DeepgramSTTProvider().transcribe_stream(audio_chunks())]
    assert len(results) == 1 and results[0].is_final
    assert results[0].text == 'Threads share memory.'


@pytest.mark.asyncio
async def test_stt_provider_failure_does_not_invent_a_transcript(monkeypatch):
    client_type = httpx.AsyncClient
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kwargs: client_type(
        transport=httpx.MockTransport(lambda request: httpx.Response(401)), **kwargs))
    with pytest.raises(httpx.HTTPStatusError):
        [result async for result in DeepgramSTTProvider().transcribe_stream(audio_chunks())]


def test_real_stt_without_credentials_cannot_select_mock(monkeypatch):
    monkeypatch.setattr(settings, 'MOCK_MODE', False)
    monkeypatch.setattr(settings, 'DEEPGRAM_API_KEY', '')
    with pytest.raises(RuntimeError, match='DEEPGRAM_API_KEY'):
        get_stt_provider()


def test_explicit_tts_provider_wins_over_other_configured_keys(monkeypatch):
    monkeypatch.setattr(settings, 'MOCK_MODE', False)
    monkeypatch.setattr(settings, 'TTS_PROVIDER', 'deepgram')
    monkeypatch.setattr(settings, 'ELEVENLABS_API_KEY', 'configured-other-provider')
    assert isinstance(get_tts_provider(), DeepgramTTSProvider)
    monkeypatch.setattr(settings, 'TTS_PROVIDER', 'invalid')
    with pytest.raises(RuntimeError, match='Unsupported TTS'):
        get_tts_provider()


@pytest.mark.asyncio
async def test_real_llm_outage_is_not_replaced_with_mock_questions():
    provider = OpenAIProvider()
    provider.client.chat.completions.create = AsyncMock(side_effect=RuntimeError('provider outage'))
    with pytest.raises(RuntimeError, match='provider outage'):
        await provider.chat([{'role': 'user', 'content': 'Ask a question'}])


def test_scoring_distinguishes_examiner_from_student():
    text = _build_transcript_text([
        {'speaker': 'interviewer', 'turn_index': 0, 'text': 'Explain threads.'},
        {'speaker': 'student', 'turn_index': 1, 'text': 'Threads share memory.'},
    ])
    assert '[Turn 0] AI: Explain threads.' in text
    assert '[Turn 1] STUDENT: Threads share memory.' in text


def test_websocket_tickets_are_redacted_from_server_logs():
    record = logging.LogRecord('uvicorn.error', logging.INFO, '', 0,
        'WebSocket %s accepted', ('/ws/interview/id?ticket=private-token&voice=alice',), None)
    RedactCredentials().filter(record)
    assert 'private-token' not in record.getMessage()
    assert 'ticket=[redacted]&voice=alice' in record.getMessage()


def test_typed_session_does_not_initialize_unavailable_stt(monkeypatch):
    from app.api.routes import websocket_interview as live
    monkeypatch.setattr(live, 'get_stt_provider', lambda: (_ for _ in ()).throw(RuntimeError('STT missing')))
    interview = live.InterviewSession(None, str(uuid.uuid4()), uuid.uuid4(), {}, [])
    assert interview.stt is None


@pytest.mark.asyncio
async def test_openai_speech_uses_browser_decodable_audio(monkeypatch):
    import openai
    from app.services.tts_provider import OpenAITTSProvider
    async def iter_bytes(**kwargs):
        yield b'encoded-mp3'
    @asynccontextmanager
    async def create(**kwargs):
        assert kwargs['response_format'] == 'mp3'
        yield SimpleNamespace(iter_bytes=iter_bytes)
    monkeypatch.setattr(openai, 'AsyncOpenAI', lambda **kwargs: SimpleNamespace(audio=SimpleNamespace(
        speech=SimpleNamespace(with_streaming_response=SimpleNamespace(create=create)))))
    assert b''.join([chunk async for chunk in OpenAITTSProvider().synthesize('Test')]) == b'encoded-mp3'


@pytest.mark.asyncio
async def test_rejected_speech_credentials_use_fallback_without_repeated_requests(monkeypatch):
    from app.services.tts_provider import ElevenLabsTTSProvider
    monkeypatch.setattr(settings, 'ELEVENLABS_API_KEY', 'synthetic-rejected-key')
    monkeypatch.setattr(ElevenLabsTTSProvider, '_blocked_until', {})
    requests = []
    def handle(request):
        requests.append(request)
        return httpx.Response(401, json={'detail': {'code': 'quota_exceeded'}})
    client_type = httpx.AsyncClient
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kwargs: client_type(
        transport=httpx.MockTransport(handle), **kwargs))
    async def fallback(*args, **kwargs):
        yield b'fallback-audio'
    first = ElevenLabsTTSProvider()
    first._fallback = SimpleNamespace(synthesize=fallback)
    assert b''.join([chunk async for chunk in first.synthesize('Unique rejected utterance')]) == b'fallback-audio'
    second = ElevenLabsTTSProvider()
    second._fallback = SimpleNamespace(synthesize=fallback)
    assert b''.join([chunk async for chunk in second.synthesize('Another new utterance')]) == b'fallback-audio'
    assert len(requests) == 1
    assert second.last_provider != 'ElevenLabsTTSProvider'


@pytest.mark.asyncio
async def test_voice_cooldown_still_uses_valid_cached_speech(monkeypatch, tmp_path):
    import hashlib
    import time
    from app.services import tts_provider as speech
    monkeypatch.setattr(settings, 'ELEVENLABS_API_KEY', 'synthetic-cache-key')
    fingerprint = hashlib.sha256(settings.ELEVENLABS_API_KEY.encode()).hexdigest()
    monkeypatch.setattr(speech.ElevenLabsTTSProvider, '_blocked_until', {fingerprint: time.monotonic() + 300})
    monkeypatch.setattr(speech, 'CACHE_DIR', str(tmp_path))
    text, voice = 'Existing cached utterance', 'voice-reference'
    digest = hashlib.md5(f'eleven_{voice}_{text}'.encode()).hexdigest()
    (tmp_path / f'{digest}.mp3').write_bytes(b'existing-encoded-speech')
    provider = speech.ElevenLabsTTSProvider(voice_id=voice)
    async def forbidden(*args, **kwargs):
        raise AssertionError('Cached speech must not call the paid fallback')
        yield b''
    provider._fallback = SimpleNamespace(synthesize=forbidden)
    assert b''.join([chunk async for chunk in provider.synthesize(text)]) == b'existing-encoded-speech'
    assert provider.last_provider == 'ElevenLabsTTSProvider'
