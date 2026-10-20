"""Health and readiness endpoint tests."""
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app


@pytest.mark.asyncio
async def test_health_live_endpoint():
    """Verify liveness probe returns status live."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.get("/health/live")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "live"
        assert data["service"] == "vivaai-backend"


@pytest.mark.asyncio
async def test_health_ready_endpoint():
    """Verify readiness probe checks database connectivity and returns 200."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.get("/health/ready")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ready"
        assert data["checks"]["database"] == "ok"
