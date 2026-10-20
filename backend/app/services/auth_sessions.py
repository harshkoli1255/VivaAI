"""Revocable browser sessions and shared login throttling."""
import hashlib
import time
import uuid
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException
from sqlalchemy import update, delete
from sqlalchemy.exc import IntegrityError
from app.core.config import settings
from app.core.security import create_access_token
from app.models.models import AuthSession, AuthRateLimit


async def issue_session(db, user):
    session_id = uuid.uuid4()
    db.add(AuthSession(id=session_id, user_id=user.id, revoked=False,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)))
    await db.commit()
    return create_access_token({"sub": str(user.id), "jti": str(session_id), "role": user.role.value,
        "name": user.name, "email": user.email, "student_id": user.student_id})


async def check_auth_rate(db, identifier, max_attempts=20, message="Too many authentication attempts. Please wait one minute."):
    timestamp = datetime.now(timezone.utc)
    key = hashlib.sha256(f"{identifier.strip().lower()}:{int(time.time()) // 60}".encode()).hexdigest()
    await db.execute(delete(AuthRateLimit).where(AuthRateLimit.expires_at < timestamp))
    try:
        async with db.begin_nested():
            db.add(AuthRateLimit(key=key, count=0, expires_at=timestamp + timedelta(minutes=2)))
            await db.flush()
    except IntegrityError:
        pass
    count = await db.scalar(update(AuthRateLimit).where(AuthRateLimit.key == key).values(count=AuthRateLimit.count + 1).returning(AuthRateLimit.count))
    await db.commit()
    if count > max_attempts:
        raise HTTPException(429, message, headers={"Retry-After": "60"})
