"""API router — aggregates all route modules."""
from fastapi import APIRouter

from app.api.routes import auth, users, viva_configs, questions, sessions, transcript, scores, dashboard, websocket_interview, tts

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(viva_configs.router, prefix="/viva-configs", tags=["viva-configs"])
api_router.include_router(questions.router, prefix="/questions", tags=["questions"])
api_router.include_router(sessions.router, prefix="/sessions", tags=["sessions"])
api_router.include_router(transcript.router, prefix="/transcript", tags=["transcript"])
api_router.include_router(scores.router, prefix="/scores", tags=["scores"])
api_router.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"])
api_router.include_router(websocket_interview.router, prefix="/ws", tags=["websocket"])
api_router.include_router(tts.router, prefix="", tags=["tts"])
