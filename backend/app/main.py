"""FastAPI application: middleware, error mapping, routers and (when built) the web app itself."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import text

from app.api import admin, auth, device, doctor, patient
from app.config import get_settings
from app.deps import DbSession
from app.services import analyzer
from app.services.errors import ServiceError
from app.upload_limit import UploadSizeLimitMiddleware


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # A real model takes seconds to load: do it before the server says it is ready, not during the first exam.
    if get_settings().ai_model != "dummy":
        await run_in_threadpool(analyzer.get_analyzer)
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="MurMur API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(UploadSizeLimitMiddleware)

    @app.exception_handler(ServiceError)
    def service_error(_: Request, exc: ServiceError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

    @app.get("/api/health", tags=["health"])
    def health(db: DbSession) -> dict[str, str]:
        db.execute(text("SELECT 1"))
        return {"status": "ok", "database": "ok"}

    app.include_router(auth.router)
    app.include_router(admin.router)
    app.include_router(doctor.router)
    app.include_router(patient.router)
    app.include_router(device.router)

    dist = settings.frontend_dist_path
    if (dist / "index.html").is_file():  # demo/production: one process serves API and web app (no CORS)
        _serve_web_app(app, dist)
    return app


def _serve_web_app(app: FastAPI, dist: Path) -> None:
    """Serve `frontend/dist`: real files as they are, every other non-API path gets index.html (client routing).

    Registered last, so it never shadows an API route; unknown `/api/...` paths stay a JSON 404.
    """
    root = dist.resolve()
    index = root / "index.html"

    @app.get("/{path:path}", include_in_schema=False)
    def web_app(path: str) -> FileResponse:
        if path == "api" or path.startswith("api/"):
            raise HTTPException(404, "Not Found")
        candidate = (root / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(root):
            # Vite puts a content hash into every asset name, so those files never change.
            immutable = path.startswith("assets/")
            headers = {"Cache-Control": "public, max-age=31536000, immutable" if immutable else "no-cache"}
            return FileResponse(candidate, headers=headers)
        return FileResponse(index, headers={"Cache-Control": "no-cache"})


app = create_app()
