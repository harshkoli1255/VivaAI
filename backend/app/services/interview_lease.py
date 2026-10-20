"""One active interview connection per session, shared across production workers."""
import asyncio
import logging
from contextlib import asynccontextmanager

from app.core.config import settings

logger = logging.getLogger(__name__)
_local_sessions: set[str] = set()


@asynccontextmanager
async def interview_lease(session_id, websocket):
    client = lock = heartbeat = None
    acquired = False
    try:
        has_remote_redis = (
            bool(settings.REDIS_URL)
            and not settings.REDIS_URL.startswith("redis://localhost")
            and not settings.REDIS_URL.startswith("redis://127.0.0.1")
        )
        if settings.IS_PRODUCTION and has_remote_redis:
            try:
                from redis.asyncio import Redis
                client = Redis.from_url(settings.REDIS_URL, socket_connect_timeout=2, socket_timeout=2)
                lock = client.lock(f"vivaai:interview:{session_id}", timeout=60, blocking=False)
                acquired = await lock.acquire()
                if acquired:
                    async def renew():
                        try:
                            while True:
                                await asyncio.sleep(20)
                                await lock.extend(60, replace_ttl=True)
                        except asyncio.CancelledError:
                            raise
                        except Exception:
                            logger.exception("Interview connection lease lost")
                            await websocket.close(code=4410, reason="Connection interrupted. Please reconnect.")
                    heartbeat = asyncio.create_task(renew())
            except Exception as e:
                logger.warning(f"Remote Redis lease unavailable ({e}), falling back to local memory lease")
                acquired = False

        if not acquired and not lock:
            acquired = session_id not in _local_sessions
            if acquired:
                _local_sessions.add(session_id)

        if not acquired:
            await websocket.close(code=4409, reason="This interview is already open. Close the other tab and retry.")
        yield acquired
    finally:
        if heartbeat:
            heartbeat.cancel()
            await asyncio.gather(heartbeat, return_exceptions=True)
        if acquired:
            if lock:
                try:
                    await lock.release()
                except Exception:
                    logger.warning("Interview lease was already released or expired")
            else:
                _local_sessions.discard(session_id)
        if client:
            await client.aclose()
