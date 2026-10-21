"""Export selected consented sessions as a local demo evidence bundle.

Run: python scripts/export_demo_bundle.py --base-url http://127.0.0.1:8001 \
  --faculty-email you@university.edu --sessions UUID UUID --output /path/to/bundle
Password is prompted, never stored or logged. Requires authorized faculty access.
Only exports sessions with recording consent; incomplete evidence stays explicit.
"""
import argparse
import getpass
import io
import json
from pathlib import Path
from urllib.parse import urlparse
import uuid
import wave
import httpx


def main(args):
    parsed = urlparse(args.base_url)
    if parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1')):
        raise ValueError('Use HTTPS or a loopback development URL')
    output = Path(args.output)
    if output.exists(): raise ValueError('Choose a new output directory to avoid replacing evidence')
    for value in args.sessions: uuid.UUID(value)
    password = getpass.getpass('Faculty password: ')
    manifest = {'source': args.base_url, 'sessions': [], 'minimum_full_vivas': 5}
    with httpx.Client(base_url=args.base_url.rstrip('/'), trust_env=False, timeout=120) as client:
        login = client.post('/api/v1/auth/login', json={'email': args.faculty_email, 'password': password})
        login.raise_for_status()
        principal = login.json()
        if principal['user']['role'] != 'faculty': raise ValueError('A faculty account is required')
        client.headers['Authorization'] = 'Bearer ' + principal['access_token']
        output.mkdir(parents=True)
        try:
            for session_id in args.sessions:
                response = client.get(f'/api/v1/sessions/{session_id}')
                response.raise_for_status(); session = response.json()
                if not session['consent_given']: raise ValueError(f'Recording consent missing for {session_id}')
                detail = client.get(f'/api/v1/dashboard/sessions/{session_id}/detail')
                detail.raise_for_status()
                folder = output / session_id; folder.mkdir()
                (folder / 'session.json').write_text(json.dumps(session, indent=2))
                (folder / 'review.json').write_text(json.dumps(detail.json(), indent=2))
                score = client.get(f'/api/v1/scores/{session_id}')
                audio = client.get(f'/api/v1/sessions/{session_id}/audio/stream')
                item = {'session_id': session_id, 'consent_recorded': True, 'elapsed_seconds': session['elapsed_secs'],
                        'score_available': score.status_code == 200, 'audio_available': audio.status_code == 200,
                        'full_duration_evidence': False}
                if score.status_code == 200:
                    (folder / 'scores.json').write_text(json.dumps(score.json(), indent=2))
                    item['model_used'] = score.json().get('model_used')
                if audio.status_code == 200:
                    (folder / 'recording.wav').write_bytes(audio.content)
                    with wave.open(io.BytesIO(audio.content), 'rb') as recording:
                        item['recording_seconds'] = recording.getnframes() / recording.getframerate()
                    item['full_duration_evidence'] = session['elapsed_secs'] >= 870 and item['recording_seconds'] >= 860 and item['score_available']
                manifest['sessions'].append(item)
        finally:
            client.post('/api/v1/auth/logout')
            manifest['full_viva_count'] = sum(item['full_duration_evidence'] for item in manifest['sessions'])
            manifest['minimum_demo_count_met'] = manifest['full_viva_count'] >= 5
            manifest['note'] = 'Verify consent, volunteer provenance, privacy and human grading separately. A recorded consent flag alone is not study approval.'
            (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Bundle saved: {output}; full-duration evidence: {manifest["full_viva_count"]}/5')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', required=True)
    parser.add_argument('--faculty-email', required=True)
    parser.add_argument('--sessions', nargs='+', required=True)
    parser.add_argument('--output', required=True)
    main(parser.parse_args())
