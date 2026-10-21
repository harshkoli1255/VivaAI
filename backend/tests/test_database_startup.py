"""Startup must never invalidate PostgreSQL transactions with duplicate DDL."""
import importlib

import pytest
from sqlalchemy import event, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.models.models import VivaConfig


@pytest.mark.asyncio
async def test_repeated_startup_does_not_attempt_duplicate_columns():
    module = importlib.import_module("app.db.init_db")
    statements = []

    def capture(_conn, _cursor, statement, _parameters, _context, _many):
        statements.append(statement)

    event.listen(module.engine.sync_engine, "before_cursor_execute", capture)
    try:
        await module.init_db()
        await module.init_db()
    finally:
        event.remove(module.engine.sync_engine, "before_cursor_execute", capture)

    # The fixture already initialized this schema. Even a caught duplicate ALTER
    # aborts the entire PostgreSQL transaction and rolls back earlier additions.
    assert not any("ALTER TABLE" in statement.upper() for statement in statements)


@pytest.mark.asyncio
async def test_existing_vivas_survive_adding_version_fields(tmp_path, monkeypatch):
    module = importlib.import_module("app.db.init_db")
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'legacy.db'}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(module, "engine", engine)
    monkeypatch.setattr(module, "AsyncSessionLocal", sessions)
    try:
        await module.init_db()
        async with sessions() as session:
            config = (await session.scalars(select(VivaConfig))).one()
            config.title = "Existing faculty viva"
            config_id = config.id
            await session.commit()

        # Reproduce the deployed older table while retaining its viva and bank.
        async with engine.begin() as connection:
            for name in ("course_code", "revision", "previous_version_id", "superseded_by_id"):
                await connection.execute(text(f"ALTER TABLE viva_configs DROP COLUMN {name}"))
        await module.init_db()
        async with sessions() as session:
            config = await session.get(VivaConfig, config_id)
            assert config.title == "Existing faculty viva"
            assert config.course_code == ""
            assert config.revision == 1
            assert config.previous_version_id is None
            assert config.superseded_by_id is None
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_failed_schema_initialization_aborts_startup(monkeypatch):
    module = importlib.import_module("app.db.init_db")

    class UnavailableDatabase:
        def begin(self):
            raise RuntimeError("database unavailable")

    monkeypatch.setattr(module, "engine", UnavailableDatabase())
    with pytest.raises(RuntimeError, match="database unavailable"):
        await module.init_db()
