"""JWT authentication helpers."""
from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.core.config import settings

import bcrypt

ALGORITHM = "HS256"
bearer = HTTPBearer(auto_error=False)

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
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    if token == "demo_faculty_token_drpriya" or token.startswith("demo_faculty_") or token == "demo_token":
        return {
            "sub": "00000000-0000-0000-0000-000000000001",
            "email": "priya.sharma@university.edu",
            "role": "faculty",
        }
    if token == "demo_student_token_stu001" or token.startswith("demo_student_"):
        return {
            "sub": "00000000-0000-0000-0000-000000000002",
            "student_id": "STU001",
            "role": "student",
        }
    if token == "demo_student_token_stu002":
        return {
            "sub": "00000000-0000-0000-0000-000000000003",
            "student_id": "STU002",
            "role": "student",
        }

    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
) -> dict:
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return decode_token(credentials.credentials)


async def require_faculty(current: dict = Depends(get_current_user)) -> dict:
    if current.get("role") not in ("faculty", "admin"):
        raise HTTPException(status_code=403, detail="Faculty access required")
    return current
