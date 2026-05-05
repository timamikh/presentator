"""Centralized config (12-Factor: env-vars only, no hard-coded paths/keys)."""

from __future__ import annotations

import os
from dataclasses import dataclass


def _required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"FATAL: missing required env var {name}")
    return value


@dataclass(frozen=True)
class Settings:
    api_base_url: str
    internal_api_key: str
    library_root: str
    max_file_mb: int
    summary_max_chars: int
    extracted_text_limit: int
    request_timeout_s: float

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            api_base_url=os.environ.get("API_BASE_URL", "http://api-service:3001"),
            internal_api_key=_required("INTERNAL_API_KEY"),
            library_root=os.environ.get("LIBRARY_ROOT", "/data/library"),
            max_file_mb=int(os.environ.get("EXTRACTOR_MAX_FILE_MB", "20")),
            summary_max_chars=int(os.environ.get("EXTRACTOR_SUMMARY_MAX_CHARS", "1500")),
            extracted_text_limit=int(os.environ.get("EXTRACTOR_TEXT_LIMIT_CHARS", "50000")),
            request_timeout_s=float(os.environ.get("EXTRACTOR_HTTP_TIMEOUT_S", "30")),
        )
