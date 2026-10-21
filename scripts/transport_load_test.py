"""Isolated HTTP/WebSocket/audio-persistence load probe with MOCK speech/LLM providers.

This measures actual server transport + SQLite contention, not production
speech quality or audible end-of-speech latency. Never targets existing data.
Run: .venv/bin/python scripts/transport_load_test.py --levels 50 100 150 --output results.json
"""
import argparse
import asyncio
import base64
import io
import json
import os
from pathlib import Path
import platform
import signal
import socket
import subprocess
import sys
import tempfile
import time
import uuid
import wave

import httpx
import psutil
import websockets

ROOT = Path(__file__).resolve().parents[1]


def percentile(values, q):
    if not values:
        return None
    values = sorted(values)
    return round(values[max(0, min(len(values) - 1, int(len(values) * q + .999) - 1))], 2)


async def read_until(ws, kind):
    async def read():
        while True:
            message = json.loads(await ws.recv())
            if message.get('type') == 'error':
                raise RuntimeError(message.get('message', 'Interview error'))
            if message.get('type') in kind:
                return message
    return await asyncio.wait_for(read(), timeout=60)


async def provision(count):
    from app.db.init_db import init_db
    from app.db.session import AsyncSessionLocal
    from app.models.models import User, UserRole
    from app.core.security import hash_password
    from app.services.auth_sessions import issue_session
    await init_db()
    password = hash_password('synthetic-load-only-password')
    tokens = []
    async with AsyncSessionLocal() as db:
        users = [User(id=uuid.uuid4(), name=f'Synthetic load bot {i}', student_id=f'LOAD-{i}',
            hashed_password=password, role=UserRole.student, is_active=True) for i in range(count)]
        db.add_all(users)
        await db.commit()
        for user in users:
            tokens.append(await issue_session(db, user))
    return tokens


async def run_batch(tokens, base, turns, audio, server_process):
    gate = asyncio.Event()
    state = {'arrived': 0, 'active': 0, 'peak': 0}
    latencies, errors, outcomes, memory = [], [], [], []
    started = time.perf_counter()
    cpu_before = server_process.cpu_times()
    sampling = True

    async def sample():
        while sampling:
            try: memory.append(server_process.memory_info().rss)
            except psutil.Error: return
            await asyncio.sleep(.1)

    def arrive():
        state['arrived'] += 1
        if state['arrived'] == len(tokens): gate.set()

    async def bot(index, token):
        arrived = connected = False
        stage = 'setup'
        try:
            async with httpx.AsyncClient(base_url=base, headers={'Authorization': f'Bearer {token}'}, trust_env=False, timeout=60) as client:
                created = await client.post('/api/v1/sessions', json={'viva_config_id': '00000000-0000-0000-0000-000000000001', 'consent_given': True})
                created.raise_for_status()
                session = created.json()['id']
                ticket = await client.post(f'/api/v1/sessions/{session}/ws-ticket')
                ticket.raise_for_status()
                url = base.replace('http:', 'ws:') + f'/ws/interview/{session}?ticket={ticket.json()["ticket"]}'
                stage = 'connect'
                async with websockets.connect(url, max_size=4 * 1024 * 1024, open_timeout=60, ping_timeout=60) as ws:
                    state['active'] += 1; connected = True
                    state['peak'] = max(state['peak'], state['active'])
                    await read_until(ws, {'ai_done_speaking'})
                    arrive(); arrived = True
                    await asyncio.wait_for(gate.wait(), timeout=90)
                    for turn in range(turns):
                        stage = 'recording_upload'
                        capture, chunk = uuid.uuid4(), uuid.uuid4()
                        stored = await client.put(f'/api/v1/sessions/{session}/recording/chunks/{chunk}',
                            params={'capture_id': str(capture), 'sequence': 0, 'start_secs': turn * 2},
                            content=audio, headers={'Content-Type': 'audio/wav'})
                        stored.raise_for_status()
                        stage = 'mock_speech_turn'
                        begin = time.perf_counter()
                        await ws.send(json.dumps({'type': 'audio_data', 'answer_id': str(uuid.uuid4()),
                            'data': base64.b64encode(audio).decode(), 'duration_secs': 2}))
                        await read_until(ws, {'audio'})
                        latencies.append((time.perf_counter() - begin) * 1000)
                        await read_until(ws, {'ai_done_speaking'})
                    stage = 'completion'
                    await ws.send(json.dumps({'type': 'end_session'}))
                    await read_until(ws, {'session_completed', 'interview_ended'})
                manifest = await client.get(f'/api/v1/sessions/{session}/recording')
                manifest.raise_for_status()
                assert manifest.json()['chunk_count'] == turns
                outcomes.append({'bot': index, 'completed': True, 'recording_chunks': turns})
        except Exception as exc:
            errors.append({'bot': index, 'stage': stage, 'type': type(exc).__name__})
            outcomes.append({'bot': index, 'completed': False})
        finally:
            if connected: state['active'] -= 1
            if not arrived: arrive()

    sampler = asyncio.create_task(sample())
    await asyncio.gather(*(bot(index, token) for index, token in enumerate(tokens)))
    sampling = False
    await sampler
    duration = time.perf_counter() - started
    cpu_after = server_process.cpu_times()
    cpu_seconds = cpu_after.user + cpu_after.system - cpu_before.user - cpu_before.system
    return {'requested_concurrency': len(tokens), 'peak_connected': state['peak'], 'turns_per_bot': turns,
        'completed': sum(item['completed'] for item in outcomes), 'dropped': len(errors),
        'duration_seconds': round(duration, 2), 'turn_samples': len(latencies),
        'mock_audio_response_p50_ms': percentile(latencies, .5), 'mock_audio_response_p95_ms': percentile(latencies, .95),
        'bot_error_rate': len(errors) / len(tokens), 'server_peak_rss_mib': round(max(memory, default=0) / 1024 ** 2, 2),
        'server_cpu_seconds': round(cpu_seconds, 2), 'server_average_cpu_percent_one_core': round(cpu_seconds / duration * 100, 2),
        'provider_error_rates': {'stt': None, 'tts': None, 'llm': None},
        'provider_error_note': 'Providers are mocked. No real provider availability or GPU measurement.',
        'errors': errors, 'outcomes': outcomes}


