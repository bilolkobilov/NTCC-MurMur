"""FastAPI application: middleware, error mapping and routers."""

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api import admin, auth, device, doctor, patient
from app.config import get_settings
from app.db import get_db
from app.services.errors import ServiceError
from app.upload_limit import UploadSizeLimitMiddleware


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="MurMur API", version="0.1.0")
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
    def health(db: Session = Depends(get_db)) -> dict[str, str]:
        db.execute(text("SELECT 1"))
        return {"status": "ok", "database": "ok"}

    app.include_router(auth.router)
    app.include_router(admin.router)
    app.include_router(doctor.router)
    app.include_router(patient.router)
    app.include_router(device.router)
    return app


app = create_app()
