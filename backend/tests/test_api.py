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
    titles = [c["title"] for c in configs]
    assert "Operating Systems & Concurrency Viva" in titles


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


@pytest.mark.asyncio
async def test_generate_preview_questions():
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        login_res = await ac.post("/api/v1/auth/login", json={
            "email": "priya.sharma@university.edu",
            "password": "faculty123"
        })
        token = login_res.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        res = await ac.post(
            "/api/v1/viva-configs/generate-preview-questions",
            json={
                "syllabus": "Unit 1: Process scheduling, CPU interrupts, mutexes and deadlocks.",
                "subject": "Operating Systems",
                "difficulty": "medium",
                "count": 3,
            },
            headers=headers,
        )
        assert res.status_code == 200
        data = res.json()
        assert "questions" in data
        assert len(data["questions"]) >= 1
        assert "text" in data["questions"][0]
        assert "phase" in data["questions"][0]


@pytest.mark.asyncio
async def test_score_pdf_export():
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        login_res = await ac.post("/api/v1/auth/login", json={
            "email": "priya.sharma@university.edu",
            "password": "faculty123"
        })
        token = login_res.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        sess_res = await ac.get("/api/v1/dashboard/sessions", headers=headers)
        sessions = sess_res.json()["items"]
        session_id = sessions[0]["id"]

        pdf_res = await ac.get(f"/api/v1/scores/{session_id}/pdf", headers=headers)
        assert pdf_res.status_code == 200
        assert pdf_res.headers["content-type"] == "application/pdf"
        assert pdf_res.content.startswith(b"%PDF-")


@pytest.mark.asyncio
async def test_session_audio_upload_and_stream():
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # Login as faculty to get a session
        login_res = await ac.post("/api/v1/auth/login", json={
            "email": "priya.sharma@university.edu",
            "password": "faculty123"
        })
        fac_token = login_res.json()["access_token"]
        headers = {"Authorization": f"Bearer {fac_token}"}

        sess_res = await ac.get("/api/v1/dashboard/sessions", headers=headers)
        session_id = sess_res.json()["items"][0]["id"]

        # Upload dummy student audio webm
        dummy_audio = b"\x1a\x45\xdf\xa3" + b"dummy_webm_voice_recording_data"
        files = {"file": ("recording.webm", dummy_audio, "audio/webm")}
        upload_res = await ac.post(f"/api/v1/sessions/{session_id}/audio", files=files, headers=headers)
        assert upload_res.status_code == 200
        upload_data = upload_res.json()
        assert upload_data["status"] == "uploaded"
        assert upload_data["audio_url"] == f"/api/v1/sessions/{session_id}/audio/stream"

        # Check audio metadata endpoint
        audio_meta_res = await ac.get(f"/api/v1/sessions/{session_id}/audio", headers=headers)
        assert audio_meta_res.status_code == 200
        assert audio_meta_res.json()["audio_url"] == f"/api/v1/sessions/{session_id}/audio/stream"
        assert audio_meta_res.json()["status"] == "ready"

        # Stream audio
        stream_res = await ac.get(f"/api/v1/sessions/{session_id}/audio/stream")
        assert stream_res.status_code == 200
        assert stream_res.content == dummy_audio
        assert "bytes" in stream_res.headers.get("accept-ranges", "")

        # Verify dashboard detail has audio_url populated
        detail_res = await ac.get(f"/api/v1/dashboard/sessions/{session_id}/detail", headers=headers)
        assert detail_res.status_code == 200
        assert detail_res.json()["session"]["audio_url"] == f"/api/v1/sessions/{session_id}/audio/stream"
