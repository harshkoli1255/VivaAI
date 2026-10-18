"""VivaAI FastAPI Application Entry Point"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.core.logging import setup_logging
from app.db.session import engine
from app.api.router import api_router

setup_logging()
logger = logging.getLogger(__name__)


from app.db.init_db import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown events."""
    logger.info("VivaAI backend starting", extra={"env": settings.APP_ENV})
    await init_db()
    yield
    logger.info("VivaAI backend shutting down")


app = FastAPI(
    title="VivaAI API",
    description="AI-powered voice interview platform",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS_LIST,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")


@app.get("/health", tags=["infra"])
async def health():
    return {"status": "ok", "version": "1.0.0", "env": settings.APP_ENV}


@app.get("/", include_in_schema=False)
async def root():
    return {"message": "VivaAI API — see /api/docs"}
