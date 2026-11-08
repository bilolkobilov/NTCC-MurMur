"""Reject oversized device uploads before the body is received.

FastAPI parses (and spools to disk) the whole multipart body before the handler runs, so a size check inside the
handler comes too late to protect the server. This ASGI middleware looks only at the Content-Length header.
The ASGI server never delivers more body than Content-Length says, so the header is a hard upper bound.
The handler still checks the exact WAV size afterwards.
"""

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from app.config import get_settings

UPLOAD_PATH_PREFIX = "/api/device/upload/"
MULTIPART_OVERHEAD_BYTES = 64 * 1024  # room for the meta JSON and multipart boundaries


class UploadSizeLimitMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["method"] == "POST" and scope["path"].startswith(UPLOAD_PATH_PREFIX):
            response = self._check(dict(scope["headers"]))
            if response is not None:
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)

    @staticmethod
    def _check(headers: dict[bytes, bytes]) -> JSONResponse | None:
        max_mb = get_settings().max_upload_mb
        length = headers.get(b"content-length")
        if length is None:
            return JSONResponse({"detail": "Content-Length header is required for uploads"}, status_code=411)
        if not length.isdigit() or int(length) > max_mb * 1024 * 1024 + MULTIPART_OVERHEAD_BYTES:
            return JSONResponse({"detail": f"request body is larger than the {max_mb} MB upload limit"}, status_code=413)
        return None
