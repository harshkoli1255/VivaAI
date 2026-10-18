"""SQLAlchemy async session setup with automatic SQLite fallback."""
import logging
import socket
from urllib.parse import urlparse
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

logger = logging.getLogger(__name__)


def _create_engine_with_fallback():
    db_url = settings.DATABASE_URL
    if db_url.startswith("postgresql"):
        try:
            parsed = urlparse(db_url)
            host = parsed.hostname or "localhost"
            port = parsed.port or 5432
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(0.4)
            res = sock.connect_ex((host, port))
            sock.close()
            if res != 0:
                logger.warning(
                    f"PostgreSQL at {host}:{port} is unreachable (code {res}). "
                    "Operating in standalone local mode with SQLite database."
                )
                db_url = "sqlite+aiosqlite:///./vivaai.db"
        except Exception as e:
            logger.warning(
                f"Error checking PostgreSQL at {db_url}: {e}. "
                "Operating in standalone local mode with SQLite database."
            )
            db_url = "sqlite+aiosqlite:///./vivaai.db"

    if db_url.startswith("sqlite"):
        return create_async_engine(db_url, echo=False)

    return create_async_engine(
        db_url,
        echo=False,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20,
    )


engine = _create_engine_with_fallback()

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
