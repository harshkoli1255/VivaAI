"""API router — aggregates all route modules."""
from fastapi import APIRouter
from app.api.routes import speech_review, streaming_speech, calibration

from app.api.routes import recordings, auth, users, viva_configs, questions, sessions, transcript, scores, dashboard, websocket_interview, tts

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

api_router.include_router(recordings.router, prefix="/sessions", tags=["recordings"])
api_router.include_router(speech_review.router, prefix="/sessions", tags=["speech"])

api_router.include_router(streaming_speech.router, prefix="/ws", tags=["speech"])

api_router.include_router(calibration.router, prefix="/calibration", tags=["calibration"])
