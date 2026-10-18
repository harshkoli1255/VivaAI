"""Celery application configuration."""
from celery import Celery
from app.core.config import settings

celery_app = Celery(
    "vivaai",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=["app.workers.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,               # don't ack until task completes
    worker_prefetch_multiplier=1,      # one task at a time per worker
    task_routes={
        "app.workers.tasks.score_session_task": {"queue": "scoring"},
        "app.workers.tasks.generate_questions_task": {"queue": "default"},
    },
)
