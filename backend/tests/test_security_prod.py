"""Production security and configuration regression tests."""
import pytest
from app.core.config import Settings
from app.core.security import decode_token


def test_production_fails_on_default_secret_key():
    """Verify production startup fails if SECRET_KEY is the default or insecure."""
    with pytest.raises(ValueError, match="CRITICAL: Production startup aborted"):
        Settings(
            APP_ENV="production",
            SECRET_KEY="change_me_in_prod",
            DATABASE_URL="postgresql+asyncpg://vivaai:pass@prod-db:5432/vivaai",
        )


def test_production_fails_on_short_secret_key():
    """Verify production startup fails if SECRET_KEY is too short (< 32 chars)."""
    with pytest.raises(ValueError, match="CRITICAL: Production startup aborted"):
        Settings(
            APP_ENV="production",
            SECRET_KEY="short_secret_key",
            DATABASE_URL="postgresql+asyncpg://vivaai:pass@prod-db:5432/vivaai",
        )


def test_production_fails_on_sqlite():
    """Verify production strictly forbids SQLite database fallback."""
    with pytest.raises(ValueError, match="CRITICAL: SQLite is strictly forbidden in production"):
        Settings(
            APP_ENV="production",
            SECRET_KEY="a_very_secure_and_cryptographically_sound_secret_key_123456",
            DATABASE_URL="sqlite+aiosqlite:///./prod.db",
        )


def test_demo_tokens_rejected_in_production(monkeypatch):
    """Verify that hardcoded demo persona tokens are strictly rejected in production."""
    from app.core.config import settings
    monkeypatch.setattr(settings, "APP_ENV", "production")
    monkeypatch.setattr(settings, "DEMO_MODE", False)

    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc_info:
        decode_token("demo_faculty_token_drpriya")
    assert exc_info.value.status_code == 401

    with pytest.raises(HTTPException) as exc_info:
        decode_token("demo_student_token_stu001")
    assert exc_info.value.status_code == 401
