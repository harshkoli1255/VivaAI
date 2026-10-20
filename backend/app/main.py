"""VivaAI FastAPI Application Entry Point with Production Security Headers & Health Checks."""
from contextlib import asynccontextmanager
import logging
import asyncio
from typing import Dict, Any

from fastapi import FastAPI, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api.router import api_router
from app.api.routes import websocket_interview
from app.core.config import settings
from app.core.logging import setup_logging
from app.db.init_db import init_db
from app.db.session import engine, AsyncSessionLocal

setup_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown lifecycle."""
    logger.info(
        "VivaAI backend starting",
        extra={"env": settings.APP_ENV, "production": settings.IS_PRODUCTION},
    )
    await init_db()
    from app.services.scoring_jobs import run_scoring_worker
    worker = asyncio.create_task(run_scoring_worker()) if settings.SCORING_WORKER_ENABLED else None
    try:
        yield
    finally:
        if worker:
            worker.cancel()
            await asyncio.gather(worker, return_exceptions=True)
    logger.info("VivaAI backend shutting down")


app = FastAPI(
    title="VivaAI API",
    description="Standardized University Oral Technical Examination Platform API",
    version="1.0.0",
    lifespan=lifespan,
    docs_url=None if settings.IS_PRODUCTION else "/api/docs",
    redoc_url=None if settings.IS_PRODUCTION else "/api/redoc",
)

# ── CORS Middleware ───────────────────────────────────────────────────────────
# Configured with explicit origins for student-web and faculty-web
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS_LIST,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)


# ── Security Headers Middleware ───────────────────────────────────────────────
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    """Inject hardened HTTP security headers on all responses."""
    response: Response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "microphone=(self), camera=(), geolocation=()"

    if settings.IS_PRODUCTION:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload"

    return response


# ── Global Production Exception Handler ───────────────────────────────────────
if settings.IS_PRODUCTION:
    @app.exception_handler(Exception)
    async def production_exception_handler(request: Request, exc: Exception):
        logger.error(f"Unhandled production exception on {request.url.path}: {exc}", exc_info=True)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": "An internal server error occurred. Please contact the examination administrator."},
        )


app.include_router(api_router, prefix="/api/v1")
app.include_router(websocket_interview.router, prefix="/ws", tags=["websocket"])


# ── Liveness & Readiness Probes ───────────────────────────────────────────────
@app.get("/health", tags=["infra"])
async def health() -> Dict[str, Any]:
    """Legacy/general health check."""
    return {
        "status": "ok",
        "service": "vivaai-backend",
        "version": "1.0.0",
        "env": settings.APP_ENV,
    }


@app.get("/health/live", tags=["infra"])
async def health_live() -> Dict[str, Any]:
    """Process liveness probe."""
    return {
        "status": "live",
        "service": "vivaai-backend",
        "version": "1.0.0",
        "env": settings.APP_ENV,
    }


@app.get("/health/ready", tags=["infra"])
async def health_ready() -> JSONResponse:
    """Dependency readiness probe testing database connectivity."""
    checks = {
        "database": "unknown",
        "env": settings.APP_ENV,
    }
    healthy = True

    # 1. Database check
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as e:
        logger.error(f"Readiness probe failed database check: {e}")
        checks["database"] = f"error: {str(e)}"
        healthy = False

    status_code = status.HTTP_200_OK if healthy else status.HTTP_503_SERVICE_UNAVAILABLE
    return JSONResponse(
        status_code=status_code,
        content={
            "status": "ready" if healthy else "unavailable",
            "checks": checks,
        },
    )


@app.get("/", include_in_schema=False)
async def root():
    return {
        "message": "VivaAI API Server",
        "docs": None if settings.IS_PRODUCTION else "/api/docs",
    }
