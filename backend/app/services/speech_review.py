"""Session-bound signed transcription receipts; these are never login tokens."""
import base64
import hashlib
import hmac
import json
import time

from app.core.config import settings


def sign_draft(payload: dict) -> str:
    data = dict(payload, expires_at=int(time.time()) + 7200)
    encoded = base64.urlsafe_b64encode(json.dumps(data, separators=(",", ":")).encode()).decode()
    signature = hmac.new(settings.SECRET_KEY.encode(), ("speech-review:" + encoded).encode(), hashlib.sha256).hexdigest()
    return encoded + "." + signature


def verify_draft(receipt: str, session_id: str) -> dict:
    try:
        if len(receipt) > 500000:
            raise ValueError()
        encoded, signature = receipt.rsplit(".", 1)
        expected = hmac.new(settings.SECRET_KEY.encode(), ("speech-review:" + encoded).encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            raise ValueError()
        data = json.loads(base64.urlsafe_b64decode(encoded))
        if data["session_id"] != session_id or data["expires_at"] < time.time():
            raise ValueError()
        return data
    except (ValueError, KeyError, TypeError):
        raise ValueError("Speech draft expired or invalid. Review and resubmit as text.") from None
