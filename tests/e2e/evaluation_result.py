"""Assert a real evaluation either publishes supported grades or requests review."""
import asyncio
import json
import sqlite3
import time
from playwright.async_api import expect


async def evaluation_result(context, page, session_id, env):
    base = 'http://127.0.0.1:13000/api/v1'
    expected_model = 'mock' if env.get('MOCK_MODE') == 'true' else env['LLM_STRONG_MODEL']
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        job = await (await context.request.get(f'{base}/sessions/{session_id}/scoring')).json()
        if job['status'] in ('completed', 'review_required'):
            break
        assert job['status'] != 'failed', job
        await asyncio.sleep(.5)
    else:
        raise AssertionError(f'Evaluation did not finish: {job}')
    response = await context.request.get(f'{base}/scores/{session_id}')
    data = await response.json()
    if job['status'] == 'review_required':
        assert response.status == 409, data
        # Verify this was a real evaluation, not a generic outage or UI placeholder.
        database = env['DATABASE_URL'].split('sqlite+aiosqlite:///', 1)[1]
        with sqlite3.connect(database) as db:
            audit = db.execute("SELECT detail FROM audit_logs WHERE session_id=? AND action='scoring_review_required'", (session_id.replace('-', ''),)).fetchone()
            assert audit, 'Missing durable evaluation evidence'
            evidence = json.loads(audit[0])
            assert evidence['model'] == expected_model, evidence
            assert evidence['reasons']
            assert db.execute('SELECT COUNT(*) FROM score_reports WHERE session_id=?', (session_id.replace('-', ''),)).fetchone()[0] == 0
        await expect(page.get_by_text('Your answers are saved. Automated feedback requires faculty review. Please contact your faculty for an update.', exact=True)).to_be_visible(timeout=30000)
        return {'status': 'review_required', 'model_used': evidence['model'], 'review_reasons': evidence['reasons']}
    assert response.status == 200, data
    assert data.get('model_used') == expected_model, data
    assert data.get('feedback_lines')
    if expected_model != 'mock': assert 'mock' not in json.dumps(data).lower()
    assert all(dimension['turn_ids'] for dimension in data['dimensions'].values())
    await expect(page.get_by_text(data['feedback_lines'][0], exact=True)).to_be_visible(timeout=30000)
    return data
