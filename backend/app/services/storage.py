"""
S3/MinIO storage service for audio files.
Supports incremental uploads (multipart) so a crash never loses a recording.
"""
from __future__ import annotations

import logging
import os
from typing import AsyncIterator, Optional

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.core.config import settings

logger = logging.getLogger(__name__)


def get_s3_client():
    return boto3.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT_URL,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        region_name=settings.AWS_DEFAULT_REGION,
        config=Config(signature_version="s3v4"),
    )


class AudioStorage:
    def __init__(self):
        self.client = get_s3_client()
        self.bucket = settings.MINIO_BUCKET
        self._ensure_bucket()

    def _ensure_bucket(self):
        try:
            self.client.head_bucket(Bucket=self.bucket)
        except ClientError:
            try:
                self.client.create_bucket(Bucket=self.bucket)
                logger.info(f"Created bucket {self.bucket}")
            except Exception as e:
                logger.warning(f"Could not create bucket: {e}")

    def upload_bytes(self, key: str, data: bytes, content_type: str = "audio/wav") -> str:
        """Upload a complete audio file."""
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
        )
        return key

    def start_multipart(self, key: str, content_type: str = "audio/webm") -> str:
        """Start an incremental/multipart upload. Returns upload_id."""
        resp = self.client.create_multipart_upload(
            Bucket=self.bucket,
            Key=key,
            ContentType=content_type,
        )
        return resp["UploadId"]

    def upload_part(
        self, key: str, upload_id: str, part_number: int, data: bytes
    ) -> dict:
        """Upload one part. Returns the ETag dict for completion."""
        resp = self.client.upload_part(
            Bucket=self.bucket,
            Key=key,
            UploadId=upload_id,
            PartNumber=part_number,
            Body=data,
        )
        return {"PartNumber": part_number, "ETag": resp["ETag"]}

    def complete_multipart(self, key: str, upload_id: str, parts: list) -> str:
        """Complete the multipart upload."""
        self.client.complete_multipart_upload(
            Bucket=self.bucket,
            Key=key,
            UploadId=upload_id,
            MultipartUpload={"Parts": parts},
        )
        return key

    def abort_multipart(self, key: str, upload_id: str):
        """Abort a multipart upload to free storage."""
        try:
            self.client.abort_multipart_upload(
                Bucket=self.bucket, Key=key, UploadId=upload_id
            )
        except Exception as e:
            logger.error(f"Failed to abort multipart upload: {e}")

    def get_presigned_url(self, key: str, expires_in: int = 3600) -> str:
        """Get a presigned URL for reading."""
        return self.client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=expires_in,
        )

    def delete(self, key: str):
        try:
            self.client.delete_object(Bucket=self.bucket, Key=key)
        except Exception as e:
            logger.error(f"Failed to delete {key}: {e}")


# Singleton
_storage: Optional[AudioStorage] = None


def get_audio_storage() -> AudioStorage:
    global _storage
    if _storage is None:
        try:
            _storage = AudioStorage()
        except Exception as e:
            logger.warning(f"Audio storage unavailable: {e} — uploads will be skipped")
            _storage = None
    return _storage
