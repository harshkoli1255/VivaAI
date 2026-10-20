"""
Storage service for viva session audio files.
Supports dual storage: S3/MinIO when available, with automatic local filesystem
storage fallback so audio is never lost in development, Docker, or edge environments.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Optional

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.core.config import settings

logger = logging.getLogger(__name__)


def get_s3_client():
    try:
        return boto3.client(
            "s3",
            endpoint_url=settings.S3_ENDPOINT_URL,
            aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
            aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
            region_name=settings.AWS_DEFAULT_REGION,
            config=Config(signature_version="s3v4", connect_timeout=2, read_timeout=3),
        )
    except Exception as e:
        logger.debug(f"S3 client initialization notice: {e}")
        return None


class AudioStorage:
    def __init__(self):
        self.bucket = settings.MINIO_BUCKET
        self.client = None
        self._s3_available = False

        # Local storage directory path
        base_dir = Path(__file__).resolve().parent.parent.parent
        self.local_dir = base_dir / settings.AUDIO_LOCAL_DIR
        try:
            self.local_dir.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            logger.warning(f"Failed to create local audio dir {self.local_dir}: {e}")

        # Initialize S3 if configured
        try:
            self.client = get_s3_client()
            if self.client:
                self._ensure_bucket()
        except Exception as e:
            logger.info(f"S3/MinIO unavailable ({e}); using resilient local audio storage.")

    def _ensure_bucket(self):
        if not self.client:
            return
        try:
            self.client.head_bucket(Bucket=self.bucket)
            self._s3_available = True
        except ClientError:
            try:
                self.client.create_bucket(Bucket=self.bucket)
                self._s3_available = True
                logger.info(f"Created S3 bucket {self.bucket}")
            except Exception as e:
                logger.info(f"Could not create S3 bucket: {e}; falling back to local audio storage.")
                self._s3_available = False
        except Exception:
            self._s3_available = False

    def get_local_path_for_session(self, session_id: Any, extension: str = "webm") -> Path:
        """Return the target local filesystem path for a session's audio."""
        return self.local_dir / f"{str(session_id).strip()}.{extension.lstrip('.')}"

    def save_session_audio(
        self,
        session_id: Any,
        data: bytes,
        content_type: str = "audio/webm",
    ) -> str:
        """
        Save complete session audio to local disk and S3 (if online).
        Returns the persistent storage key.
        """
        session_id_str = str(session_id).strip()
        ext = "webm"
        if "wav" in content_type:
            ext = "wav"
        elif "mp4" in content_type or "m4a" in content_type:
            ext = "mp4"

        saved = False
        # 1. Always save to local filesystem for instant, reliable retrieval
        local_path = self.get_local_path_for_session(session_id_str, ext)
        try:
            local_path.parent.mkdir(parents=True, exist_ok=True)
            with open(local_path, "wb") as f:
                f.write(data)
            saved = True
            logger.info(f"Saved {len(data)} bytes of session audio to {local_path}")
        except Exception as e:
            logger.error(f"Failed saving audio to local disk: {e}")

        key = f"sessions/{session_id_str}/audio.{ext}"

        # 2. Upload to S3 if available
        if self._s3_available and self.client:
            try:
                self.client.put_object(
                    Bucket=self.bucket,
                    Key=key,
                    Body=data,
                    ContentType=content_type,
                )
                saved = True
                logger.info(f"Uploaded audio to S3 key {key}")
            except Exception as e:
                logger.warning(f"S3 upload failed ({e}); local copy retained at {local_path}")

        if not saved:
            raise OSError("Audio could not be saved to any storage destination")
        return key

    def get_local_audio_path(self, session_id_or_key: Any) -> Optional[Path]:
        """Locate existing local audio file by session ID or key."""
        session_str = str(session_id_or_key).strip()
        clean_id = session_str.split("/")[-1].split(".")[0]
        if "sessions/" in session_str:
            parts = session_str.split("/")
            if len(parts) >= 2:
                clean_id = parts[1]

        for ext in ("webm", "wav", "mp4", "ogg", "mp3"):
            candidate = self.local_dir / f"{clean_id}.{ext}"
            if candidate.exists() and candidate.stat().st_size > 0:
                return candidate
        return None

    def has_audio(self, session_id_or_key: Any) -> bool:
        """Check whether audio exists in local storage or S3."""
        if self.get_local_audio_path(session_id_or_key):
            return True
        if self._s3_available and self.client:
            try:
                key = str(session_id_or_key).strip()
                if not key.startswith("sessions/"):
                    key = f"sessions/{key}/interview.webm"
                self.client.head_object(Bucket=self.bucket, Key=key)
                return True
            except Exception:
                pass
        return False

    def upload_bytes(self, key: str, data: bytes, content_type: str = "audio/wav") -> str:
        """Upload a complete audio file to S3 and local storage."""
        # Save local copy
        clean_name = key.replace("/", "_")
        try:
            with open(self.local_dir / clean_name, "wb") as f:
                f.write(data)
        except Exception:
            pass

        if self._s3_available and self.client:
            try:
                self.client.put_object(
                    Bucket=self.bucket,
                    Key=key,
                    Body=data,
                    ContentType=content_type,
                )
            except Exception as e:
                logger.warning(f"S3 upload_bytes failed: {e}")
        return key

    def start_multipart(self, key: str, content_type: str = "audio/webm") -> Optional[str]:
        if not self._s3_available or not self.client:
            return None
        try:
            resp = self.client.create_multipart_upload(
                Bucket=self.bucket,
                Key=key,
                ContentType=content_type,
            )
            return resp["UploadId"]
        except Exception as e:
            logger.warning(f"S3 start_multipart failed: {e}")
            return None

    def upload_part(
        self, key: str, upload_id: str, part_number: int, data: bytes
    ) -> Optional[dict]:
        if not self._s3_available or not self.client:
            return None
        try:
            resp = self.client.upload_part(
                Bucket=self.bucket,
                Key=key,
                UploadId=upload_id,
                PartNumber=part_number,
                Body=data,
            )
            return {"PartNumber": part_number, "ETag": resp["ETag"]}
        except Exception as e:
            logger.warning(f"S3 upload_part failed: {e}")
            return None

    def complete_multipart(self, key: str, upload_id: str, parts: list) -> str:
        if self._s3_available and self.client:
            try:
                self.client.complete_multipart_upload(
                    Bucket=self.bucket,
                    Key=key,
                    UploadId=upload_id,
                    MultipartUpload={"Parts": parts},
                )
            except Exception as e:
                logger.warning(f"S3 complete_multipart failed: {e}")
        return key

    def abort_multipart(self, key: str, upload_id: str):
        if self._s3_available and self.client:
            try:
                self.client.abort_multipart_upload(
                    Bucket=self.bucket, Key=key, UploadId=upload_id
                )
            except Exception as e:
                logger.error(f"Failed to abort multipart upload: {e}")

    def get_presigned_url(self, key: str, expires_in: int = 3600) -> Optional[str]:
        """Get a presigned URL if S3 is active."""
        if self._s3_available and self.client:
            try:
                return self.client.generate_presigned_url(
                    "get_object",
                    Params={"Bucket": self.bucket, "Key": key},
                    ExpiresIn=expires_in,
                )
            except Exception as e:
                logger.debug(f"Presigned URL generation unavailable: {e}")
        return None

    def delete(self, key: str):
        local_path = self.get_local_audio_path(key)
        if local_path and local_path.exists():
            try:
                local_path.unlink()
            except Exception:
                pass
        if self._s3_available and self.client:
            try:
                self.client.delete_object(Bucket=self.bucket, Key=key)
            except Exception as e:
                logger.error(f"Failed to delete {key}: {e}")


# Singleton
_storage: Optional[AudioStorage] = None


def get_audio_storage() -> AudioStorage:
    global _storage
    if _storage is None:
        _storage = AudioStorage()
    return _storage
