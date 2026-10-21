"""Serialize enrollment and question-bank writes around immutable used versions."""
from datetime import datetime, timezone
from fastapi import HTTPException
from sqlalchemy import select, update, func
from app.models.models import VivaConfig, VivaSession


async def lock_config(db, config_id):
    # The no-op write obtains a real write lock on SQLite as well as PostgreSQL.
    # Explicit updated_at avoids invalidating edit tokens merely on enrollment.
    result = await db.execute(update(VivaConfig).where(VivaConfig.id == config_id)
        .values(updated_at=VivaConfig.updated_at).execution_options(synchronize_session=False))
    if not result.rowcount:
        raise HTTPException(404, "Viva configuration not found")
    return await db.scalar(select(VivaConfig).where(VivaConfig.id == config_id).execution_options(populate_existing=True))


async def guard_question_mutation(db, config_id):
    config = await lock_config(db, config_id)
    used = await db.scalar(select(func.count(VivaSession.id)).where(VivaSession.viva_config_id == config_id))
    if config.superseded_by_id or used:
        raise HTTPException(409, "This question bank is preserved for existing interviews. Publish changes through the versioned viva editor.")
    config.updated_at = datetime.now(timezone.utc)
    return config
