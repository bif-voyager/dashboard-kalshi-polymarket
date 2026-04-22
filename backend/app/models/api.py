from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


CanonicalPlatform = Literal["Kalshi", "Polymarket"]


class DashboardRow(BaseModel):
    day: str
    platform: CanonicalPlatform
    category: str
    volume_usd: float


class DashboardMeta(BaseModel):
    cached_at: str
    is_stale: bool = False
    kalshi_query_id: int
    polymarket_query_id: int
    kalshi_last_day: str | None = None
    polymarket_last_day: str | None = None
    common_last_day: str | None = None
    categories: list[str] = Field(default_factory=list)


class DashboardDataResponse(BaseModel):
    rows: list[DashboardRow] = Field(default_factory=list)
    meta: DashboardMeta


class HealthResponse(BaseModel):
    ok: bool
    cache_present: bool
    refresh_in_progress: bool
    is_stale: bool
    cached_at: str | None = None
    common_last_day: str | None = None
    rows_count: int = 0
    last_error: str | None = None