async def main(args):
    with tempfile.TemporaryDirectory(prefix='vivaai-transport-load-') as directory:
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0)); port = probe.getsockname()[1]
        env = {**os.environ, 'APP_ENV': 'test', 'MOCK_MODE': 'true', 'LLM_PROVIDER': 'mock',
            'DATABASE_URL': f'sqlite+aiosqlite:///{directory}/load.db', 'AUDIO_LOCAL_DIR': f'{directory}/audio',
            'SECRET_KEY': 'synthetic-transport-load-secret-never-use-in-production', 'COOKIE_SECURE': 'false',
            'SCORING_WORKER_ENABLED': 'true', 'NEXT_PUBLIC_WS_URL': f'ws://127.0.0.1:{port}',
            'ELEVENLABS_API_KEY': '', 'DEEPGRAM_API_KEY': '', 'OPENAI_API_KEY': '', 'ANTHROPIC_API_KEY': ''}
        os.environ.update(env)
        sys.path.insert(0, str(ROOT / 'backend'))
        tokens = await provision(sum(args.levels))
        from app.db.session import engine
        await engine.dispose()
        audio = io.BytesIO()
        with wave.open(audio, 'wb') as output:
            output.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            output.writeframes(bytes(16000 * 2 * 2))
        with open(Path(directory) / 'server.log', 'w') as log:
            process = subprocess.Popen([str(ROOT / '.venv/bin/python'), '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', str(port)],
                cwd=ROOT / 'backend', env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                base = f'http://127.0.0.1:{port}'
                async with httpx.AsyncClient(trust_env=False) as client:
                    for _ in range(120):
                        if process.poll() is not None: raise RuntimeError('Isolated server failed to start')
                        try:
                            if (await client.get(base + '/health/live')).status_code == 200: break
                        except httpx.HTTPError: pass
                        await asyncio.sleep(.25)
                    else: raise RuntimeError('Server startup timed out')
                results, offset = [], 0
                for count in args.levels:
                    print(f'Running {count} concurrent mock audio bots…', flush=True)
                    result = await run_batch(tokens[offset:offset + count], base, args.turns, audio.getvalue(), psutil.Process(process.pid))
                    results.append(result); offset += count
                    print({key: result[key] for key in ('requested_concurrency', 'peak_connected', 'completed', 'dropped', 'mock_audio_response_p95_ms')}, flush=True)
                output = {'scope': 'Local HTTP/WebSocket + audio upload + SQLite + mock STT/TTS/LLM; not production capacity proof',
                    'platform': platform.platform(), 'python': platform.python_version(), 'batches': results,
                    'breaking_point': next((item['requested_concurrency'] for item in results if item['dropped'] or (item['mock_audio_response_p95_ms'] or 0) >= 2500), None),
                    'breaking_point_note': 'First tested level with errors or mock response p95 >= 2500ms. Null means not reached in these levels; real speech remains unmeasured.'}
                Path(args.output).parent.mkdir(parents=True, exist_ok=True)
                Path(args.output).write_text(json.dumps(output, indent=2) + '\n')
            finally:
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGTERM)
                    try: process.wait(timeout=15)
                    except subprocess.TimeoutExpired: os.killpg(process.pid, signal.SIGKILL)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--levels', type=int, nargs='+', default=[50, 100, 150])
    parser.add_argument('--turns', type=int, default=3)
    parser.add_argument('--output', default='test-results/transport-load.json')
    options = parser.parse_args()
    if any(level < 1 for level in options.levels) or options.turns < 1:
        parser.error('Levels and turns must be positive')
    asyncio.run(main(options))
