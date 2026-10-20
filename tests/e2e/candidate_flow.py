"""Isolated real-browser interview regression with synthetic microphone audio.

Run: .venv/bin/python tests/e2e/candidate_flow.py
Requires: playwright==1.56.0 and Google Chrome (or PLAYWRIGHT_CHROME).
Default mode uses mock providers. Pass --real-providers to use configured paid providers
with synthetic speech and an isolated database. The user's microphone and real data are never used.
"""
import asyncio
import base64
import uuid
import io
import json
import math
import os
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import wave
from pathlib import Path
import httpx
from playwright.async_api import async_playwright, expect

expect.set_options(timeout=20000)

ROOT = Path(__file__).resolve().parents[2]
PYTHON = ROOT / '.venv/bin/python'
NODE = ROOT / 'node_modules/.bin/next'
FULL = '--full-duration' in sys.argv
REAL = '--real-providers' in sys.argv or FULL
ARTIFACTS = ROOT / 'test-results' / ('candidate-full-duration' if FULL else 'candidate-flow-real' if REAL else 'candidate-flow')


async def wait_for_server(url, processes):
    async with httpx.AsyncClient() as client:
        for _ in range(120):
            if any(process.poll() is not None for process in processes):
                raise RuntimeError('A test server exited; inspect test-results/candidate-flow/*.log')
            try:
                if (await client.get(url, timeout=2)).status_code < 500:
                    return
            except httpx.HTTPError:
                pass
            await asyncio.sleep(.5)
    raise RuntimeError(f'Test server did not start: {url}')


async def poll(callback, check, timeout=30):
    for _ in range(int(timeout * 4)):
        value = await callback()
        if check(value): return value
        await asyncio.sleep(.25)
    raise AssertionError(f'Expected condition was not reached; last value: {value}')


