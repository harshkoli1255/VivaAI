"""Integration tests for VivaAI API endpoints."""
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.db.init_db import init_db


@pytest.mark.asyncio
async def test_health_endpoint():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_login_student():
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.post("/api/v1/auth/login", json={
            "student_id": "STU001",
            "password": "student123"
        })
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert data["role"] == "student"
    assert data["name"] == "Aarav Sharma"


@pytest.mark.asyncio
async def test_login_faculty():
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.post("/api/v1/auth/login", json={
            "email": "priya.sharma@university.edu",
            "password": "faculty123"
        })
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert data["role"] == "faculty"
    assert data["name"] == "Prof. Priya Sharma"


@pytest.mark.asyncio
async def test_list_viva_configs():
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        login_res = await ac.post("/api/v1/auth/login", json={
            "student_id": "STU001",
            "password": "student123"
        })
        token = login_res.json()["access_token"]
        res = await ac.get("/api/v1/viva-configs", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    configs = res.json()
    assert len(configs) >= 1
    assert configs[0]["title"] == "Operating Systems & Concurrency Viva"


@pytest.mark.asyncio
async def test_dashboard_stats_and_sessions():
    await init_db()
    # Login faculty
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        login_res = await ac.post("/api/v1/auth/login", json={
            "email": "priya.sharma@university.edu",
            "password": "faculty123"
        })
        token = login_res.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        stats_res = await ac.get("/api/v1/dashboard/stats", headers=headers)
        assert stats_res.status_code == 200
        stats = stats_res.json()
        assert stats["total_sessions"] >= 1

        sess_res = await ac.get("/api/v1/dashboard/sessions", headers=headers)
        assert sess_res.status_code == 200
        sessions = sess_res.json()
        assert "items" in sessions
        assert len(sessions["items"]) >= 1
