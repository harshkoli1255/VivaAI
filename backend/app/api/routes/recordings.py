"""Immutable, idempotent recording uploads and reconstruction across page reloads."""
import asyncio
import hashlib
import uuid
from collections import defaultdict
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from fastapi.responses import Response
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from app.core.security import get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models.models import AudioChunk, VivaSession
from app.services.recordings import render_recording

router = APIRouter()
ALLOWED = {"audio/webm", "audio/mp4", "audio/ogg", "audio/wav"}


async def owned_session(db, session_id, current):
    session = await db.get(VivaSession, session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    if current.get("role") == "student" and str(session.student_id) != current["sub"]:
        raise HTTPException(403, "Recording access denied")
    if not session.consent_given:
        raise HTTPException(409, "Recording consent is required")
    return session


@router.put("/{session_id}/recording/chunks/{chunk_id}")
async def upload_chunk(session_id: uuid.UUID, chunk_id: uuid.UUID, request: Request,
    capture_id: uuid.UUID, sequence: int = Query(ge=0, le=30000),
    start_secs: float = Query(ge=0, le=7200, allow_inf_nan=False),
    recording_kind: Literal["candidate", "conversation"] = "candidate",
    db=Depends(get_db), current=Depends(get_current_user)):
    await owned_session(db, session_id, current)
    content_type = request.headers.get("content-type", "").split(";")[0]
    if content_type not in ALLOWED:
        raise HTTPException(415, "Unsupported recording format")
    payload = bytearray()
    async for part in request.stream():
        payload.extend(part)
        if len(payload) > 2 * 1024 * 1024:
            raise HTTPException(413, "Recording fragments must be at most 2 MB")
    if not payload:
        raise HTTPException(400, "Empty recording fragment")
    digest = hashlib.sha256(payload).hexdigest()
    existing = await db.get(AudioChunk, chunk_id)
    if existing:
        if (existing.session_id != session_id or existing.capture_id != capture_id or existing.sequence != sequence
                or existing.digest != digest or existing.start_secs != start_secs or existing.recording_kind != recording_kind):
            raise HTTPException(409, "Recording reference already contains different data")
        return {"id": str(chunk_id), "stored": True, "duplicate": True}
    # Serialize the per-session quota check on PostgreSQL.
    await db.execute(select(VivaSession.id).where(VivaSession.id == session_id).with_for_update())
    total = await db.scalar(select(func.coalesce(func.sum(func.length(AudioChunk.data)), 0)).where(AudioChunk.session_id == session_id))
    if total + len(payload) > settings.MAX_AUDIO_UPLOAD_BYTES:
        raise HTTPException(413, "Session recording exceeds the recording limit")
    db.add(AudioChunk(id=chunk_id, session_id=session_id, capture_id=capture_id, sequence=sequence,
        start_secs=start_secs, content_type=content_type, recording_kind=recording_kind, digest=digest, data=bytes(payload)))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        # A racing retry is successful only when all immutable metadata match.
        existing = await db.get(AudioChunk, chunk_id)
        if existing and existing.session_id == session_id and existing.digest == digest and existing.capture_id == capture_id and existing.sequence == sequence and existing.start_secs == start_secs and existing.recording_kind == recording_kind:
            return {"id": str(chunk_id), "stored": True, "duplicate": True}
        raise HTTPException(409, "Recording sequence already exists")
    return {"id": str(chunk_id), "stored": True, "duplicate": False}


@router.get("/{session_id}/recording")
async def recording_manifest(session_id: uuid.UUID, db=Depends(get_db), current=Depends(get_current_user)):
    await owned_session(db, session_id, current)
    rows = (await db.execute(select(AudioChunk.capture_id, AudioChunk.sequence, AudioChunk.start_secs, AudioChunk.recording_kind).where(
        AudioChunk.session_id == session_id).order_by(AudioChunk.start_secs, AudioChunk.sequence))).all()
    captures = defaultdict(list)
    for capture, sequence, start, kind in rows:
        captures[str(capture)].append((sequence, start, kind))
    return {"session_id": str(session_id), "chunk_count": len(rows), "captures": [
        {"id": capture, "start_secs": parts[0][1], "chunks": len(parts), "recording_kind": parts[0][2],
         "missing_sequences": sorted(set(range(max(p[0] for p in parts) + 1)) - {p[0] for p in parts})}
        for capture, parts in captures.items()]}


async def reconstructed_audio(db, session_id):
    chunks = list((await db.scalars(select(AudioChunk).where(AudioChunk.session_id == session_id).order_by(
        AudioChunk.start_secs, AudioChunk.capture_id, AudioChunk.sequence))).all())
    if not chunks:
        return None
    try:
        data = await asyncio.to_thread(render_recording, chunks)
    except ValueError as exc:
        raise HTTPException(409, str(exc))
    except Exception:
        raise HTTPException(503, "Recording is saved but playback is temporarily unavailable")
    return Response(data, media_type="audio/wav", headers={"Cache-Control": "private, no-store"})
