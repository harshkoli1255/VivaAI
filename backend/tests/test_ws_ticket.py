"""WebSocket short-lived ticket authentication tests."""
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.core.security import create_access_token, decode_ws_ticket


@pytest.fixture
def student1_token():
    return create_access_token({
        "sub": "22222222-2222-2222-2222-222222222222",
        "role": "student",
        "student_id": "STU001",
    })


@pytest.fixture
def student2_token():
    return create_access_token({
        "sub": "33333333-3333-3333-3333-333333333333",
        "role": "student",
        "student_id": "STU002",
    })


@pytest.mark.asyncio
async def test_candidate_can_generate_ws_ticket_for_own_session(student1_token):
    """Candidate can obtain a short-lived WS ticket for their own examination."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.post(
            "/api/v1/sessions/44444444-4444-4444-4444-444444444441/ws-ticket",
            headers={"Authorization": f"Bearer {student1_token}"},
        )
        assert res.status_code == 200
        data = res.json()
        assert "ticket" in data
        assert data["expires_in"] == 60

        # Verify decode
        decoded = decode_ws_ticket(data["ticket"], "44444444-4444-4444-4444-444444444441")
        assert decoded["sub"] == "22222222-2222-2222-2222-222222222222"
        assert decoded["purpose"] == "ws_ticket"


@pytest.mark.asyncio
async def test_candidate_cannot_obtain_ticket_for_another_session(student2_token):
    """Student 2 cannot obtain a WS ticket for Student 1's examination."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.post(
            "/api/v1/sessions/44444444-4444-4444-4444-444444444441/ws-ticket",
            headers={"Authorization": f"Bearer {student2_token}"},
        )
        assert res.status_code == 403


def test_decode_ws_ticket_fails_on_session_mismatch(student1_token):
    """Ticket generated for session A cannot be used to connect to session B."""
    from app.core.security import create_ws_ticket
    ticket = create_ws_ticket("44444444-4444-4444-4444-444444444441", "22222222-2222-2222-2222-222222222222", "student")

    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc_info:
        decode_ws_ticket(ticket, expected_session_id="00000000-0000-0000-0000-000000000099")
    assert exc_info.value.status_code == 403