async def main():
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    for name in ('failure.png', 'failure.txt'):
        (ARTIFACTS / name).unlink(missing_ok=True)
    (ARTIFACTS / 'result.json').write_text(json.dumps({'passed': False, 'status': 'running'}))
    for port in [13000, 13001, 18000]:
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=.2):
                raise RuntimeError(f'Test port {port} is occupied; no existing service will be stopped.')
        except (ConnectionRefusedError, TimeoutError):
            pass
    processes, logs = [], []
    with tempfile.TemporaryDirectory(prefix='vivaai-e2e-') as directory:
        sample = Path(directory) / 'synthetic-microphone.wav'
        with wave.open(str(sample), 'wb') as output:
            output.setparams((1, 2, 48000, 0, 'NONE', 'not compressed'))
            output.writeframes(b''.join(struct.pack('<h', round(3000 * math.sin(2 * math.pi * 440 * index / 48000))) for index in range(48000 * 30)))
        env = {**os.environ, 'APP_ENV': 'test', 'MOCK_MODE': 'true', 'LLM_PROVIDER': 'mock', 'DEMO_MODE': 'true',
            'SECRET_KEY': 'isolated-e2e-secret-used-only-in-disposable-test-processes', 'SCORING_WORKER_ENABLED': 'false', 'COOKIE_SECURE': 'false', 'COOKIE_DOMAIN': '', 'COOKIE_SAMESITE': 'lax',
            'DATABASE_URL': f'sqlite+aiosqlite:///{directory}/test.db', 'AUDIO_LOCAL_DIR': f'{directory}/audio',
            'API_INTERNAL_URL': 'http://127.0.0.1:18000', 'NEXT_PUBLIC_WS_URL': 'ws://127.0.0.1:18000',
            'NEXT_PUBLIC_API_URL': 'http://127.0.0.1:18000', 'NEXT_PUBLIC_FACULTY_URL': 'http://127.0.0.1:13001',
            'NEXT_PUBLIC_STUDENT_URL': 'http://127.0.0.1:13000', 'NEXT_PUBLIC_MOCK_MODE': 'false',
            'NEXT_BUILD_DIR': '.next-e2e', 'CORS_ORIGINS': 'http://127.0.0.1:13000,http://127.0.0.1:13001',
            'ELEVENLABS_API_KEY': '', 'DEEPGRAM_API_KEY': '', 'OPENAI_API_KEY': '', 'ANTHROPIC_API_KEY': ''}
        if REAL:
            from dotenv import dotenv_values
            configured = {key: value for key, value in dotenv_values(ROOT / '.env').items() if value is not None}
            for key in ['LLM_PROVIDER', 'LLM_FAST_MODEL', 'LLM_STRONG_MODEL', 'OPENAI_BASE_URL',
                        'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID',
                        'TTS_PROVIDER', 'DEEPGRAM_API_KEY', 'DEEPGRAM_STT_MODEL', 'DEEPGRAM_VOICE_MODEL']:
                if key in os.environ or key in configured:
                    env[key] = os.environ.get(key, configured.get(key, ''))
            env['MOCK_MODE'] = 'false'
            assert env['LLM_PROVIDER'] != 'mock', 'Configure a real LLM provider first'
            subprocess.run([str(PYTHON), str(ROOT / 'tests/e2e/real_provider_fixture.py'), str(sample),
                str(ARTIFACTS / 'providers.json')], cwd=ROOT / 'backend', env=env, check=True)
        try:
            # An empty-database migration is part of the flow, before application startup.
            subprocess.run([str(ROOT / '.venv/bin/alembic'), 'upgrade', 'head'], cwd=ROOT / 'backend', env=env, check=True)
            commands = [([str(PYTHON), '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '18000'], ROOT / 'backend', 'backend'),
                ([str(NODE), 'dev', '--webpack', '-p', '13000', '--hostname', '127.0.0.1'], ROOT / 'apps/student-web', 'student'),
                ([str(NODE), 'dev', '--webpack', '-p', '13001', '--hostname', '127.0.0.1'], ROOT / 'apps/faculty-web', 'faculty')]
            for command, cwd, name in commands:
                log = open(ARTIFACTS / f'{name}.log', 'w'); logs.append(log)
                processes.append(subprocess.Popen(command, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True))
            await wait_for_server('http://127.0.0.1:18000/health', processes)
            await wait_for_server('http://127.0.0.1:13000/login', processes)
            await wait_for_server('http://127.0.0.1:13001/login', processes)
            async with async_playwright() as playwright:
                browser = await playwright.chromium.launch(executable_path=os.environ.get('PLAYWRIGHT_CHROME', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
                    headless=not FULL, args=['--disable-gpu', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
                        f'--use-file-for-fake-audio-capture={sample}', '--autoplay-policy=no-user-gesture-required'])
                context = await asyncio.wait_for(browser.new_context(viewport={'width': 1280, 'height': 900}, permissions=['microphone']), timeout=45)
                context.set_default_timeout(20000)
                context.set_default_navigation_timeout(30000)
                await context.tracing.start(screenshots=True, snapshots=True)
                if REAL and not FULL:
                    await context.add_init_script("""(() => {
                      const Original = window.WebSocket;
                      window.__interviewEvents = [];
                      window.WebSocket = class extends Original {
                        constructor(...args) {
                          super(...args);
                          if (String(args[0]).includes('/ws/')) {
                            window.__interviewSocket = this;
                            this.addEventListener('message', e => {
                              try {
                                const event = JSON.parse(e.data);
                                window.__interviewEvents.push(event);
                                if (event.type === 'ai_speaking' && !window.__testedInterruption) {
                                  window.__testedInterruption = true;
                                  setTimeout(() => this.send(JSON.stringify({type: 'barge_in'})), 50);
                                }
                              } catch {}
                            });
                          }
                        }
                      };
                    })();""")
                page = await context.new_page()
                errors = []
                visited = []
                page.on('request', lambda request: visited.append(request.url))
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.on('dialog', lambda dialog: asyncio.create_task(dialog.accept()))
                try:
                    if FULL:
                        from full_duration_flow import run
                        await run(page, context, env, ARTIFACTS, processes, logs)
                        return
                    await page.goto('http://127.0.0.1:13000/login')
                    await page.get_by_label('University ID', exact=True).fill('STU001')
                    await page.get_by_label('Password', exact=True).fill('student123')
                    async with page.expect_response(lambda response: response.url.endswith('/auth/login')) as login_event:
                        await page.get_by_role('button', name='Sign in to Student Portal').click()
                    login = await login_event.value
                    assert login.status == 200, await login.text()
                    assert 'access_token' not in await login.json()
                    await page.wait_for_url('**/interview')
                    cookies = await context.cookies()
                    assert any(cookie['name'] == 'vivaai_session_student' and cookie['httpOnly'] for cookie in cookies)
                    assert await page.evaluate("['vivaai_token','vivaai_user','vivaai_auth'].every(key => localStorage.getItem(key) === null)")
                    # The readiness UI exercises actual getUserMedia against Chrome's synthetic source.
                    await page.get_by_role('button', name='Enable & Test Microphone').click()
                    await expect(page.get_by_text('Microphone Calibrated & Active')).to_be_visible()
                    await page.get_by_role('button', name='Test Examiner Voice (ElevenLabs)', exact=True).click()
                    await expect(page.get_by_role('button', name='Test Examiner Voice (ElevenLabs)', exact=True)).to_be_enabled(timeout=20000)
                    await page.get_by_role('button', name='I heard the sound', exact=True).click()
                    await page.locator('#exam-consent').check()
                    await page.get_by_role('button', name='Enter Live Examination Room').click()
                    await page.wait_for_url('**/interview/*')
                    session_id = page.url.rsplit('/', 1)[1]
                    await expect(page.get_by_text('Live Connected', exact=True)).to_be_visible(timeout=20000)
                    manifest_url = f'http://127.0.0.1:13000/api/v1/sessions/{session_id}/recording'
                    async def manifest(): return await (await context.request.get(manifest_url)).json()
                    first = await poll(manifest, lambda data: data.get('chunk_count', 0) >= 3)
                    # Spoken capture and typed-answer delivery share one transcript; do not grade microphone noise.
                    answer = 'Processes isolate memory. Threads share process memory and need mutexes to protect shared state.'
                    if REAL:
                        # Real microphone -> browser MediaRecorder -> Deepgram draft -> candidate confirmation.
                        await page.get_by_role('button', name='Record with enhanced speech', exact=True).click()
                        await expect(page.get_by_role('button', name='Stop & review transcript', exact=True)).to_be_visible()
                        await asyncio.sleep(20)
                        await page.get_by_role('button', name='Stop & review transcript', exact=True).click()
                        box = page.locator('#candidate-text-answer')
                        await poll(box.input_value, lambda text: 'memory' in text.lower(), timeout=60)
                        answer = await box.input_value()
                        # Exercise a visible candidate correction, preserving the provider's original.
                        original_answer = answer
                        answer = answer.replace('mutexes', 'mutex locks')
                        if answer == original_answer:
                            answer += ' (candidate reviewed)'
                        await box.fill(answer)
                        await page.screenshot(path=str(ARTIFACTS / 'reviewable-speech-draft.png'), full_page=True)
                        # No student answer exists until the candidate confirms the draft.
                        before = await (await context.request.get(f'http://127.0.0.1:13000/api/v1/transcript/{session_id}')).json()
                        assert not any(t['speaker'] == 'student' for t in before)
                        await page.get_by_role('button', name='Confirm & Submit Answer', exact=True).click()
                    else:
                        await page.get_by_placeholder('Speak your answer naturally or type your response here... (Speech will stream in live)').fill(answer)
                        await asyncio.sleep(1)
                        await page.get_by_role('button', name='Confirm & Submit Answer', exact=True).click()
                    async def transcript(): return await (await context.request.get(f'http://127.0.0.1:13000/api/v1/transcript/{session_id}')).json()
                    def student_count(data):
                        turns = data if isinstance(data, list) else data.get('turns', [])
                        return sum(turn.get('speaker') == 'student' and turn.get('text') == answer for turn in turns)
                    if REAL:
                        spoken = await poll(transcript, lambda data: any(t.get('speaker') == 'student' and t.get('answer_label') for t in (data if isinstance(data, list) else data.get('turns', []))), timeout=90)
                        answer = next(t['text'] for t in (spoken if isinstance(spoken, list) else spoken['turns']) if t.get('speaker') == 'student')
                        assert 'memory' in answer.lower(), 'Real STT did not transcribe the synthetic answer'
                        turn = next(t for t in spoken if t['speaker'] == 'student')
                        assert turn['answer_metadata']['source'] == 'cloud_speech'
                        assert turn['answer_metadata']['reviewed'] is True
                        assert turn['answer_metadata']['corrected'] is True
                        assert turn['answer_metadata']['original_text'] == original_answer
                        assert turn['stt_words'] and turn['classifier_confidence'] is not None
                        await poll(lambda: page.evaluate('window.__interviewEvents'), lambda events: any(e.get('type') == 'audio' for e in events), timeout=60)
                        await poll(lambda: page.evaluate('window.__interviewEvents'), lambda events: any(e.get('type') == 'ai_interrupted' for e in events), timeout=10)
                    await poll(transcript, lambda data: student_count(data) == 1)
                    # Force an outage, persist pending audio locally, then recover by full page reload.
                    await context.set_offline(True)
                    await asyncio.sleep(2)
                    await context.set_offline(False)
                    await page.reload()
                    # Fresh page loads require a user gesture, unlike navigation from readiness.
                    await page.get_by_role('button', name='Begin Oral Examination').click(timeout=15000)
                    await expect(page.get_by_text('Live Connected', exact=True)).to_be_visible(timeout=20000)
                    restored = await poll(manifest, lambda data: len(data.get('captures', [])) >= 2 and data['chunk_count'] > first['chunk_count'])
                    assert all(not capture['missing_sequences'] for capture in restored['captures'])
                    assert student_count(await transcript()) == 1
                    await page.get_by_role('button', name='End Viva Early', exact=True).click()
                    await page.get_by_role('button', name='Finish & Submit', exact=True).click()
                    await expect(page.get_by_role('heading', name='Your viva has ended')).to_be_visible(timeout=30000)
                    # Restart the API before scoring. Queue entries, auth sessions and audio must survive.
                    queued = await context.request.get(f'http://127.0.0.1:13000/api/v1/sessions/{session_id}/scoring')
                    assert (await queued.json())['status'] == 'queued'
                    os.killpg(processes[0].pid, signal.SIGTERM)
                    processes[0].wait(timeout=10)
                    restart_log = open(ARTIFACTS / 'backend-restarted.log', 'w'); logs.append(restart_log)
                    processes[0] = subprocess.Popen(commands[0][0], cwd=commands[0][1], env=env,
                        stdout=restart_log, stderr=subprocess.STDOUT, start_new_session=True)
                    await wait_for_server('http://127.0.0.1:18000/health', processes)
                    scorer_log = open(ARTIFACTS / 'scorer.log', 'w'); logs.append(scorer_log)
                    processes.append(subprocess.Popen([str(PYTHON), '-m', 'app.workers.scoring_worker'], cwd=ROOT / 'backend',
                        env=env, stdout=scorer_log, stderr=subprocess.STDOUT, start_new_session=True))
                    await page.get_by_role('link', name='View my interviews and feedback').click()
                    await expect(page.get_by_role('heading', name='My interviews')).to_be_visible()
                    await page.get_by_role('button', name='View feedback', exact=True).click()
                    from evaluation_result import evaluation_result
                    scored = await evaluation_result(context, page, session_id, env)
                    (ARTIFACTS / 'score.json').write_text(json.dumps(scored, indent=2))
                    audio = await context.request.get(f'http://127.0.0.1:13000/api/v1/sessions/{session_id}/audio/stream', timeout=60000)
                    assert audio.status == 200
                    with wave.open(io.BytesIO(await audio.body()), 'rb') as recording:
                        assert recording.getnframes() > 16000
                    await page.screenshot(path=str(ARTIFACTS / 'candidate-feedback.png'), full_page=True)
                    # Faculty portal uses its own HttpOnly cookie and can review the complete recording.
                    faculty = await context.new_page()
                    faculty.on('pageerror', lambda error: errors.append(str(error)))
                    await faculty.goto('http://127.0.0.1:13001/login')
                    await faculty.get_by_label('Email', exact=False).fill('priya.sharma@university.edu')
                    await faculty.get_by_label('Password', exact=True).fill('faculty123')
                    await faculty.get_by_role('button', name='Sign in to Faculty Portal').click()
                    await faculty.wait_for_url('**/dashboard')
                    await faculty.goto(f'http://127.0.0.1:13001/review/{session_id}')
                    await expect(faculty.get_by_text(answer, exact=False).first).to_be_visible(timeout=30000)
                    await expect(faculty.locator('audio')).to_have_attribute('src', __import__('re').compile(r'^blob:'), timeout=30000)
                    await faculty.screenshot(path=str(ARTIFACTS / 'faculty-review.png'), full_page=True)
                    if scored.get('status') == 'review_required':
                        await faculty.get_by_label('Score (0–100)', exact=True).fill('76')
                        await faculty.get_by_label('Reason for adjustment', exact=True).fill('Synthetic test: faculty reviewed recording and rubric evidence.')
                        await faculty.get_by_role('button', name='Save adjustment', exact=True).click()
                        await poll(lambda: context.request.get(f'http://127.0.0.1:13000/api/v1/scores/{session_id}'), lambda response: response.status == 200)
                        await expect(page.get_by_text('76.0 / 100', exact=True)).to_be_visible(timeout=30000)
                        await expect(page.get_by_text('Faculty assessment, based on a review of your interview.', exact=True)).to_be_visible()
                        await expect(page.get_by_text('Synthetic test: faculty reviewed recording and rubric evidence.', exact=True)).to_be_visible()
                    identity = await context.request.get('http://127.0.0.1:13000/api/v1/auth/me')
                    assert (await identity.json())['role'] == 'student'
                    # The browser gateway rejects cross-origin state-changing requests.
                    blocked = await context.request.post('http://127.0.0.1:13000/api/v1/auth/logout', headers={'Origin': 'https://untrusted.example', 'X-VivaAI-Request': '1'})
                    assert blocked.status == 403
                    logout = await context.request.post('http://127.0.0.1:13000/api/v1/auth/logout', headers={'X-VivaAI-Request': '1'})
                    assert logout.status == 200
                    assert (await context.request.get('http://127.0.0.1:13000/api/v1/auth/me')).status == 401
                    # A second candidate completes a mobile interview without microphone permission.
                    mobile_context = await browser.new_context(viewport={'width': 390, 'height': 844})
                    mobile = await mobile_context.new_page()
                    mobile.on('pageerror', lambda error: errors.append(str(error)))
                    await mobile.goto('http://127.0.0.1:13000/login')
                    await mobile.get_by_label('University ID', exact=True).fill('STU002')
                    await mobile.get_by_label('Password', exact=True).fill('student123')
                    await mobile.get_by_role('button', name='Sign in to Student Portal').click()
                    await mobile.wait_for_url('**/interview')
                    await mobile.get_by_role('checkbox', name=__import__('re').compile('Use typed answers')).check()
                    await mobile.locator('#exam-consent').check()
                    await mobile.get_by_role('button', name='Enter Live Examination Room').click()
                    await mobile.wait_for_url('**/interview/*')
                    await expect(mobile.get_by_text('Live Connected', exact=True)).to_be_visible()
                    mobile_id = mobile.url.rsplit('/', 1)[1]
                    await mobile.get_by_placeholder('Speak your answer naturally or type your response here... (Speech will stream in live)').fill(answer)
                    await asyncio.sleep(1)
                    await mobile.get_by_role('button', name='Confirm & Submit Answer', exact=True).click()
                    async def mobile_transcript(): return await (await mobile_context.request.get(f'http://127.0.0.1:13000/api/v1/transcript/{mobile_id}')).json()
                    await poll(mobile_transcript, lambda data: student_count(data) == 1)
                    await mobile.get_by_role('button', name='End Viva Early', exact=True).click()
                    await mobile.get_by_role('button', name='Finish & Submit', exact=True).click()
                    await expect(mobile.get_by_role('heading', name='Your viva has ended')).to_be_visible()
                    mobile_audio = await mobile_context.request.get(f'http://127.0.0.1:13000/api/v1/sessions/{mobile_id}/recording')
                    assert (await mobile_audio.json())['chunk_count'] == 0
                    await mobile.get_by_role('link', name='View my interviews and feedback').click()
                    await mobile.get_by_role('button', name='View feedback', exact=True).click()
                    await evaluation_result(mobile_context, mobile, mobile_id, env)
                    await mobile.screenshot(path=str(ARTIFACTS / 'mobile-feedback.png'), full_page=True)
                    await mobile_context.close()
                    assert not any('password=' in url for url in visited)
                    assert not errors, errors
                    (ARTIFACTS / 'result.json').write_text(json.dumps({'passed': True, 'real_providers': REAL, 'backend_audio_transcription': REAL, 'reviewable_cloud_speech': REAL, 'live_speech_interruption': REAL, 'session_id': session_id,
                        'captures_after_reload': len(restored['captures']), 'api_restart_before_scoring': True, 'recording_playback': True, 'mobile_typed_interview': True, 'browser_errors': errors}, indent=2))
                    print('PASS: sign-in, microphone readiness, answer, offline recovery, reload, recording continuity, completion, API restart, separate scoring worker, feedback, faculty recording playback, CSRF, logout and mobile typed interview')
                except Exception:
                    (ARTIFACTS / 'result.json').write_text(json.dumps({'passed': False, 'status': 'failed'}))
                    await page.screenshot(path=str(ARTIFACTS / 'failure.png'), full_page=True)
                    (ARTIFACTS / 'failure.txt').write_text(await page.locator('body').inner_text())
                    raise
                finally:
                    await context.tracing.stop(path=str(ARTIFACTS / 'trace.zip'))
                    await browser.close()
        finally:
            for process in processes:
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGTERM)
            for process in processes:
                try: process.wait(timeout=10)
                except subprocess.TimeoutExpired: os.killpg(process.pid, signal.SIGKILL)
            for log in logs: log.close()


async def entrypoint():
    try:
        await main()
    except Exception:
        result_file = ARTIFACTS / 'result.json'
        result = json.loads(result_file.read_text()) if result_file.exists() else {}
        result.update({'passed': False, 'status': 'failed', 'real_providers': REAL})
        result_file.write_text(json.dumps(result, indent=2))
        raise


if __name__ == '__main__':
    asyncio.run(entrypoint())
