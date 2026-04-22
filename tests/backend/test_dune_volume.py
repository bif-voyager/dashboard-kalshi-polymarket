import pytest

from app.services.dune_volume import normalize_platform, parse_day, parse_money, records_from_dune_rows


def test_parse_day_accepts_dune_utc_timestamp_string() -> None:
    assert parse_day("2026-04-19 00:00:00.000 UTC").isoformat() == "2026-04-19"


def test_parse_day_accepts_plain_iso_date() -> None:
    assert parse_day("2026-04-19").isoformat() == "2026-04-19"


def test_parse_money_rounds_to_cents() -> None:
    assert str(parse_money("10.125")) == "10.13"


def test_normalize_platform_accepts_title_and_lower_case() -> None:
    assert normalize_platform("Kalshi") == "Kalshi"
    assert normalize_platform("polymarket") == "Polymarket"


def test_records_from_dune_rows_normalize_day_platform_and_volume() -> None:
    records = records_from_dune_rows(
        rows=[{"day": "2026-04-19 00:00:00.000 UTC", "platform": "Polymarket", "category": "Politics", "volume_usd": 123.456}],
        expected_platform="Polymarket",
    )

    assert records[0].day == "2026-04-19"
    assert records[0].platform == "Polymarket"
    assert records[0].category == "Politics"
    assert records[0].volume_usd == 123.46


def test_records_from_dune_rows_raise_on_platform_mismatch() -> None:
    with pytest.raises(ValueError, match="returned platform"):
        records_from_dune_rows(
            rows=[{"day": "2026-04-19", "platform": "Kalshi", "category": "Macro", "volume_usd": 5}],
            expected_platform="Polymarket",
        )
