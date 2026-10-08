"""Single-operator, loopback-only demonstration. No model API calls in /lab/run."""

from __future__ import annotations

import os
import secrets
import uuid
from pathlib import Path

from fastapi import HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware

from pii_gateway.api import _env_detector, create_app
from pii_gateway.pipeline import Gateway
from pii_gateway.policy import Policy
from pii_gateway.vault import Vault


class LabRequest(BaseModel):
    text: str = Field(min_length=1, max_length=10000)
    policy: str = "private"


def create_lab(detector=None, use_env=True):
    if use_env:
        if os.environ.get("PII_DETECTOR") == "remote":
            raise ValueError("the local lab does not allow remote detection")
        detector = detector or _env_detector()
    vault = Vault(os.urandom(32), ttl_s=3600)
    app = create_app(detector=detector, vault=vault, use_env=False)
    app.state.api_key = secrets.token_urlsafe(32)
    app.state.restore_key = secrets.token_urlsafe(32)
    session = secrets.token_urlsafe(32)
    gateway = Gateway(detector, vault)
    app.add_middleware(
        TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "testserver"]
    )

    @app.middleware("http")
    async def local_boundary(request: Request, call_next):
        origin = request.headers.get("origin")
        if origin and origin != str(request.base_url).rstrip("/"):
            return JSONResponse({"detail": "cross-origin requests rejected"}, status_code=403)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self'; "
            "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"
        )
        return response

    web = Path(__file__).parent / "web"

    @app.get("/", include_in_schema=False)
    def home():
        return FileResponse(web / "index.html")

    @app.get("/assets/{name}", include_in_schema=False)
    def asset(name: str):
        if name not in ("app.js", "style.css"):
            raise HTTPException(404)
        return FileResponse(web / name)

    @app.get("/lab/session", include_in_schema=False)
    def bootstrap():
        return {"session": session, "detector": gateway.detector_name}

    @app.post("/lab/run")
    def run(req: LabRequest, request: Request):
        if not secrets.compare_digest(request.headers.get("X-Lab-Session", ""), session):
            raise HTTPException(403, "invalid local session")
        if req.policy not in ("strict", "private", "hashed"):
            raise HTTPException(400, "unknown lab policy")
        try:
            conversation = uuid.uuid4().hex
            result = gateway.redact(req.text, Policy.load(req.policy), "lab", conversation)
            masked = gateway.redact(req.text, Policy.load("strict"), "lab", conversation)
            # Explicitly simulated: this text never goes to an external provider.
            simulated = "Support draft received: " + result.text
            restored, count = vault.restore("lab", conversation, simulated)
        except Exception:
            raise HTTPException(503, "detection unavailable; no result returned") from None
        return {
            "redacted": result.text,
            "masked": masked.text,
            "entities": result.entities,
            "simulated_reply": simulated,
            "restored_reply": restored,
            "tokens_restored": count,
            "detector": gateway.detector_name,
            "external_requests": 0,
        }

    return app
