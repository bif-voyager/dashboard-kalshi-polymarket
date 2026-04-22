from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Literal


CanonicalPlatform = Literal["Kalshi", "Polymarket"]

DAY_COLUMNS = ("day",)
PLATFORM_COLUMNS = ("platform",)
CATEGORY_COLUMNS = ("category",)
VOLUME_COLUMNS = ("volume_usd",)


@dataclass(slots=True)
class DashboardRowRecord:
    day: str
    platform: CanonicalPlatform
    category: str
    volume_usd: float


def records_from_dune_rows(
    *,
    rows: list[dict[str, Any]],
    expected_platform: CanonicalPlatform,
) -> list[DashboardRowRecord]:
    records: list[DashboardRowRecord] = []
    for index, row in enumerate(rows):
        day_value = _first_present(row, DAY_COLUMNS)
        platform_value = _first_present(row, PLATFORM_COLUMNS)
        category_value = _first_present(row, CATEGORY_COLUMNS)
        volume_value = _first_present(row, VOLUME_COLUMNS)

        if day_value is None:
            raise ValueError(f"Dune {expected_platform} row #{index + 1} has no day column")
        if platform_value is None:
            raise ValueError(f"Dune {expected_platform} row #{index + 1} has no platform column")
        if category_value is None or not str(category_value).strip():
            raise ValueError(f"Dune {expected_platform} row #{index + 1} has no category value")
        if volume_value is None:
            raise ValueError(f"Dune {expected_platform} row #{index + 1} has no volume_usd column")

        platform = normalize_platform(platform_value)
        if platform != expected_platform:
            raise ValueError(
                f"Dune {expected_platform} row #{index + 1} returned platform {platform!r} instead of {expected_platform!r}"
            )

        records.append(
            DashboardRowRecord(
                day=parse_day(day_value).isoformat(),
                platform=platform,
                category=" ".join(str(category_value).split()),
                volume_usd=float(parse_money(volume_value)),
            )
        )
    return records


def normalize_platform(value: Any) -> CanonicalPlatform:
    lowered = str(value).strip().lower()
    if lowered == "kalshi":
        return "Kalshi"
    if lowered == "polymarket":
        return "Polymarket"
    raise ValueError(f"Unsupported platform value: {value!r}")


def parse_day(value: Any) -> date:
    if isinstance(value, datetime):
        return value.astimezone(UTC).date() if value.tzinfo else value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, (int, float)):
        numeric = float(value)
        if numeric > 10_000_000_000:
            numeric /= 1000
        return datetime.fromtimestamp(numeric, tz=UTC).date()
    if isinstance(value, str):
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Empty date value")
        if len(cleaned) == 10 and cleaned[4] == "-" and cleaned[7] == "-":
            return date.fromisoformat(cleaned)
        cleaned = cleaned.replace("Z", "+00:00")
        if cleaned.endswith(" UTC"):
            cleaned = f"{cleaned[:-4]}+00:00"
        parsed = datetime.fromisoformat(cleaned)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC).date()
    raise ValueError(f"Unsupported date value: {value!r}")


def parse_money(value: Any) -> Decimal:
    if value is None:
        raise ValueError("Missing volume value")
    try:
        return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f"Unsupported volume value: {value!r}") from exc


def _first_present(row: dict[str, Any], names: tuple[str, ...]) -> Any:
    lower_to_original = {key.lower(): key for key in row}
    for name in names:
        key = lower_to_original.get(name)
        if key is not None and row.get(key) is not None:
            return row[key]
    return None
