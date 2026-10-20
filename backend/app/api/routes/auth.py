"""Authentication endpoints with secure cookie and header support."""
from datetime import timedelta
from typing import Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import (
    verify_password, hash_password, create_access_token, get_current_user,
    set_auth_cookie, clear_auth_cookie, require_faculty,
)
from app.core.config import settings
from app.db.session import get_db
from app.models.models import User, UserRole, AuthSession
from app.services.auth_sessions import issue_session, check_auth_rate

router = APIRouter()


class LoginRequest(BaseModel):
    student_id: Optional[str] = None
    email: Optional[str] = None
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    name: str
    role: str
    user: Optional[dict] = None


class RegisterRequest(BaseModel):
    name: str
    student_id: Optional[str] = None
    email: Optional[str] = None
    password: str
    role: Optional[str] = "student"


@router.post("/login", response_model=TokenResponse)
async def login(
    req: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Authenticate user, set HttpOnly session cookie, and return JWT."""
    await check_auth_rate(db, req.student_id or req.email or "missing-identifier")
    if req.student_id:
        req.student_id = req.student_id.strip()
        result = await db.execute(
            select(User).where(User.student_id == req.student_id)
        )
    elif req.email:
        result = await db.execute(
            select(User).where(User.email == req.email)
        )
    else:
        raise HTTPException(status_code=400, detail="Provide student_id or email")

    user = result.scalar_one_or_none()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account has been deactivated",
        )

    token = await issue_session(db, user)

    # Set secure HttpOnly session cookie
    set_auth_cookie(response, token)

    return TokenResponse(
        access_token=token,
        user_id=str(user.id),
        name=user.name,
        role=user.role.value,
        user={
            "id": str(user.id),
            "name": user.name,
            "role": user.role.value,
            "student_id": user.student_id,
            "email": user.email,
        },
    )


@router.post("/logout")
async def logout(response: Response, request: Request, db: AsyncSession = Depends(get_db)):
    """Revoke the server session before removing the cookie."""
    from app.core.security import decode_token, validate_cookie_origin
    validate_cookie_origin(request)
    token = request.cookies.get(settings.SESSION_COOKIE_NAME)
    if not token and request.headers.get("authorization", "").startswith("Bearer "):
        token = request.headers["authorization"][7:]
    if token:
        try:
            claims = decode_token(token)
            if claims.get("jti"):
                session = await db.get(AuthSession, uuid.UUID(claims["jti"]))
                if session:
                    session.revoked = True
                    await db.commit()
        except HTTPException:
            pass
    clear_auth_cookie(response)
    return {"message": "Logged out successfully"}


@router.post("/register", response_model=TokenResponse)
async def register(
    req: RegisterRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Register student candidate. Public registrations cannot self-assign faculty role."""
    await check_auth_rate(db, req.student_id or req.email or "registration")
    req.name = req.name.strip()
    req.student_id = req.student_id.strip() if req.student_id else None
    req.email = req.email.strip().lower() if req.email else None
    if not req.name or not (req.student_id or req.email):
        raise HTTPException(400, "Name and a university ID or email are required")
    if len(req.password.encode("utf-8")) > 72:
        raise HTTPException(400, "Password must not exceed 72 UTF-8 bytes")
    if len(req.password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 8 characters",
        )

    # Check duplicate
    if req.student_id:
        existing_stu = await db.execute(select(User).where(User.student_id == req.student_id))
        if existing_stu.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="Student ID already registered")

    if req.email:
        existing_email = await db.execute(select(User).where(User.email == req.email))
        if existing_email.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="Email address already registered")

    # Security: public registration cannot create faculty or admin accounts
    assigned_role = UserRole.student
    if req.role and req.role.lower() in ("faculty", "admin"):
        # Block privilege escalation
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Faculty and administrative accounts cannot be created via public registration",
        )

    user = User(
        id=uuid.uuid4(),
        name=req.name.strip(),
        student_id=req.student_id.strip() if req.student_id else None,
        email=req.email.strip() if req.email else None,
        hashed_password=hash_password(req.password),
        role=assigned_role,
        is_active=True,
    )
    db.add(user)
    await db.commit()

    token = await issue_session(db, user)

    set_auth_cookie(response, token)

    return TokenResponse(
        access_token=token,
        user_id=str(user.id),
        name=user.name,
        role=user.role.value,
        user={
            "id": str(user.id),
            "name": user.name,
            "role": user.role.value,
            "student_id": user.student_id,
            "email": user.email,
        },
    )


@router.get("/me")
async def me(
    current: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return verified current user identity and role."""
    try:
        user_uuid = uuid.UUID(current["sub"])
    except (ValueError, KeyError):
        return {
            "id": current.get("sub", ""),
            "name": current.get("name", "Demo User"),
            "student_id": current.get("student_id"),
            "email": current.get("email"),
            "role": current.get("role", "student"),
        }

    result = await db.execute(select(User).where(User.id == user_uuid))
    user = result.scalar_one_or_none()
    if not user:
        # Fallback to token claims for demo personas
        return {
            "id": current["sub"],
            "name": current.get("name", "User"),
            "student_id": current.get("student_id"),
            "email": current.get("email"),
            "role": current.get("role", "student"),
        }

    return {
        "id": str(user.id),
        "name": user.name,
        "student_id": user.student_id,
        "email": user.email,
        "role": user.role.value,
    }
