"""Authentication endpoints."""
from datetime import timedelta
from typing import Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import (
    verify_password, hash_password, create_access_token, get_current_user
)
from app.core.config import settings
from app.db.session import get_db
from app.models.models import User, UserRole

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


class RegisterRequest(BaseModel):
    name: str
    student_id: Optional[str] = None
    email: Optional[str] = None
    password: str
    role: str = "student"


@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    # Find user by student_id or email
    if req.student_id:
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
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account deactivated")

    token = create_access_token({"sub": str(user.id), "role": user.role.value})
    return TokenResponse(
        access_token=token,
        user_id=str(user.id),
        name=user.name,
        role=user.role.value,
    )


@router.post("/register", response_model=TokenResponse)
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    # Check duplicate
    if req.student_id:
        existing = await db.execute(select(User).where(User.student_id == req.student_id))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="Student ID already registered")

    try:
        role = UserRole(req.role)
    except ValueError:
        role = UserRole.student

    user = User(
        id=uuid.uuid4(),
        name=req.name,
        student_id=req.student_id,
        email=req.email,
        hashed_password=hash_password(req.password),
        role=role,
    )
    db.add(user)
    await db.commit()

    token = create_access_token({"sub": str(user.id), "role": user.role.value})
    return TokenResponse(
        access_token=token,
        user_id=str(user.id),
        name=user.name,
        role=user.role.value,
    )


@router.get("/me")
async def me(current: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.id == uuid.UUID(current["sub"])))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404)
    return {
        "id": str(user.id),
        "name": user.name,
        "student_id": user.student_id,
        "email": user.email,
        "role": user.role.value,
    }
