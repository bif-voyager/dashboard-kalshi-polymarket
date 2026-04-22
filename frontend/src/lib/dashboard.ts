import type { CategoryScope, DashboardDataResponse, DashboardPlatform, DashboardRow, RangeValue } from "./api";

export interface CategoryItem {
  slug: string;
  label: string;
  platforms: string[];
}

export type ComparisonMode = "comparable" | "full";

export interface VolumePoint {
  date: string;
  polymarket: number | null;
  kalshi: number | null;
  total: number;
}

export interface DashboardView {
  categories: CategoryItem[];
  points: VolumePoint[];
  totals: {
    polymarket: number;
    kalshi: number;
    difference: number;
    total: number;
  };
  comparisonLastDay: string | null;
  visibleLastDay: string | null;
  tailDiffers: boolean;
}

export interface CategoryBreakdownItem {
  slug: string;
  label: string;
  platforms: string[];
  polymarket: number;
  kalshi: number;
  total: number;
  shareOfVisibleTotal: number;
}

function platformKey(platform: DashboardPlatform): "polymarket" | "kalshi" {
  return platform === "Polymarket" ? "polymarket" : "kalshi";
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function shiftUtcDays(day: string, deltaDays: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

function rangeStartDay(endDay: string | null, range: RangeValue): string | null {
  if (!endDay || range === "all") {
    return null;
  }
  const windowSize = { "7d": 7, "30d": 30, "90d": 90 }[range];
  return shiftUtcDays(endDay, -(windowSize - 1));
}

export function buildCategoryItems(data: DashboardDataResponse): CategoryItem[] {
  const platformsByCategory = new Map<string, Set<string>>();
  for (const row of data.rows) {
    const current = platformsByCategory.get(row.category) ?? new Set<string>();
    current.add(platformKey(row.platform));
    platformsByCategory.set(row.category, current);
  }

  return data.meta.categories.map((category) => ({
    slug: category,
    label: category,
    platforms: Array.from(platformsByCategory.get(category) ?? []).sort(),
  }));
}

function laterDay(left: string | null, right: string | null): string | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return left >= right ? left : right;
}

function visibleEndDay(data: DashboardDataResponse, comparisonMode: ComparisonMode): string | null {
  if (comparisonMode === "full") {
    return laterDay(data.meta.polymarket_last_day, data.meta.kalshi_last_day);
  }
  return data.meta.common_last_day ?? data.meta.polymarket_last_day ?? data.meta.kalshi_last_day ?? null;
}

export function filterDashboardRows(
  data: DashboardDataResponse,
  range: RangeValue,
  selectedCategories: string[],
  categoryScope: CategoryScope,
  comparisonMode: ComparisonMode,
): DashboardRow[] {
  const endDay = visibleEndDay(data, comparisonMode);
  const startDay = rangeStartDay(endDay, range);
  const selectedSet = new Set(selectedCategories);

  return data.rows.filter((row) => {
    if (endDay && row.day > endDay) {
      return false;
    }
    if (startDay && row.day < startDay) {
      return false;
    }

    const key = platformKey(row.platform);
    const categoryFilterApplies =
      categoryScope === "both" || (categoryScope === "polymarket" && key === "polymarket") || (categoryScope === "kalshi" && key === "kalshi");

    if (!categoryFilterApplies) {
      return true;
    }
    return selectedSet.has(row.category);
  });
}

export function sumVolumePoints(points: VolumePoint[]): DashboardView["totals"] {
  const totals = points.reduce(
    (accumulator, point) => ({
      polymarket: roundCurrency(accumulator.polymarket + (point.polymarket ?? 0)),
      kalshi: roundCurrency(accumulator.kalshi + (point.kalshi ?? 0)),
      difference: 0,
      total: roundCurrency(accumulator.total + point.total),
    }),
    { polymarket: 0, kalshi: 0, difference: 0, total: 0 },
  );
  totals.difference = roundCurrency(totals.polymarket - totals.kalshi);
  return totals;
}

export function buildCategoryBreakdownFromRows(
  categories: CategoryItem[],
  rows: DashboardRow[],
): CategoryBreakdownItem[] {
  const byCategory = new Map<string, CategoryBreakdownItem>();

  for (const category of categories) {
    byCategory.set(category.slug, {
      slug: category.slug,
      label: category.label,
      platforms: category.platforms,
      polymarket: 0,
      kalshi: 0,
      total: 0,
      shareOfVisibleTotal: 0,
    });
  }

  for (const row of rows) {
    const entry = byCategory.get(row.category);
    if (!entry) {
      continue;
    }
    if (row.platform === "Polymarket") {
      entry.polymarket = roundCurrency(entry.polymarket + row.volume_usd);
    } else {
      entry.kalshi = roundCurrency(entry.kalshi + row.volume_usd);
    }
    entry.total = roundCurrency(entry.polymarket + entry.kalshi);
  }

  const visibleTotal = Array.from(byCategory.values()).reduce((sum, item) => sum + item.total, 0);

  return Array.from(byCategory.values())
    .filter((item) => item.total > 0)
    .map((item) => ({
      ...item,
      shareOfVisibleTotal: visibleTotal > 0 ? item.total / visibleTotal : 0,
    }))
    .sort((left, right) => right.total - left.total || left.label.localeCompare(right.label));
}

export function buildDashboardView(
  data: DashboardDataResponse,
  range: RangeValue,
  selectedCategories: string[],
  categoryScope: CategoryScope,
  comparisonMode: ComparisonMode = "comparable",
): DashboardView {
  const categories = buildCategoryItems(data);
  const comparisonLastDay =
    data.meta.common_last_day ?? data.meta.polymarket_last_day ?? data.meta.kalshi_last_day ?? null;
  const visibleLastDay = visibleEndDay(data, comparisonMode);
  const tailDiffers =
    Boolean(data.meta.common_last_day) &&
    data.meta.polymarket_last_day !== null &&
    data.meta.kalshi_last_day !== null &&
    data.meta.polymarket_last_day !== data.meta.kalshi_last_day;

  const rows = filterDashboardRows(data, range, selectedCategories, categoryScope, comparisonMode);

  const pointsByDay = new Map<string, VolumePoint>();
  for (const row of rows) {
    const key = platformKey(row.platform);
    const point = pointsByDay.get(row.day) ?? {
      date: row.day,
      polymarket: null,
      kalshi: null,
      total: 0,
    };
    const currentValue = point[key] ?? 0;
    point[key] = roundCurrency(currentValue + row.volume_usd);
    pointsByDay.set(row.day, point);
  }

  const points = Array.from(pointsByDay.values())
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((point) => ({
      ...point,
      total: roundCurrency((point.polymarket ?? 0) + (point.kalshi ?? 0)),
    }));

  return {
    categories,
    points,
    totals: sumVolumePoints(points),
    comparisonLastDay,
    visibleLastDay,
    tailDiffers,
  };
}

export function buildCategoryBreakdown(
  data: DashboardDataResponse,
  range: RangeValue,
  selectedCategories: string[],
  categoryScope: CategoryScope,
  comparisonMode: ComparisonMode = "comparable",
): CategoryBreakdownItem[] {
  const categories = buildCategoryItems(data);
  const rows = filterDashboardRows(data, range, selectedCategories, categoryScope, comparisonMode);
  return buildCategoryBreakdownFromRows(categories, rows);
}

export function buildCsvContent(points: VolumePoint[], selectedCategories: string[], categoryScope: CategoryScope): string {
  const lines = ["date,platform,category_scope,applied_to,volume_usd"];
  const categoryScopeLabel = selectedCategories.length ? selectedCategories.join(" | ") : "all";
  for (const point of points) {
    lines.push(
      [
        point.date,
        "Polymarket",
        csvCell(categoryScopeLabel),
        categoryScope,
        point.polymarket ?? "",
      ].join(","),
    );
    lines.push(
      [
        point.date,
        "Kalshi",
        csvCell(categoryScopeLabel),
        categoryScope,
        point.kalshi ?? "",
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

function csvCell(value: string): string {
  const escaped = value.replaceAll('"', '""');
  return `"${escaped}"`;
}
