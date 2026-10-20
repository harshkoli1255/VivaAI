"""Authentication, authorization, and secure token helpers."""
from datetime import datetime, timedelta, timezone
from typing import Optional
import uuid

import bcrypt
from fastapi import Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from app.core.config import settings

ALGORITHM = "HS256"
bearer = HTTPBearer(auto_error=False)

# Explicit demo persona tokens strictly restricted to development/demo mode
DEMO_PERSONAS = {
    "demo_faculty_token_drpriya": {
        "sub": "11111111-1111-1111-1111-111111111111",
        "email": "priya.sharma@university.edu",
        "name": "Prof. Priya Sharma",
        "role": "faculty",
    },
    "demo_student_token_stu001": {
        "sub": "22222222-2222-2222-2222-222222222222",
        "student_id": "STU001",
        "name": "Alex Chen",
        "role": "student",
    },
    "demo_student_token_stu002": {
        "sub": "33333333-3333-3333-3333-333333333333",
        "student_id": "STU002",
        "name": "Samira Khan",
        "role": "student",
    },
}


def hash_password(password: str) -> str:
    pwd_bytes = password.encode("utf-8")[:72]
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(pwd_bytes, salt).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        pwd_bytes = plain.encode("utf-8")[:72]
        return bcrypt.checkpw(pwd_bytes, hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire, "purpose": "api_access"})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)


def create_ws_ticket(session_id: str, user_id: str, role: str, auth_session_id: Optional[str] = None) -> str:
    """Generate a single-use, 60-second cryptographically signed WebSocket ticket."""
    expire = datetime.now(timezone.utc) + timedelta(seconds=settings.WS_TICKET_EXPIRE_SECONDS)
    payload = {
        "sub": user_id,
        "session_id": session_id,
        "role": role,
        "purpose": "ws_ticket",
        "auth_session_id": auth_session_id,
        "jti": str(uuid.uuid4()),
        "exp": expire,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def decode_ws_ticket(ticket: str, expected_session_id: str) -> dict:
    """Verify and decode a WebSocket connection ticket."""
    try:
        payload = jwt.decode(ticket, settings.SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("purpose") != "ws_ticket":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Invalid ticket purpose",
            )
        if not payload.get("jti") or not payload.get("sub") or payload.get("role") not in ("student", "faculty", "admin"):
            raise HTTPException(status_code=401, detail="Invalid ticket claims")
        if payload.get("session_id") != expected_session_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Ticket does not match requested interview session",
            )
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="WebSocket ticket invalid or expired",
        )


def decode_token(token: str) -> dict:
    """Decode and validate a JWT access token."""
    # Check demo tokens only when explicitly allowed in non-production
    if not settings.IS_PRODUCTION and settings.DEMO_MODE:
        if token in DEMO_PERSONAS:
            return DEMO_PERSONAS[token].copy()

    try:
        claims = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        if claims.get("purpose") != "api_access":
            raise JWTError("Invalid access token purpose")
        if not claims.get("sub") or claims.get("role") not in ("student", "faculty", "admin"):
            raise JWTError("Invalid access token claims")
        uuid.UUID(claims["sub"])
        return claims
    except (JWTError, ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication credentials",
        )


def set_auth_cookie(response: Response, token: str):
    """Set HttpOnly session cookie on response."""
    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        domain=settings.COOKIE_DOMAIN,
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


def clear_auth_cookie(response: Response):
    """Clear HttpOnly session cookie on logout."""
    response.delete_cookie(
        key=settings.SESSION_COOKIE_NAME,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        domain=settings.COOKIE_DOMAIN,
    )


def validate_cookie_origin(request):
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin")
        if origin and origin not in settings.CORS_ORIGINS_LIST:
            is_trycloudflare = origin.startswith("https://") and origin.endswith(".trycloudflare.com")
            if not (is_trycloudflare and not settings.IS_PRODUCTION):
                raise HTTPException(403, "Untrusted request origin")


async def validate_principal(claims):
    if settings.IS_PRODUCTION and not claims.get("jti"):
        raise HTTPException(401, "Please sign in again to create a revocable session")
    from app.db.session import AsyncSessionLocal
    from app.models.models import AuthSession, User
    async with AsyncSessionLocal() as db:
        user = await db.get(User, uuid.UUID(claims["sub"]))
        if not user or not user.is_active or user.role.value != claims.get("role"):
            raise HTTPException(401, "Account is unavailable")
        if claims.get("jti"):
            session = await db.get(AuthSession, uuid.UUID(claims["jti"]))
            if (not session or session.revoked or str(session.user_id) != claims["sub"]
                    or session.expires_at.replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc)):
                raise HTTPException(401, "Session expired or revoked")
    return claims


async def get_current_user(request: Request, credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer)) -> dict:
    token = credentials.credentials if credentials else request.cookies.get(settings.SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(401, "Authentication required", headers={"WWW-Authenticate": "Bearer"})
    if not credentials:
        validate_cookie_origin(request)
    return await validate_principal(decode_token(token))


async def require_faculty(current: dict = Depends(get_current_user)) -> dict:
    """Enforce strict faculty/admin role authorization."""
    role = current.get("role")
    if role not in ("faculty", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Sovereign faculty access credentials required",
        )
    return current


async def require_student(current: dict = Depends(get_current_user)) -> dict:
    """Enforce candidate/student role."""
    role = current.get("role")
    if role not in ("student", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Student candidate credentials required",
        )
    return current
