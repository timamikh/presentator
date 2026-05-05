"""HTTP layer tests for extractor-service.

Use httpx.MockTransport to stand in for api-service so the test suite stays
hermetic (no docker, no fixtures). The main entry point /extract returns 202
immediately and dispatches to a background task; we exercise the worker
(_process_attachment) directly to keep the assertions deterministic.
"""

from __future__ import annotations

import asyncio
import io
import json
from pathlib import Path
from typing import Optional

import httpx
import pytest

from app.config import Settings
from app.main import _process_attachment


def _make_settings(library_root: Path) -> Settings:
    return Settings(
        api_base_url="http://api.test",
        internal_api_key="secret",
        library_root=str(library_root),
        max_file_mb=1,
        summary_max_chars=200,
        extracted_text_limit=10_000,
        request_timeout_s=5.0,
    )


class _RecordingTransport(httpx.MockTransport):
    def __init__(self, attachment: dict):
        self._attachment = attachment
        self.calls: list[dict] = []
        super().__init__(self._handler)

    def _handler(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(
            {
                "method": request.method,
                "url": str(request.url),
                "headers": dict(request.headers),
                "body": json.loads(request.content) if request.content else None,
            }
        )
        if request.method == "GET":
            return httpx.Response(200, json=self._attachment)
        if request.method == "PATCH":
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(405)


@pytest.mark.asyncio
async def test_process_attachment_extracts_txt(tmp_path, monkeypatch):
    file_path = tmp_path / "doc.txt"
    file_path.write_bytes(b"Hello, world. Lorem ipsum.")

    attachment = {
        "id": "att-uuid",
        "storage_path": str(file_path),
        "mime_type": "text/plain",
        "extraction_status": "pending",
    }

    transport = _RecordingTransport(attachment)

    real_async_client = httpx.AsyncClient

    def fake_async_client(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    monkeypatch.setattr("app.main.httpx.AsyncClient", fake_async_client)

    settings = _make_settings(tmp_path)
    await _process_attachment(settings, "att-uuid", force=False)

    methods = [c["method"] for c in transport.calls]
    assert methods.count("GET") == 1
    assert methods.count("PATCH") >= 2

    final_patch = transport.calls[-1]
    assert final_patch["method"] == "PATCH"
    assert final_patch["body"]["extractionStatus"] == "done"
    assert "Hello, world." in final_patch["body"]["extractedText"]
    assert final_patch["headers"]["x-internal-key"] == "secret"


@pytest.mark.asyncio
async def test_process_attachment_skips_when_done_without_force(tmp_path, monkeypatch):
    attachment = {
        "id": "att-uuid",
        "storage_path": str(tmp_path / "ignored.txt"),
        "mime_type": "text/plain",
        "extraction_status": "done",
    }

    transport = _RecordingTransport(attachment)

    real_async_client = httpx.AsyncClient

    def fake_async_client(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    monkeypatch.setattr("app.main.httpx.AsyncClient", fake_async_client)

    settings = _make_settings(tmp_path)
    await _process_attachment(settings, "att-uuid", force=False)

    methods = [c["method"] for c in transport.calls]
    assert methods == ["GET"]  # idempotent: no further work


@pytest.mark.asyncio
async def test_process_attachment_marks_failed_when_file_missing(tmp_path, monkeypatch):
    attachment = {
        "id": "att-uuid",
        "storage_path": str(tmp_path / "does-not-exist.txt"),
        "mime_type": "text/plain",
        "extraction_status": "pending",
    }

    transport = _RecordingTransport(attachment)

    real_async_client = httpx.AsyncClient

    def fake_async_client(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    monkeypatch.setattr("app.main.httpx.AsyncClient", fake_async_client)

    settings = _make_settings(tmp_path)
    await _process_attachment(settings, "att-uuid", force=False)

    last = transport.calls[-1]["body"]
    assert last["extractionStatus"] == "failed"
    assert "File not found" in last["extractionError"]


@pytest.mark.asyncio
async def test_process_attachment_skips_oversized_file(tmp_path, monkeypatch):
    file_path = tmp_path / "big.txt"
    file_path.write_bytes(b"x" * (2 * 1024 * 1024))

    attachment = {
        "id": "att-uuid",
        "storage_path": str(file_path),
        "mime_type": "text/plain",
        "extraction_status": "pending",
    }

    transport = _RecordingTransport(attachment)

    real_async_client = httpx.AsyncClient

    def fake_async_client(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    monkeypatch.setattr("app.main.httpx.AsyncClient", fake_async_client)

    settings = _make_settings(tmp_path)
    await _process_attachment(settings, "att-uuid", force=False)

    last = transport.calls[-1]["body"]
    assert last["extractionStatus"] == "skipped"
    assert "too large" in last["extractionError"].lower()
