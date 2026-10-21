"""Application configuration with Pydantic Settings."""
from typing import List, Optional
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App environment
    APP_ENV: str = "development"  # development | test | staging | production
    SECRET_KEY: str = "change_me_in_prod"
    DEMO_MODE: bool = True

    # Separate frontend origins for student and faculty apps, including Cloudflare tunnels
    CORS_ORIGINS: str = (
        "http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001,"
        "https://viva-ai-delta.vercel.app,https://viva-ai-8asv.vercel.app,"
        "https://beads-cornell-resistant-patches.trycloudflare.com,"
        "https://shield-developed-fioricet-mixture.trycloudflare.com,"
        "https://flex-cashiers-conclusion-ask.trycloudflare.com"
    )

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://vivaai:vivaai_pass@localhost:5432/vivaai"
    DB_FALLBACK_SQLITE_DEV: bool = True  # strictly development only

    SCORING_WORKER_ENABLED: bool = True

    # Disabled until the institution approves both values. No automatic purge.
    RETENTION_DAYS: int = 0
    RETENTION_POLICY_ID: str = ""

    # Redis / Celery
    REDIS_URL: str = "redis://localhost:6379/0"

    # MinIO / S3 Audio Storage
    MINIO_ENDPOINT: str = "localhost:9000"
    MINIO_BUCKET: str = "vivaai-audio"
    AWS_ACCESS_KEY_ID: str = "vivaai_minio"
    AWS_SECRET_ACCESS_KEY: str = "vivaai_minio_pass"
    AWS_DEFAULT_REGION: str = "us-east-1"
    S3_ENDPOINT_URL: str = "http://localhost:9000"
    MAX_AUDIO_UPLOAD_BYTES: int = 50 * 1024 * 1024  # 50 MB
    AUDIO_PRESIGNED_URL_EXPIRE_SECS: int = 300  # 5 minutes short-lived signed access
    AUDIO_LOCAL_DIR: str = "data/audio"

    # LiveKit & WebSocket
    LIVEKIT_URL: str = "ws://localhost:7880"
    LIVEKIT_API_KEY: str = "devkey"
    LIVEKIT_API_SECRET: str = "devsecret"
    NEXT_PUBLIC_WS_URL: Optional[str] = None
    WS_URL: Optional[str] = None

    # STT
    DEEPGRAM_API_KEY: str = ""
    DEEPGRAM_STT_MODEL: str = "nova-2"
    DEEPGRAM_MULTILINGUAL_MODEL: str = "nova-3"

    # TTS
    TTS_PROVIDER: str = "elevenlabs"
    ELEVENLABS_API_KEY: str = ""
    ELEVENLABS_VOICE_ID: str = "Xb7hH8MSUJpSbSDYk0k2"
    DEEPGRAM_VOICE_MODEL: str = "aura-asteria-en"
    OPENAI_API_KEY: str = ""
    OPENAI_BASE_URL: Optional[str] = None

    # LLM
    LLM_PROVIDER: str = "mock"
    LLM_FAST_MODEL: str = "gpt-4o-mini"
    LLM_STRONG_MODEL: str = "gpt-4o"
    ANTHROPIC_API_KEY: str = ""

    # Mock mode
    MOCK_MODE: bool = True

    # JWT & Session
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 1 day
    WS_TICKET_EXPIRE_SECONDS: int = 60  # Short-lived one-time ticket for WebSockets
    SESSION_COOKIE_NAME: str = "vivaai_session"
    COOKIE_DOMAIN: Optional[str] = None
    COOKIE_SAMESITE: str = "lax"  # "lax" or "none" for cross-origin HTTPS
    COOKIE_SECURE: bool = False   # True in production

    @model_validator(mode="after")
    def validate_production_settings(self):
        is_prod = self.APP_ENV.lower() in ("production", "prod")

        if is_prod:
            insecure_defaults = [
                "change_me_in_prod",
                "secret",
                "password",
                "vivaai_secret",
                "default",
                "",
            ]
            if not self.SECRET_KEY or self.SECRET_KEY in insecure_defaults or len(self.SECRET_KEY) < 32:
                raise ValueError(
                    "CRITICAL: Production startup aborted. SECRET_KEY must be a cryptographically "
                    "secure string of at least 32 characters and cannot be a default value."
                )

            # Never permit demo or mock mode in production
            self.DEMO_MODE = False
            self.MOCK_MODE = False

            # Cookies must be secure in production
            self.COOKIE_SECURE = True

            # Database fallback to SQLite is strictly forbidden in production
            self.DB_FALLBACK_SQLITE_DEV = False
            if "sqlite" in self.DATABASE_URL.lower():
                raise ValueError("CRITICAL: SQLite is strictly forbidden in production environments.")

        return self

    @property
    def CORS_ORIGINS_LIST(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def IS_PRODUCTION(self) -> bool:
        return self.APP_ENV.lower() in ("production", "prod")


settings = Settings()
