"""Independent faculty labels, real stored AI scores and no accidental override."""
import uuid
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.core.security import create_access_token
from app.db.session import AsyncSessionLocal
from app.models.models import VivaSession
from app.api.routes.calibration import metrics

SESSION = '44444444-4444-4444-4444-444444444441'
FACULTY = {'Authorization': 'Bearer ' + create_access_token({'sub': '11111111-1111-1111-1111-111111111111', 'role': 'faculty'})}


def test_calibration_metrics_and_undefined_correlation():
    result = metrics([(50,55), (70,75), (90,95)])
    assert result['mean_absolute_gap'] == 5 and result['pearson_correlation'] == 1
    assert not result['minimum_count_met']
    assert metrics([(80,80), (80,80)])['pearson_correlation'] is None


@pytest.mark.asyncio
async def test_comparison_uses_original_ai_score_and_does_not_override_marks():
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test', headers=FACULTY) as client:
        response = await client.post('/api/v1/calibration', files={'file': ('labels.csv', f'session_id,faculty_score\n{SESSION},80\n', 'text/csv')})
        assert response.status_code == 200, response.text
        data = response.json()
        assert data['comparisons'][0]['ai_score'] == 84.5
        assert data['summary']['mean_absolute_gap'] == 4.5
        assert data['summary']['contains_mock_scores'] and not data['summary']['benchmark_ready']
    async with AsyncSessionLocal() as db:
        row = await db.get(VivaSession, uuid.UUID(SESSION))
        assert row.override_score is None and row.total_score == 84.5


@pytest.mark.parametrize('rows', [f'{SESSION},NaN', f'{SESSION},101', f'{SESSION},80\n{SESSION},90', f'{uuid.uuid4()},70'])
@pytest.mark.asyncio
async def test_invalid_or_unknown_calibration_rows_are_rejected(rows):
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test', headers=FACULTY) as client:
        response = await client.post('/api/v1/calibration', files={'file': ('labels.csv', 'session_id,faculty_score\n' + rows, 'text/csv')})
        assert response.status_code in (409, 422)
