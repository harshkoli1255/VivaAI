"""Object-level authorization and role regression tests."""
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.core.security import create_access_token


@pytest.fixture
def student1_token():
    return create_access_token({
        "sub": "22222222-2222-2222-2222-222222222222",
        "role": "student",
        "name": "Alex Chen",
        "student_id": "STU001",
    })


@pytest.fixture
def student2_token():
    return create_access_token({
        "sub": "33333333-3333-3333-3333-333333333333",
        "role": "student",
        "name": "Samira Khan",
        "student_id": "STU002",
    })


@pytest.fixture
def faculty_token():
    return create_access_token({
        "sub": "11111111-1111-1111-1111-111111111111",
        "role": "faculty",
        "name": "Prof. Priya Sharma",
        "email": "priya.sharma@university.edu",
    })


@pytest.mark.asyncio
async def test_student_cannot_access_faculty_dashboard(student1_token):
    """Students cannot access faculty assessment statistics or session lists."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.get(
            "/api/v1/dashboard/stats",
            headers={"Authorization": f"Bearer {student1_token}"},
        )
        assert res.status_code == 403


@pytest.mark.asyncio
async def test_student_cannot_access_other_student_session(student2_token):
    """Student 2 cannot read or access Student 1's seeded exam session."""
    # Seeded session for student 1 is 44444444-4444-4444-4444-444444444441
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.get(
            "/api/v1/sessions/44444444-4444-4444-4444-444444444441",
            headers={"Authorization": f"Bearer {student2_token}"},
        )
        assert res.status_code == 403


@pytest.mark.asyncio
async def test_student_cannot_access_other_student_transcript(student2_token):
    """Student 2 cannot read Student 1's verbatim exam transcript."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.get(
            "/api/v1/transcript/44444444-4444-4444-4444-444444444441",
            headers={"Authorization": f"Bearer {student2_token}"},
        )
        assert res.status_code == 403


@pytest.mark.asyncio
async def test_student_cannot_access_other_student_scores(student2_token):
    """Student 2 cannot read Student 1's evaluation scores."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.get(
            "/api/v1/scores/44444444-4444-4444-4444-444444444441",
            headers={"Authorization": f"Bearer {student2_token}"},
        )
        assert res.status_code == 403


@pytest.mark.asyncio
async def test_student_cannot_give_consent_for_other_student(student2_token):
    """Student 2 cannot grant honor consent on Student 1's session."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.post(
            "/api/v1/sessions/44444444-4444-4444-4444-444444444441/consent",
            headers={"Authorization": f"Bearer {student2_token}"},
        )
        assert res.status_code == 403


@pytest.mark.asyncio
async def test_public_registration_cannot_escalate_to_faculty():
    """Public self-registration cannot create a faculty account."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.post(
            "/api/v1/auth/register",
            json={
                "name": "Attacker",
                "email": "attacker@evil.com",
                "password": "Password123!",
                "role": "faculty",
            },
        )
        assert res.status_code == 403
