"""Unaccelerated 15-minute interview and native Chrome recognition observations."""
import asyncio
import io
import json
import subprocess
import time
import wave
import os
import sqlite3
from pathlib import Path
from playwright.async_api import expect

ROOT = Path(__file__).resolve().parents[2]


async def run(page, context, env, artifacts, processes, logs):
    browser_errors = []
    page.on('pageerror', lambda error: browser_errors.append(str(error)))
    await context.add_init_script("""(() => {
      window.__voiceEvents = []; window.__roomEvents = [];
      const Native = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (Native) {
        function Observed(...args) {
          const instance = new Native(...args);
          for (const type of ['start','end','error','result','audiostart','soundstart','speechstart']) {
            instance.addEventListener(type, event => {
              window.__voiceEvents.push({type, at: Date.now(), error: event.error,
                text: type === 'result' ? Array.from(event.results).map(r => r[0].transcript).join(' ') : undefined});
            });
          }
          return instance;
        }
        Observed.prototype = Native.prototype; Object.setPrototypeOf(Observed, Native);
        if (window.SpeechRecognition) window.SpeechRecognition = Observed;
        if (window.webkitSpeechRecognition) window.webkitSpeechRecognition = Observed;
      }
      const Socket = window.WebSocket;
      window.WebSocket = class extends Socket {
        constructor(...args) {
          super(...args);
          if (String(args[0]).includes('/ws/')) this.addEventListener('message', event => {
            try {
              const data = JSON.parse(event.data);
              if (data.type !== 'audio') window.__roomEvents.push({...data, observedAt: Date.now()});
            } catch {}
          });
        }
      };
    })();""")
    scorer_log = open(artifacts / 'scorer.log', 'w'); logs.append(scorer_log)
    processes.append(subprocess.Popen([str(ROOT / '.venv/bin/python'), '-m', 'app.workers.scoring_worker'],
        cwd=ROOT / 'backend', env=env, stdout=scorer_log, stderr=subprocess.STDOUT, start_new_session=True))
    await page.goto('http://127.0.0.1:13000/login')
    await page.get_by_label('University ID', exact=True).fill('STU001')
    await page.get_by_label('Password', exact=True).fill('student123')
    await page.get_by_role('button', name='Sign in to Student Portal').click()
    await page.wait_for_url('**/interview')
    await page.get_by_role('button', name='Enable & Test Microphone').click()
    await expect(page.get_by_text('Microphone Calibrated & Active')).to_be_visible()
    await page.get_by_role('button', name='Test Examiner Voice (ElevenLabs)', exact=True).click()
    await expect(page.get_by_role('button', name='Test Examiner Voice (ElevenLabs)', exact=True)).to_be_enabled()
    await page.get_by_role('button', name='I heard the sound', exact=True).click()
    await page.locator('#exam-consent').check()
    await page.get_by_role('button', name='Enter Live Examination Room').click()
    await page.wait_for_url('**/interview/*')
    session_id = page.url.rsplit('/', 1)[1]
    await expect(page.get_by_text('Live Connected', exact=True)).to_be_visible()
    start = time.monotonic()
    submitted, phases, milestones = 0, set(), []
    text_box = page.get_by_placeholder('Speak your answer naturally or type your response here... (Speech will stream in live)')
    await page.get_by_role('button', name='Tap to Speak', exact=True).click()
    while time.monotonic() - start < 905:
        elapsed = time.monotonic() - start
        events = await page.evaluate('window.__roomEvents || []')
        voice = await page.evaluate('window.__voiceEvents || []')
        phases.update(e['phase'] for e in events if e.get('phase'))
        ended = any(e.get('type') == 'interview_ended' for e in events)
        if ended:
            assert elapsed >= 865, f'Interview ended prematurely at {elapsed:.1f}s'
        if not ended and await text_box.is_visible():
            text = await text_box.input_value()
            if len(text.split()) >= 8 and any(word in text.lower() for word in ('memory', 'thread', 'process')):
                # Only submit text populated by Chrome's real recognition events.
                assert any(e.get('type') == 'result' and e.get('text') for e in voice)
                await page.get_by_role('button', name='Confirm & Submit Answer', exact=True).click()
                submitted += 1
            elif elapsed < 850 and elapsed % 60 < 6 and await page.get_by_role('button', name='Tap to Speak', exact=True).is_visible():
                try:
                    await page.get_by_role('button', name='Tap to Speak', exact=True).click(timeout=500)
                except Exception:
                    pass
        if not milestones or elapsed - milestones[-1]['elapsed'] >= 30:
            milestones.append({'elapsed': round(elapsed, 1), 'phases': sorted(phases), 'recognized_submissions': submitted,
                'speech_errors': [e.get('error') for e in voice if e.get('type') == 'error'], 'ended': ended})
            (artifacts / 'progress.json').write_text(json.dumps(milestones, indent=2))
            (artifacts / 'speech-events.json').write_text(json.dumps(voice, indent=2))
            print(f'Full-duration progress: {elapsed:.0f}s; phases={sorted(phases)}; spoken answers={submitted}', flush=True)
        await asyncio.sleep(5)
    await expect(page.get_by_role('heading', name='Your viva has ended')).to_be_visible(timeout=30000)
    url = f'http://127.0.0.1:13000/api/v1/sessions/{session_id}'
    turns = await (await context.request.get(f'http://127.0.0.1:13000/api/v1/transcript/{session_id}')).json()
    assert sum(turn['speaker'] == 'student' for turn in turns) == submitted, 'Lost or duplicated spoken answers'
    (artifacts / 'transcript.json').write_text(json.dumps(turns, indent=2))
    manifest = await (await context.request.get(url + '/recording')).json()
    (artifacts / 'recording-manifest.json').write_text(json.dumps(manifest, indent=2))
    assert manifest['chunk_count'] > 1000
    assert all(not capture['missing_sequences'] for capture in manifest['captures'])
    response = await context.request.get(url + '/audio/stream', timeout=60000)
    assert response.status == 200
    with wave.open(io.BytesIO(await response.body()), 'rb') as recording:
        recording_secs = recording.getnframes() / recording.getframerate()
    assert recording_secs >= 860, f'Recording only contains {recording_secs}s'
    await page.get_by_role('link', name='View my interviews and feedback').click()
    await page.get_by_role('button', name='View feedback', exact=True).click()
    from evaluation_result import evaluation_result
    score = await evaluation_result(context, page, session_id, env)
    job = await (await context.request.get(url + '/scoring')).json()
    (artifacts / 'score.json').write_text(json.dumps(score, indent=2))
    await page.screenshot(path=str(artifacts / 'full-duration-feedback.png'), full_page=True)
    expected = {'warm_up', 'fundamentals', 'depth', 'applied', 'wrap_up'}
    assert expected <= phases, phases
    voice = await page.evaluate('window.__voiceEvents || []')
    # Navigation destroys the page audit state; use persisted observations instead.
    voice = json.loads((artifacts / 'speech-events.json').read_text())
    assert not browser_errors, browser_errors
    result = {'passed': submitted > 0, 'full_duration_passed': True, 'native_chrome_recognition_passed': submitted > 0,
        'wall_seconds': round(time.monotonic() - start, 1), 'recording_seconds': round(recording_secs, 1),
        'session_id': session_id, 'phases': sorted(phases), 'recognized_submissions': submitted,
        'browser_errors': browser_errors,
        'scoring_model': score.get('model_used'), 'scoring_job': job,
        'recording_chunks': manifest['chunk_count'],
        'elevenlabs_quota_exceeded': 'quota_exceeded' in (artifacts / 'backend.log').read_text(),
        'speech_errors': sorted(set(e['error'] for e in voice if e.get('error'))), 'mock_mode': False,
        'input': 'Cloud-synthesized speech through Chrome microphone; no transcript injection or clock acceleration'}
    (artifacts / 'result.json').write_text(json.dumps(result, indent=2))
    backup_path = artifacts / 'synthetic-interview.db'
    with sqlite3.connect(env['DATABASE_URL'].split('sqlite+aiosqlite:///', 1)[1]) as source, sqlite3.connect(backup_path) as target:
        source.backup(target)
    os.chmod(backup_path, 0o600)
    print(json.dumps(result), flush=True)
    assert submitted > 0, 'Chrome did not deliver any usable spoken answers'
