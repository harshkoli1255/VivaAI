"""Score override validation and audit logging regression tests."""
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.core.security import create_access_token


@pytest.fixture
def student_token():
    return create_access_token({
        "sub": "22222222-2222-2222-2222-222222222222",
        "role": "student",
        "student_id": "STU001",
    })


@pytest.fixture
def faculty_token():
    return create_access_token({
        "sub": "11111111-1111-1111-1111-111111111111",
        "role": "faculty",
        "email": "priya.sharma@university.edu",
    })


@pytest.mark.asyncio
async def test_student_cannot_override_score(student_token):
    """Students cannot execute score overrides."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.post(
            "/api/v1/sessions/44444444-4444-4444-4444-444444444441/override",
            json={"override_score": 95.0, "reason": "Self-awarded grade"},
            headers={"Authorization": f"Bearer {student_token}"},
        )
        assert res.status_code == 403


@pytest.mark.asyncio
async def test_override_score_out_of_bounds(faculty_token):
    """Score must be between 0 and 100."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.post(
            "/api/v1/sessions/44444444-4444-4444-4444-444444444441/override",
            json={"override_score": 105.0, "reason": "Exceeded maximum bounds"},
            headers={"Authorization": f"Bearer {faculty_token}"},
        )
        assert res.status_code == 422 or res.status_code == 400


@pytest.mark.asyncio
async def test_override_score_requires_reason(faculty_token):
    """Override must include a justification reason."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.post(
            "/api/v1/sessions/44444444-4444-4444-4444-444444444441/override",
            json={"override_score": 88.0, "reason": ""},
            headers={"Authorization": f"Bearer {faculty_token}"},
        )
        assert res.status_code == 422 or res.status_code == 400


@pytest.mark.asyncio
async def test_faculty_successful_override_logged(faculty_token):
    """Faculty can override score with valid justification, logged to audit ledger."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.post(
            "/api/v1/sessions/44444444-4444-4444-4444-444444444441/override",
            json={
                "override_score": 89.0,
                "reason": "Turn #4 demonstrated advanced grasp of Raft quorum invariants.",
            },
            headers={"Authorization": f"Bearer {faculty_token}"},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["override_score"] == 89.0
        assert data["logged"] is True
