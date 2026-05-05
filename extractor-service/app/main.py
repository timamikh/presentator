"""extractor-service entrypoint.

Endpoints:
  GET  /health                 — liveness
  POST /extract                — { attachmentId, force? } → kicks off async extraction
                                 and replies 202 immediately. Persists results via
                                 PATCH /api/attachments/internal/<id> on api-service.

The service is intentionally stateless (no DB, no Redis) — api-service is the
single source of truth. Idempotency is delegated to api-service: the internal
endpoint short-circuits when extraction_status='done' unless force=true.
"""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import Optional

import httpx
from fastapi import BackgroundTasks, FastAPI, HTTPException, status
from pydantic import BaseModel, Field

from .config import Settings
from .extract import ExtractionResult, dispatch

logger = logging.getLogger("extractor")
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))


class ExtractRequest(BaseModel):
    attachmentId: str = Field(..., min_length=8, max_length=64)
    force: bool = False


class ExtractResponse(BaseModel):
    accepted: bool
    attachmentId: str


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    s = settings or Settings.from_env()
    app = FastAPI(title="presentator-extractor", version="1.0.0")

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.post("/extract", response_model=ExtractResponse, status_code=status.HTTP_202_ACCEPTED)
    async def extract(payload: ExtractRequest, background_tasks: BackgroundTasks):
        background_tasks.add_task(_process_attachment, s, payload.attachmentId, payload.force)
        return ExtractResponse(accepted=True, attachmentId=payload.attachmentId)

    return app


async def _process_attachment(settings: Settings, attachment_id: str, force: bool) -> None:
    """Background worker: fetch metadata, run extraction, push result back.

    Errors are reported to api-service so the UI can show a 'failed' badge with
    the error message. We never raise to the FastAPI layer — by the time the
    background task runs the original HTTP request has already returned 202.
    """
    try:
        async with httpx.AsyncClient(timeout=settings.request_timeout_s) as client:
            meta = await _fetch_attachment(client, settings, attachment_id)
            if meta is None:
                return

            if meta.get("extraction_status") == "done" and not force:
                logger.info("attachment=%s already done, skipping (no force)", attachment_id)
                return

            await _patch_status(client, settings, attachment_id, status="processing")

            storage_path = meta.get("storage_path")
            if not storage_path:
                await _patch_status(
                    client,
                    settings,
                    attachment_id,
                    status="failed",
                    error="Missing storage_path",
                )
                return

            path = Path(storage_path)
            if not path.exists():
                await _patch_status(
                    client,
                    settings,
                    attachment_id,
                    status="failed",
                    error=f"File not found: {storage_path}",
                )
                return

            file_size_bytes = path.stat().st_size
            max_bytes = settings.max_file_mb * 1024 * 1024
            if file_size_bytes > max_bytes:
                await _patch_status(
                    client,
                    settings,
                    attachment_id,
                    status="skipped",
                    error=f"File too large ({file_size_bytes} > {max_bytes} bytes)",
                )
                return

            result = await asyncio.to_thread(
                dispatch,
                path=path,
                mime_type=meta.get("mime_type"),
                text_limit=settings.extracted_text_limit,
                summary_max_chars=settings.summary_max_chars,
            )

            await _persist_result(client, settings, attachment_id, result)
    except Exception as exc:  # noqa: BLE001 — outermost background task guard
        logger.exception("Extraction failed for attachment=%s", attachment_id)
        try:
            async with httpx.AsyncClient(timeout=settings.request_timeout_s) as client:
                await _patch_status(
                    client,
                    settings,
                    attachment_id,
                    status="failed",
                    error=str(exc)[:500],
                )
        except Exception:
            logger.exception("Failed to report error for attachment=%s", attachment_id)


async def _fetch_attachment(
    client: httpx.AsyncClient, settings: Settings, attachment_id: str
) -> Optional[dict]:
    url = f"{settings.api_base_url}/api/attachments/internal/{attachment_id}"
    response = await client.get(url, headers={"X-Internal-Key": settings.internal_api_key})
    if response.status_code == 404:
        logger.warning("attachment=%s not found", attachment_id)
        return None
    response.raise_for_status()
    return response.json()


async def _patch_status(
    client: httpx.AsyncClient,
    settings: Settings,
    attachment_id: str,
    *,
    status: str,
    error: Optional[str] = None,
) -> None:
    url = f"{settings.api_base_url}/api/attachments/internal/{attachment_id}"
    body = {"extractionStatus": status}
    if error is not None:
        body["extractionError"] = error
    response = await client.patch(
        url,
        headers={"X-Internal-Key": settings.internal_api_key},
        json=body,
    )
    response.raise_for_status()


async def _persist_result(
    client: httpx.AsyncClient,
    settings: Settings,
    attachment_id: str,
    result: ExtractionResult,
) -> None:
    body = {
        "extractionStatus": "done",
        "extractedText": result.text or None,
        "contentSummary": result.summary or None,
    }
    if result.width is not None:
        body["width"] = result.width
    if result.height is not None:
        body["height"] = result.height

    url = f"{settings.api_base_url}/api/attachments/internal/{attachment_id}"
    response = await client.patch(
        url,
        headers={"X-Internal-Key": settings.internal_api_key},
        json=body,
    )
    response.raise_for_status()


def _make_default_app() -> FastAPI:
    """Lazy app factory used at import time.

    In dev / docker INTERNAL_API_KEY is provided via env; under pytest it is
    absent and Settings.from_env() would crash on import. Catching the error
    here lets test_extract.py (pure functions) load the package without env.
    """
    try:
        return create_app()
    except RuntimeError as exc:
        logger.warning("Deferring app creation: %s", exc)
        placeholder = FastAPI()

        @placeholder.get("/health")
        async def _health():
            return {"status": "uninitialized", "error": str(exc)}

        return placeholder


app = _make_default_app()
