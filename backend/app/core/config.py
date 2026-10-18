"""Application configuration with Pydantic Settings."""
from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App
    APP_ENV: str = "development"
    SECRET_KEY: str = "change_me_in_prod"
    CORS_ORIGINS: str = "http://localhost:3000"

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://vivaai:vivaai_pass@localhost:5432/vivaai"

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # MinIO / S3
    MINIO_ENDPOINT: str = "localhost:9000"
    MINIO_BUCKET: str = "vivaai-audio"
    AWS_ACCESS_KEY_ID: str = "vivaai_minio"
    AWS_SECRET_ACCESS_KEY: str = "vivaai_minio_pass"
    AWS_DEFAULT_REGION: str = "us-east-1"
    S3_ENDPOINT_URL: str = "http://localhost:9000"

    # LiveKit
    LIVEKIT_URL: str = "ws://localhost:7880"
    LIVEKIT_API_KEY: str = "devkey"
    LIVEKIT_API_SECRET: str = "devsecret"

    # STT
    DEEPGRAM_API_KEY: str = ""

    # TTS
    TTS_PROVIDER: str = "mock"
    ELEVENLABS_API_KEY: str = ""
    OPENAI_API_KEY: str = ""

    # LLM
    LLM_PROVIDER: str = "mock"
    LLM_FAST_MODEL: str = "gpt-4o-mini"
    LLM_STRONG_MODEL: str = "gpt-4o"
    ANTHROPIC_API_KEY: str = ""

    # Mock mode
    MOCK_MODE: bool = True

    # JWT
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 1 day

    @property
    def CORS_ORIGINS_LIST(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",")]


settings = Settings()
