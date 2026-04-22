from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path


def utc_now() -> datetime:
    return datetime.now(UTC)


def resolve_runtime_path(path: str) -> Path:
    configured_path = Path(path)
    if configured_path.is_absolute():
        return configured_path

    runtime_root = Path(__file__).resolve().parents[2]
    if runtime_root.name == "backend":
        runtime_root = runtime_root.parent
    return runtime_root / configured_path
