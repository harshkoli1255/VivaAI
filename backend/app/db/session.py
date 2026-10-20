"""SQLAlchemy async session setup with production safety."""
import logging
import socket
from urllib.parse import urlparse
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

logger = logging.getLogger(__name__)


def _create_engine():
    db_url = settings.DATABASE_URL
    if db_url.startswith("postgresql://"):
        db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if "sslmode=" in db_url:
        db_url = db_url.replace("sslmode=", "ssl=")
    if "&channel_binding=require" in db_url:
        db_url = db_url.replace("&channel_binding=require", "")
    elif "?channel_binding=require" in db_url:
        db_url = db_url.replace("?channel_binding=require", "")

    if db_url.startswith("postgresql"):
        parsed = urlparse(db_url)
        host = parsed.hostname or "localhost"
        port = parsed.port or 5432

        # In production, never fallback to SQLite. Require Postgres connectivity.
        if settings.IS_PRODUCTION:
            logger.info(f"Connecting to production PostgreSQL at {host}:{port}")
            return create_async_engine(
                db_url,
                echo=False,
                pool_pre_ping=True,
                pool_size=10,
                max_overflow=20,
            )

        # In development, check if Postgres is running before falling back
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            timeout = 3.0 if (host not in ("localhost", "127.0.0.1", "postgres")) else 0.5
            sock.settimeout(timeout)
            res = sock.connect_ex((host, port))
            sock.close()
            if res != 0:
                if settings.DB_FALLBACK_SQLITE_DEV:
                    logger.warning(
                        f"PostgreSQL at {host}:{port} unreachable (code {res}). "
                        "Running in standalone development mode with SQLite (./vivaai.db)."
                    )
                    db_url = "sqlite+aiosqlite:///./vivaai.db"
                else:
                    raise ConnectionError(f"Cannot connect to PostgreSQL at {host}:{port}")
        except Exception as e:
            if settings.DB_FALLBACK_SQLITE_DEV:
                logger.warning(
                    f"Notice: PostgreSQL check at {host}:{port} failed ({type(e).__name__}). "
                    "Using local development SQLite database."
                )
                db_url = "sqlite+aiosqlite:///./vivaai.db"
            else:
                raise

    if db_url.startswith("sqlite"):
        if settings.IS_PRODUCTION:
            raise RuntimeError("CRITICAL: SQLite is strictly forbidden in production.")
        return create_async_engine(db_url, echo=False)

    return create_async_engine(
        db_url,
        echo=False,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20,
    )


engine = _create_engine()

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
