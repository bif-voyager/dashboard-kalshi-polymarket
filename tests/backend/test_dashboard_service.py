import asyncio
from datetime import timedelta
from pathlib import Path

import pytest

from app.clients.base import UpstreamError
from app.clients.dune import DuneQueryResult
from app.config import Settings
from app.services.dashboard_data import DashboardDataService
from app.utils import utc_now


class FakeDuneClient:
    def __init__(self, responses: dict[int, DuneQueryResult | Exception]) -> None:
        self.responses = responses
        self.calls: list[int] = []

    async def get_latest_result(self, query_id: int) -> DuneQueryResult:
        self.calls.append(query_id)
        response = self.responses[query_id]
        if isinstance(response, Exception):
            raise response
        return response


def build_service(tmp_path: Path, client: FakeDuneClient, ttl_minutes: int = 60) -> DashboardDataService:
    settings = Settings(
        cache_file_path=str(tmp_path / "dashboard-cache.json"),
        cache_ttl_minutes=ttl_minutes,
        dune_polymarket_query_id=7345278,
        dune_kalshi_query_id=7345291,
    )
    return DashboardDataService(settings, client)  # type: ignore[arg-type]


def dune_result(query_id: int, rows: list[dict]) -> DuneQueryResult:
    return DuneQueryResult(query_id=query_id, rows=rows, pages=1)


def test_service_builds_merged_payload_and_meta(tmp_path: Path) -> None:
    client = FakeDuneClient(
        {
            7345278: dune_result(
                7345278,
                [
                    {"day": "2026-04-19 00:00:00.000 UTC", "platform": "Polymarket", "category": "Politics", "volume_usd": 61.2},
                    {"day": "2026-04-20 00:00:00.000 UTC", "platform": "Polymarket", "category": "Politics", "volume_usd": 102},
                ],
            ),
            7345291: dune_result(
                7345291,
                [
                    {"day": "2026-04-18", "platform": "Kalshi", "category": "Macro", "volume_usd": 5},
                    {"day": "2026-04-20", "platform": "Kalshi", "category": "Macro", "volume_usd": 10},
                ],
            ),
        }
    )
    service = build_service(tmp_path, client)

    payload = asyncio.run(service.get_dashboard_data())

    assert [row["day"] for row in payload["rows"]] == ["2026-04-18", "2026-04-19", "2026-04-20", "2026-04-20"]
    assert payload["meta"]["is_stale"] is False
    assert payload["meta"]["polymarket_query_id"] == 7345278
    assert payload["meta"]["kalshi_query_id"] == 7345291
    assert payload["meta"]["polymarket_last_day"] == "2026-04-20"
    assert payload["meta"]["kalshi_last_day"] == "2026-04-20"
    assert payload["meta"]["common_last_day"] == "2026-04-20"
    assert payload["meta"]["categories"] == ["Macro", "Politics"]
    assert (tmp_path / "dashboard-cache.json").exists()


def test_stale_cache_returns_last_successful_payload_and_refreshes_in_background(tmp_path: Path) -> None:
    async def scenario() -> None:
        client = FakeDuneClient(
            {
                7345278: dune_result(
                    7345278,
                    [{"day": "2026-04-19", "platform": "Polymarket", "category": "Politics", "volume_usd": 10}],
                ),
                7345291: dune_result(
                    7345291,
                    [{"day": "2026-04-19", "platform": "Kalshi", "category": "Macro", "volume_usd": 20}],
                ),
            }
        )
        service = build_service(tmp_path, client)
        first_payload = await service.get_dashboard_data()
        assert first_payload["meta"]["is_stale"] is False

        client.responses = {
            7345278: dune_result(
                7345278,
                [{"day": "2026-04-20", "platform": "Polymarket", "category": "Politics", "volume_usd": 30}],
            ),
            7345291: dune_result(
                7345291,
                [{"day": "2026-04-20", "platform": "Kalshi", "category": "Macro", "volume_usd": 40}],
            ),
        }
        assert service._entry is not None
        service._entry.cached_at = utc_now() - timedelta(minutes=61)

        stale_payload = await service.get_dashboard_data()

        assert stale_payload["meta"]["is_stale"] is True
        assert stale_payload["rows"][0]["day"] == "2026-04-19"
        assert service._refresh_task is not None

        await service._refresh_task
        refreshed_payload = await service.get_dashboard_data()

        assert refreshed_payload["meta"]["is_stale"] is False
        assert refreshed_payload["rows"][0]["day"] == "2026-04-20"

    asyncio.run(scenario())


def test_stale_cache_survives_failed_refresh(tmp_path: Path) -> None:
    async def scenario() -> None:
        client = FakeDuneClient(
            {
                7345278: dune_result(
                    7345278,
                    [{"day": "2026-04-19", "platform": "Polymarket", "category": "Politics", "volume_usd": 10}],
                ),
                7345291: dune_result(
                    7345291,
                    [{"day": "2026-04-19", "platform": "Kalshi", "category": "Macro", "volume_usd": 20}],
                ),
            }
        )
        service = build_service(tmp_path, client)
        warm_payload = await service.get_dashboard_data()
        assert warm_payload["rows"][0]["day"] == "2026-04-19"

        client.responses = {
            7345278: UpstreamError("dune", 503, "Polymarket latest result unavailable"),
            7345291: UpstreamError("dune", 503, "Kalshi latest result unavailable"),
        }
        assert service._entry is not None
        service._entry.cached_at = utc_now() - timedelta(minutes=61)

        stale_payload = await service.get_dashboard_data()

        assert stale_payload["meta"]["is_stale"] is True
        assert stale_payload["rows"][0]["day"] == "2026-04-19"
        assert service._refresh_task is not None
        await service._refresh_task
        assert "latest result unavailable" in (service.health_payload()["last_error"] or "")

    asyncio.run(scenario())


def test_service_raises_when_cache_missing_and_dune_fails(tmp_path: Path) -> None:
    client = FakeDuneClient(
        {
            7345278: UpstreamError("dune", 503, "Polymarket latest result unavailable"),
            7345291: UpstreamError("dune", 503, "Kalshi latest result unavailable"),
        }
    )
    service = build_service(tmp_path, client)

    with pytest.raises(RuntimeError, match="Dashboard cache is empty"):
        asyncio.run(service.get_dashboard_data())
