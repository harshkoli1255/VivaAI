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
        if settings.IS_PRODUCTION:
            from redis.asyncio import Redis
            client = Redis.from_url(settings.REDIS_URL, socket_connect_timeout=2, socket_timeout=2)
            lock = client.lock(f"vivaai:interview:{session_id}", timeout=60, blocking=False)
            try:
                acquired = await lock.acquire()
            except Exception:
                logger.exception("Interview connection lease unavailable")
                await websocket.close(code=4410, reason="Connection service unavailable. Please retry shortly.")
                yield False
                return
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
        else:
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
