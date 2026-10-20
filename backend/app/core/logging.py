"""Structured logging setup."""
import logging
import re
import sys
from pythonjsonlogger import jsonlogger


class RedactCredentials(logging.Filter):
    def filter(self, record):
        message = record.getMessage()
        record.msg = re.sub(r'([?&](?:ticket|access_token|token)=)[^&\s"\']+', r'\1[redacted]', message)
        record.args = ()
        return True


def setup_logging():
    handler = logging.StreamHandler(sys.stdout)
    formatter = jsonlogger.JsonFormatter(
        "%(asctime)s %(name)s %(levelname)s %(message)s"
    )
    handler.setFormatter(formatter)
    handler.addFilter(RedactCredentials())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.INFO)
    # Uvicorn's websocket handshake logger owns handlers outside the root tree.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        log = logging.getLogger(name)
        if not any(isinstance(item, RedactCredentials) for item in log.filters):
            log.addFilter(RedactCredentials())

    # Quiet noisy libs
    for lib in ("uvicorn.access", "sqlalchemy.engine"):
        logging.getLogger(lib).setLevel(logging.WARNING)
