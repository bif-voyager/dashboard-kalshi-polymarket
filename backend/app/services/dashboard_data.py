from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

from pydantic import ValidationError

from app.clients.dune import DuneClient
from app.config import Settings
from app.models.api import DashboardDataResponse, DashboardMeta, DashboardRow
from app.services.dune_volume import records_from_dune_rows
from app.utils import resolve_runtime_path, utc_now


@dataclass(slots=True)
class CacheEntry:
    payload: DashboardDataResponse
    cached_at: datetime


class DashboardDataService:
    def __init__(self, settings: Settings, dune: DuneClient) -> None:
        self.settings = settings
        self.dune = dune
        self.cache_path = resolve_runtime_path(settings.cache_file_path)
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        self.cache_ttl = timedelta(minutes=max(settings.cache_ttl_minutes, 0))
        self._entry: CacheEntry | None = None
        self._refresh_lock = asyncio.Lock()
        self._refresh_task: asyncio.Task[None] | None = None
        self._last_refresh_error: str | None = None
        self._load_cache_file()

    async def close(self) -> None:
        if self._refresh_task is not None and not self._refresh_task.done():
            self._refresh_task.cancel()
            try:
                await self._refresh_task
            except asyncio.CancelledError:
                pass

    async def get_dashboard_data(self) -> dict:
        if self._entry is not None and self._is_fresh(self._entry):
            return self._serialize(self._entry.payload, is_stale=False)

        if self._entry is None:
            entry = await self._refresh_blocking()
            if entry is None:
                raise RuntimeError("Dashboard cache is empty and Dune latest results could not be loaded.")
            return self._serialize(entry.payload, is_stale=False)

        self._ensure_background_refresh()
        return self._serialize(self._entry.payload, is_stale=True)

    def health_payload(self) -> dict:
        cache_present = self._entry is not None
        return {
            "ok": True,
            "cache_present": cache_present,
            "refresh_in_progress": self._refresh_task is not None and not self._refresh_task.done(),
            "is_stale": cache_present and not self._is_fresh(self._entry),
            "cached_at": self._entry.payload.meta.cached_at if cache_present else None,
            "common_last_day": self._entry.payload.meta.common_last_day if cache_present else None,
            "rows_count": len(self._entry.payload.rows) if cache_present else 0,
            "last_error": self._last_refresh_error,
        }

    async def _refresh_blocking(self) -> CacheEntry | None:
        async with self._refresh_lock:
            if self._entry is not None and self._is_fresh(self._entry):
                return self._entry
            return await self._refresh_locked()

    async def _refresh_locked(self) -> CacheEntry | None:
        try:
            payload = await self._build_payload()
        except Exception as exc:
            self._last_refresh_error = str(exc)
            if self._entry is None:
                return None
            return self._entry

        self._entry = CacheEntry(payload=payload, cached_at=datetime.fromisoformat(payload.meta.cached_at))
        self._write_cache_file(payload)
        self._last_refresh_error = None
        return self._entry

    def _ensure_background_refresh(self) -> None:
        if self._refresh_task is not None and not self._refresh_task.done():
            return
        self._refresh_task = asyncio.create_task(self._refresh_in_background())

    async def _refresh_in_background(self) -> None:
        if self._refresh_lock.locked():
            return
        async with self._refresh_lock:
            if self._entry is not None and self._is_fresh(self._entry):
                return
            await self._refresh_locked()

    async def _build_payload(self) -> DashboardDataResponse:
        polymarket_result, kalshi_result = await asyncio.gather(
            self.dune.get_latest_result(self.settings.dune_polymarket_query_id),
            self.dune.get_latest_result(self.settings.dune_kalshi_query_id),
        )
        polymarket_rows = records_from_dune_rows(rows=polymarket_result.rows, expected_platform="Polymarket")
        kalshi_rows = records_from_dune_rows(rows=kalshi_result.rows, expected_platform="Kalshi")

        merged_rows = sorted(
            [*polymarket_rows, *kalshi_rows],
            key=lambda item: (item.day, item.platform, item.category),
        )
        categories = sorted({row.category for row in merged_rows}, key=str.casefold)
        polymarket_last_day = max((row.day for row in polymarket_rows), default=None)
        kalshi_last_day = max((row.day for row in kalshi_rows), default=None)
        common_last_day = (
            min(polymarket_last_day, kalshi_last_day)
            if polymarket_last_day is not None and kalshi_last_day is not None
            else polymarket_last_day or kalshi_last_day
        )
        cached_at = utc_now().isoformat()

        return DashboardDataResponse(
            rows=[
                DashboardRow(
                    day=row.day,
                    platform=row.platform,
                    category=row.category,
                    volume_usd=row.volume_usd,
                )
                for row in merged_rows
            ],
            meta=DashboardMeta(
                cached_at=cached_at,
                is_stale=False,
                kalshi_query_id=self.settings.dune_kalshi_query_id,
                polymarket_query_id=self.settings.dune_polymarket_query_id,
                kalshi_last_day=kalshi_last_day,
                polymarket_last_day=polymarket_last_day,
                common_last_day=common_last_day,
                categories=categories,
            ),
        )

    def _serialize(self, payload: DashboardDataResponse, *, is_stale: bool) -> dict:
        data = payload.model_dump()
        data["meta"]["is_stale"] = is_stale
        return data

    def _is_fresh(self, entry: CacheEntry | None) -> bool:
        if entry is None:
            return False
        return (utc_now() - entry.cached_at) <= self.cache_ttl

    def _load_cache_file(self) -> None:
        if not self.cache_path.exists():
            return
        try:
            payload = DashboardDataResponse.model_validate_json(self.cache_path.read_text(encoding="utf-8"))
        except (OSError, ValidationError, json.JSONDecodeError):
            return
        self._entry = CacheEntry(payload=payload, cached_at=datetime.fromisoformat(payload.meta.cached_at))

    def _write_cache_file(self, payload: DashboardDataResponse) -> None:
        temp_path = self.cache_path.with_suffix(f"{self.cache_path.suffix}.tmp")
        temp_path.write_text(payload.model_dump_json(indent=2), encoding="utf-8")
        temp_path.replace(self.cache_path)
