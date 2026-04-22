import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MetricCard } from "./components/MetricCard";
import { NotificationCenter, type NotificationItem } from "./components/NotificationCenter";
import { StatePanel } from "./components/StatePanel";
import { VolumeChart, type ChartMode, type ChartWindowRange } from "./components/VolumeChart";
import { type CategoryScope, type DashboardRow, fetchDashboardData, type RangeValue } from "./lib/api";
import {
  buildCategoryBreakdownFromRows,
  buildCategoryItems,
  buildCsvContent,
  buildDashboardView,
  filterDashboardRows,
  sumVolumePoints,
  type ComparisonMode,
} from "./lib/dashboard";
import { formatAsOf, formatCurrency } from "./lib/format";
import { localeByLanguage, translations, translateCategory, type Language } from "./lib/i18n";

interface ChartWindowState extends ChartWindowRange {
  key: string;
}

const rangeOptions: { value: RangeValue; labelKey?: "allTime"; fallback: string }[] = [
  { value: "7d", fallback: "7D" },
  { value: "30d", fallback: "30D" },
  { value: "90d", fallback: "90D" },
  { value: "all", labelKey: "allTime", fallback: "All time" },
];

const categoryScopeOptions: { value: CategoryScope; labelKey: "applyBoth" | "applyPolymarket" | "applyKalshi" }[] = [
  { value: "both", labelKey: "applyBoth" },
  { value: "polymarket", labelKey: "applyPolymarket" },
  { value: "kalshi", labelKey: "applyKalshi" },
];

const chartModeOptions: { value: ChartMode; labelKey: "chartLine" | "chartArea" | "chartBars" }[] = [
  { value: "line", labelKey: "chartLine" },
  { value: "area", labelKey: "chartArea" },
  { value: "bar", labelKey: "chartBars" },
];

type Theme = "light" | "dark";

function getInitialTheme(): Theme {
  try {
    const savedTheme = window.localStorage.getItem("market-dashboard-theme");
    if (savedTheme === "light" || savedTheme === "dark") {
      return savedTheme;
    }
  } catch {
    return "dark";
  }
  return "dark";
}

function formatPercent(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function App() {
  const [range, setRange] = useState<RangeValue>("30d");
  const [selectedCategories, setSelectedCategories] = useState<string[] | null>(null);
  const [categoryScope, setCategoryScope] = useState<CategoryScope>("both");
  const comparisonMode: ComparisonMode = "full";
  const [language, setLanguage] = useState<Language>("en");
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [categoriesOpen, setCategoriesOpen] = useState(true);
  const [visiblePlatforms, setVisiblePlatforms] = useState({
    polymarket: true,
    kalshi: true,
  });
  const [chartMode, setChartMode] = useState<ChartMode>("line");
  const [chartWindowState, setChartWindowState] = useState<ChartWindowState | null>(null);
  const deferredChartWindowState = useDeferredValue(chartWindowState);
  const t = translations[language];
  const locale = localeByLanguage[language];

  const uiText = language === "ru"
    ? {
        terminalLabel: "Терминал торгового объема",
        terminalTitle: "Polymarket vs Kalshi",
        terminalSubtitle: "Историческое сравнение объема торгов Kalshi и Polymarket.",
        totalVolume: "Общий объем",
        visibleDay: "Показанный день",
        categoryBreakdownTitle: "Структура по категориям",
        categoryBreakdownBody: "Категории ранжированы по суммарному объему в текущем окне.",
        distributionTitle: "Распределение объема",
        distributionBody: "Доля платформ в текущем диапазоне после выбранных фильтров.",
        leadersTitle: "Лидеры диапазона",
        leadersBody: "Крупнейшие категории и охват в текущем срезе.",
        visibleDays: "Видимых дней",
        activeCategories: "Активных категорий",
        dataThrough: "Данные по",
        snapshot: "Снимок",
        stale: "Устаревший",
        fresh: "Свежий",
        category: "Категория",
        total: "Всего",
        share: "Доля",
        polymarketLead: "Лидер Polymarket",
        kalshiLead: "Лидер Kalshi",
        noCategoryFlow: "Нет данных по категориям в этом окне.",
        includeAll: "Выбрать все",
        clearSelection: "Очистить",
        hideCategories: "Свернуть категории",
        showCategories: "Показать категории",
        selectedCount: "Выбрано",
      }
    : {
        terminalLabel: "Prediction market volume terminal",
        terminalTitle: "Polymarket vs Kalshi",
        terminalSubtitle: "Historical volume comparison across Kalshi and Polymarket.",
        totalVolume: "Total volume",
        visibleDay: "Visible through",
        categoryBreakdownTitle: "Category structure",
        categoryBreakdownBody: "Categories ranked by visible volume inside the current filter window.",
        distributionTitle: "Volume split",
        distributionBody: "Platform share after the current range and category filters.",
        leadersTitle: "Range leaders",
        leadersBody: "Largest categories and coverage for the active slice.",
        visibleDays: "Visible days",
        activeCategories: "Active categories",
        dataThrough: "Data through",
        snapshot: "Snapshot",
        stale: "Stale",
        fresh: "Fresh",
        category: "Category",
        total: "Total",
        share: "Share",
        polymarketLead: "Polymarket leader",
        kalshiLead: "Kalshi leader",
        noCategoryFlow: "No category breakdown is available for the current window.",
        includeAll: "Select all",
        clearSelection: "Clear",
        hideCategories: "Hide categories",
        showCategories: "Show categories",
        selectedCount: "Selected",
      };

  const dashboardQuery = useQuery({
    queryKey: ["dashboard-data"],
    queryFn: fetchDashboardData,
    placeholderData: (previous) => previous,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });

  const categories = useMemo(
    () => (dashboardQuery.data ? buildCategoryItems(dashboardQuery.data) : []),
    [dashboardQuery.data],
  );

  useEffect(() => {
    if (!categories.length) {
      return;
    }
    const availableSlugs = categories.map((item) => item.slug);
    if (selectedCategories === null) {
      setSelectedCategories(availableSlugs);
      return;
    }
    const normalizedSelection = selectedCategories.filter((item) => availableSlugs.includes(item));
    if (normalizedSelection.length !== selectedCategories.length) {
      setSelectedCategories(normalizedSelection.length > 0 ? normalizedSelection : availableSlugs);
    }
  }, [categories, selectedCategories]);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem("market-dashboard-theme", theme);
    } catch {
      // Theme persistence is optional.
    }
  }, [theme]);

  const selected = selectedCategories ?? [];
  const selectedKey = selected.join("\u001f");
  const allCategoriesSelected = categories.length > 0 && selected.length === categories.length;
  const hasSelection = selectedCategories !== null && selected.length > 0;
  const dashboardView = useMemo(
    () =>
      dashboardQuery.data && selectedCategories !== null
        ? buildDashboardView(dashboardQuery.data, range, selected, categoryScope, comparisonMode)
        : null,
    [categoryScope, comparisonMode, dashboardQuery.data, range, selected, selectedCategories],
  );

  const chartResetKey = useMemo(() => {
    const firstDay = dashboardView?.points[0]?.date ?? "none";
    const lastDay = dashboardView?.points.length
      ? dashboardView.points[dashboardView.points.length - 1]?.date
      : "none";

    return [
      range,
      categoryScope,
      chartMode,
      selectedKey,
      dashboardView?.points.length ?? 0,
      firstDay,
      lastDay,
    ].join("|");
  }, [categoryScope, chartMode, dashboardView?.points, range, selectedKey]);

  useEffect(() => {
    setChartWindowState(null);
  }, [chartResetKey]);

  const activeChartWindowRange =
    deferredChartWindowState?.key === chartResetKey ? deferredChartWindowState : null;

  const filteredRows = useMemo(
    () =>
      dashboardQuery.data && selectedCategories !== null
        ? filterDashboardRows(dashboardQuery.data, range, selected, categoryScope, comparisonMode)
        : [],
    [categoryScope, comparisonMode, dashboardQuery.data, range, selected, selectedCategories],
  );

  const rowsByDay = useMemo(() => {
    const next = new Map<string, DashboardRow[]>();
    for (const row of filteredRows) {
      const current = next.get(row.day);
      if (current) {
        current.push(row);
      } else {
        next.set(row.day, [row]);
      }
    }
    return next;
  }, [filteredRows]);

  const visibleDashboardView = useMemo(() => {
    if (!dashboardView) {
      return null;
    }

    if (!dashboardView.points.length) {
      return {
        points: [],
        totals: sumVolumePoints([]),
        visibleLastDay: null,
      };
    }

    const lastIndex = dashboardView.points.length - 1;
    const start = clamp(activeChartWindowRange?.start ?? 0, 0, lastIndex);
    const end = clamp(activeChartWindowRange?.end ?? lastIndex, start, lastIndex);
    const points = dashboardView.points.slice(start, end + 1);

    return {
      points,
      totals: sumVolumePoints(points),
      visibleLastDay: points[points.length - 1]?.date ?? null,
    };
  }, [activeChartWindowRange, dashboardView]);

  const visibleRows = useMemo(() => {
    if (!visibleDashboardView?.points.length) {
      return [];
    }
    return visibleDashboardView.points.flatMap((point) => rowsByDay.get(point.date) ?? []);
  }, [rowsByDay, visibleDashboardView]);

  const categoryBreakdown = useMemo(
    () => (dashboardView ? buildCategoryBreakdownFromRows(dashboardView.categories, visibleRows) : []),
    [dashboardView, visibleRows],
  );

  const hasNonZeroPoints = Boolean(
    visibleDashboardView?.points.some((point) => {
      const polymarketValue = visiblePlatforms.polymarket ? (point.polymarket ?? 0) : 0;
      const kalshiValue = visiblePlatforms.kalshi ? (point.kalshi ?? 0) : 0;
      return polymarketValue + kalshiValue > 0;
    }),
  );
  const initialLoading = dashboardQuery.isLoading || selectedCategories === null;
  const hardError = !dashboardQuery.data ? dashboardQuery.error : null;

  const notifications: NotificationItem[] = [
    dashboardQuery.data
      ? {
          id: "dune-snapshot",
          kind: "info",
          message:
            language === "ru"
              ? `Последний снимок из Dune: ${formatAsOf(dashboardQuery.data.meta.cached_at, locale, t.noSyncedData)}. Backend объединяет данные из двух сохраненных запросов Dune.`
              : `Latest snapshot from Dune: ${formatAsOf(dashboardQuery.data.meta.cached_at, locale, t.noSyncedData)}. The backend merges data from two saved Dune queries.`,
        }
      : null,
    dashboardQuery.data?.meta.is_stale
      ? { id: "stale", kind: "warning", message: t.showingCachedData }
      : null,
    dashboardView?.tailDiffers && dashboardQuery.data?.meta.common_last_day
      ? {
          id: "common-last-day",
          kind: "info",
          message: `${t.comparingThrough} ${formatAsOf(dashboardQuery.data.meta.common_last_day, locale, t.noData)}. ${t.latestAvailability}: Polymarket ${formatAsOf(dashboardQuery.data.meta.polymarket_last_day, locale, t.noData)}, Kalshi ${formatAsOf(dashboardQuery.data.meta.kalshi_last_day, locale, t.noData)}.`,
        }
      : null,
    hardError
      ? {
          id: "hard-error",
          kind: "error",
          message: hardError instanceof Error ? hardError.message : t.failedToLoad,
        }
      : null,
  ].filter((item): item is NotificationItem => item !== null);

  const lastUpdatedLabel = dashboardQuery.data
    ? formatAsOf(dashboardQuery.data.meta.cached_at, locale, t.noSyncedData)
    : t.noSyncedData;

  const visibleLastDayLabel = visibleDashboardView
    ? formatAsOf(visibleDashboardView.visibleLastDay, locale, t.noData)
    : t.noData;

  const activeCategoryCount = categoryBreakdown.length;
  const polymarketShare =
    visibleDashboardView && visibleDashboardView.totals.total > 0 ? visibleDashboardView.totals.polymarket / visibleDashboardView.totals.total : 0;
  const kalshiShare =
    visibleDashboardView && visibleDashboardView.totals.total > 0 ? visibleDashboardView.totals.kalshi / visibleDashboardView.totals.total : 0;
  const maxCategoryTotal = categoryBreakdown[0]?.total ?? 0;
  const topPolymarketCategory = [...categoryBreakdown].sort((left, right) => right.polymarket - left.polymarket)[0] ?? null;
  const topKalshiCategory = [...categoryBreakdown].sort((left, right) => right.kalshi - left.kalshi)[0] ?? null;
  const visiblePolymarketLastDay =
    [...(visibleDashboardView?.points ?? [])].reverse().find((point) => point.polymarket !== null)?.date ?? null;
  const visibleKalshiLastDay =
    [...(visibleDashboardView?.points ?? [])].reverse().find((point) => point.kalshi !== null)?.date ?? null;

  function toggleCategory(slug: string) {
    if (selectedCategories === null) {
      return;
    }
    if (allCategoriesSelected) {
      setSelectedCategories(categories.map((item) => item.slug).filter((item) => item !== slug));
      return;
    }
    if (selectedCategories.includes(slug)) {
      setSelectedCategories(selectedCategories.filter((item) => item !== slug));
      return;
    }
    const next = categories
      .map((item) => item.slug)
      .filter((item) => selectedCategories.includes(item) || item === slug);
    setSelectedCategories(next);
  }

  function selectAllCategories() {
    setSelectedCategories(categories.map((item) => item.slug));
  }

  function clearCategories() {
    setSelectedCategories([]);
  }

  function toggleTheme() {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }

  function togglePlatform(platform: "polymarket" | "kalshi") {
    const otherPlatform = platform === "polymarket" ? "kalshi" : "polymarket";
    if (visiblePlatforms[platform] && !visiblePlatforms[otherPlatform]) {
      return;
    }
    setVisiblePlatforms((current) => ({
      ...current,
      [platform]: !current[platform],
    }));
  }

  function exportCsv() {
    if (!visibleDashboardView) {
      return;
    }
    const csv = buildCsvContent(visibleDashboardView.points, selected, categoryScope);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "market-dashboard.csv";
    anchor.click();
    window.URL.revokeObjectURL(url);
  }

  const handleChartWindowChange = useCallback((nextWindow: ChartWindowRange) => {
    setChartWindowState((current) => {
      if (current?.key === chartResetKey && current.start === nextWindow.start && current.end === nextWindow.end) {
        return current;
      }
      return { ...nextWindow, key: chartResetKey };
    });
  }, [chartResetKey]);

  return (
    <main className="terminal-shell">
      <div className="terminal-shell__noise" aria-hidden="true" />
      <header className="terminal-header">
        <div className="terminal-header__titleblock">
          <div className="terminal-header__kickerrow">
            <span className="terminal-kicker">{uiText.terminalLabel}</span>
          </div>
          <h1 className="terminal-title">
            <span className="terminal-title__brand terminal-title__brand--sea">Polymarket</span>
            <span className="terminal-title__separator"> vs </span>
            <span className="terminal-title__brand terminal-title__brand--ember">Kalshi</span>
          </h1>
          <p className="terminal-subtitle">{uiText.terminalSubtitle}</p>
        </div>

        <div className="terminal-header__side">
          <div className="terminal-actions">
            <div className="language-toggle" aria-label="Language switcher">
              <button
                className={language === "en" ? "language-option language-option--active" : "language-option"}
                onClick={() => setLanguage("en")}
                type="button"
              >
                EN
              </button>
              <button
                className={language === "ru" ? "language-option language-option--active" : "language-option"}
                onClick={() => setLanguage("ru")}
                type="button"
              >
                RUS
              </button>
            </div>

            <button
              className={theme === "dark" ? "theme-toggle theme-toggle--active" : "theme-toggle"}
              type="button"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? t.lightTheme : t.darkTheme}
              title={theme === "dark" ? t.lightTheme : t.darkTheme}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="theme-toggle__icon">
                {theme === "dark" ? (
                  <path d="M12 4a1 1 0 0 1 1 1v1.1a1 1 0 1 1-2 0V5a1 1 0 0 1 1-1Zm0 4.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6ZM4 13a1 1 0 1 1 0-2h1.1a1 1 0 1 1 0 2H4Zm14.9 0a1 1 0 1 1 0-2H20a1 1 0 1 1 0 2h-1.1ZM6.34 7.76a1 1 0 0 1 1.42-1.42l.78.78a1 1 0 1 1-1.42 1.42l-.78-.78Zm9.12 9.12a1 1 0 0 1 1.42-1.42l.78.78a1 1 0 0 1-1.42 1.42l-.78-.78Zm2.2-10.54a1 1 0 0 1 0 1.42l-.78.78a1 1 0 0 1-1.42-1.42l.78-.78a1 1 0 0 1 1.42 0ZM8.54 15.46a1 1 0 0 1 0 1.42l-.78.78a1 1 0 0 1-1.42-1.42l.78-.78a1 1 0 0 1 1.42 0ZM12 16.9a1 1 0 0 1 1 1V19a1 1 0 1 1-2 0v-1.1a1 1 0 0 1 1-1Z" />
                ) : (
                  <path d="M20.2 15.3A8.4 8.4 0 0 1 8.7 3.8a8.7 8.7 0 1 0 11.5 11.5Z" />
                )}
              </svg>
            </button>

            <NotificationCenter
              notifications={notifications}
              title={t.notifications}
              emptyLabel={t.noNotifications}
              ariaLabel={t.notificationBell}
            />

            <button className="action-button action-button--primary" onClick={exportCsv} disabled={!dashboardView?.points.length}>
              <svg viewBox="0 0 24 24" aria-hidden="true" className="action-button__icon">
                <path d="M12 3a1 1 0 0 1 1 1v8.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 3.96a1 1 0 0 1-1.4 0l-4-3.96a1 1 0 0 1 1.4-1.42l2.3 2.3V4a1 1 0 0 1 1-1Zm-7 14a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z" />
              </svg>
              <span>{t.exportCsv}</span>
            </button>
          </div>
        </div>
      </header>

      {initialLoading || hardError ? (
        <section className="chart-panel chart-panel--state-only">
          <div className="panel-head panel-head--chart">
            <div>
              <span className="panel-kicker">{t.combinedView}</span>
              <h2 className="panel-title">{t.chartTitle}</h2>
            </div>
          </div>
          <StatePanel
            title={initialLoading ? t.loadingTitle : t.loadFailedTitle}
            body={initialLoading ? t.loadingBody : t.loadFailedBody}
            action={
              hardError ? (
                <button className="action-button action-button--primary" onClick={() => void dashboardQuery.refetch()}>
                  {t.retry}
                </button>
              ) : undefined
            }
          />
        </section>
      ) : null}

      {!initialLoading && !hardError && selectedCategories !== null && dashboardView ? (
        <>
          <section className="metrics-grid metrics-grid--terminal">
            <MetricCard
              title={uiText.totalVolume}
              value={formatCurrency(visibleDashboardView?.totals.total ?? 0, locale)}
              tone="neutral"
            />
            <MetricCard
              title={t.polymarketVolume}
              value={formatCurrency(visibleDashboardView?.totals.polymarket ?? 0, locale)}
              tone="sea"
              badge={formatPercent(polymarketShare, locale)}
              detail={`${t.latestDay}: ${formatAsOf(visiblePolymarketLastDay, locale, t.noData)}`}
            />
            <MetricCard
              title={t.kalshiVolume}
              value={formatCurrency(visibleDashboardView?.totals.kalshi ?? 0, locale)}
              tone="ember"
              badge={formatPercent(kalshiShare, locale)}
              detail={`${t.latestDay}: ${formatAsOf(visibleKalshiLastDay, locale, t.noData)}`}
            />
            <MetricCard
              title={t.difference}
              value={formatCurrency(Math.abs(visibleDashboardView?.totals.difference ?? 0), locale)}
              tone="ink"
              badge={(visibleDashboardView?.totals.difference ?? 0) >= 0 ? (language === "ru" ? "Лидер PM" : "PM lead") : language === "ru" ? "Лидер KA" : "KA lead"}
            />
          </section>

          <section className="control-deck">
            <div className="control-deck__row control-deck__row--primary">
              <div className="control-cluster">
                <div className="control-group">
                  <span className="control-group__label">{t.filterAppliesTo}</span>
                  <div className="segmented-control">
                    {categoryScopeOptions.map((item) => (
                      <button
                        key={item.value}
                        className={item.value === categoryScope ? "segmented-control__option segmented-control__option--active" : "segmented-control__option"}
                        type="button"
                        onClick={() => setCategoryScope(item.value)}
                        aria-pressed={item.value === categoryScope}
                      >
                        {t[item.labelKey]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

            </div>

            <div className="control-deck__row control-deck__row--category-head">
              <div className="category-toolbar-title">
                <span className="control-group__label">{t.categories}</span>
                <strong className="control-group__counter">
                  {selected.length}/{categories.length}
                </strong>
              </div>
              <div className="control-group__actions">
                <button className="mini-button" onClick={selectAllCategories} disabled={!categories.length} type="button">
                  {uiText.includeAll}
                </button>
                <button className="mini-button" onClick={clearCategories} disabled={!categories.length} type="button">
                  {uiText.clearSelection}
                </button>
                <button className="mini-button mini-button--strong" onClick={() => setCategoriesOpen((current) => !current)} type="button">
                  {categoriesOpen ? uiText.hideCategories : uiText.showCategories}
                </button>
              </div>
            </div>

            {categoriesOpen ? (
              <div className="control-deck__row control-deck__row--category-grid">
                <div className="category-matrix">
                  {categories.map((item) => {
                    const active = selected.includes(item.slug);
                    return (
                      <button
                        key={item.slug}
                        className={active ? "category-chip category-chip--active" : "category-chip"}
                        onClick={() => toggleCategory(item.slug)}
                        type="button"
                      >
                        <span className="category-chip__label">{translateCategory(item.slug, item.label, language)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </section>

          <section className="chart-panel">
            <div className="panel-head panel-head--chart">
              <div className="chart-head__range">
                <span className="control-group__label">{t.range}</span>
                <div className="segmented-control">
                  {rangeOptions.map((item) => (
                    <button
                      key={item.value}
                      className={item.value === range ? "segmented-control__option segmented-control__option--active" : "segmented-control__option"}
                      onClick={() => setRange(item.value)}
                      type="button"
                    >
                      {item.labelKey ? t[item.labelKey] : item.fallback}
                    </button>
                  ))}
                </div>
              </div>

              <div className="chart-head__title">
                <span className="panel-kicker">{t.combinedView}</span>
                <h2 className="panel-title">{t.chartTitle}</h2>
              </div>

              <div className="chart-head__controls">
                <span className="control-group__label control-group__label--ghost" aria-hidden="true">
                  {t.range}
                </span>
                <div className="chart-toolbar">
                  <div className="segmented-control" aria-label={t.chartType}>
                    {chartModeOptions.map((item) => (
                      <button
                      key={item.value}
                      className={item.value === chartMode ? "segmented-control__option segmented-control__option--active" : "segmented-control__option"}
                      type="button"
                      onClick={() => setChartMode(item.value)}
                      aria-pressed={item.value === chartMode}
                    >
                      {t[item.labelKey]}
                      </button>
                    ))}
                  </div>

                  <div className="platform-toggle-row">
                    <button
                      className={visiblePlatforms.polymarket ? "platform-pill platform-pill--sea platform-pill--active" : "platform-pill platform-pill--sea"}
                      onClick={() => togglePlatform("polymarket")}
                      aria-pressed={visiblePlatforms.polymarket}
                      type="button"
                    >
                      Polymarket
                    </button>
                    <button
                      className={visiblePlatforms.kalshi ? "platform-pill platform-pill--ember platform-pill--active" : "platform-pill platform-pill--ember"}
                      onClick={() => togglePlatform("kalshi")}
                      aria-pressed={visiblePlatforms.kalshi}
                      type="button"
                    >
                      Kalshi
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {dashboardQuery.isFetching && !dashboardQuery.isLoading ? (
              <div className="chart-subtle-note">{t.refreshingSnapshot}</div>
            ) : null}

            {hasNonZeroPoints ? (
              <VolumeChart
                data={dashboardView.points}
                visiblePlatforms={visiblePlatforms}
                language={language}
                chartMode={chartMode}
                theme={theme}
                resetKey={chartResetKey}
                onWindowChange={handleChartWindowChange}
              />
            ) : (
              <StatePanel
                title={hasSelection ? t.noVolumeTitle : t.chooseCategoryTitle}
                body={hasSelection ? t.noVolumeBody : t.chooseCategoryBody}
              />
            )}

            <div className="chart-meta-strip">
              <article className="chart-meta-pill">
                <span>{uiText.visibleDays}</span>
                <strong>{visibleDashboardView?.points.length ?? 0}</strong>
              </article>
              <article className="chart-meta-pill">
                <span>{uiText.activeCategories}</span>
                <strong>{activeCategoryCount}</strong>
              </article>
            </div>
          </section>

          <section className="analytics-grid">
            <article className="analytics-panel analytics-panel--wide">
              <div className="panel-head panel-head--analytics">
                <div>
                  <h2 className="panel-title">{uiText.categoryBreakdownTitle}</h2>
                </div>
                <p className="panel-copy">{uiText.categoryBreakdownBody}</p>
              </div>

              {categoryBreakdown.length ? (
                <div className="breakdown-table">
                  <div className="breakdown-table__head">
                    <span>{uiText.category}</span>
                    <span>Polymarket</span>
                    <span>Kalshi</span>
                    <span>{uiText.total}</span>
                    <span>{uiText.share}</span>
                  </div>

                  <div className="breakdown-table__body">
                    {categoryBreakdown.slice(0, 8).map((item) => {
                      const polymarketWidth = maxCategoryTotal > 0 ? `${(item.polymarket / maxCategoryTotal) * 100}%` : "0%";
                      const kalshiWidth = maxCategoryTotal > 0 ? `${(item.kalshi / maxCategoryTotal) * 100}%` : "0%";

                      return (
                        <article key={item.slug} className="breakdown-row">
                          <div className="breakdown-row__category">
                            <strong>{translateCategory(item.slug, item.label, language)}</strong>
                          </div>
                          <div className="breakdown-row__metric">
                            <span>{formatCurrency(item.polymarket, locale)}</span>
                            <div className="mini-bar">
                              <span className="mini-bar__fill mini-bar__fill--sea" style={{ width: polymarketWidth }} />
                            </div>
                          </div>
                          <div className="breakdown-row__metric">
                            <span>{formatCurrency(item.kalshi, locale)}</span>
                            <div className="mini-bar">
                              <span className="mini-bar__fill mini-bar__fill--ember" style={{ width: kalshiWidth }} />
                            </div>
                          </div>
                          <div className="breakdown-row__total">{formatCurrency(item.total, locale)}</div>
                          <div className="breakdown-row__share">{formatPercent(item.shareOfVisibleTotal, locale)}</div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="inline-empty">{uiText.noCategoryFlow}</div>
              )}
            </article>

            <article className="analytics-panel">
              <div className="panel-head panel-head--analytics">
                <div>
                  <h2 className="panel-title">{uiText.distributionTitle}</h2>
                </div>
                <p className="panel-copy">{uiText.distributionBody}</p>
              </div>

              <div className="share-rail">
                <span className="share-rail__fill share-rail__fill--sea" style={{ width: `${polymarketShare * 100}%` }} />
                <span className="share-rail__fill share-rail__fill--ember" style={{ width: `${kalshiShare * 100}%` }} />
              </div>

              <div className="share-grid">
                <article className="share-cell share-cell--sea">
                  <span>Polymarket</span>
                  <strong>{formatPercent(polymarketShare, locale)}</strong>
                  <small>{formatCurrency(visibleDashboardView?.totals.polymarket ?? 0, locale)}</small>
                </article>
                <article className="share-cell share-cell--ember">
                  <span>Kalshi</span>
                  <strong>{formatPercent(kalshiShare, locale)}</strong>
                  <small>{formatCurrency(visibleDashboardView?.totals.kalshi ?? 0, locale)}</small>
                </article>
              </div>

              <dl className="stats-list">
                <div>
                  <dt>{uiText.visibleDays}</dt>
                  <dd>{visibleDashboardView?.points.length ?? 0}</dd>
                </div>
                <div>
                  <dt>{uiText.activeCategories}</dt>
                  <dd>{activeCategoryCount}</dd>
                </div>
                <div>
                  <dt>{uiText.dataThrough}</dt>
                  <dd>{visibleLastDayLabel}</dd>
                </div>
                <div>
                  <dt>{t.lastUpdated}</dt>
                  <dd>{lastUpdatedLabel}</dd>
                </div>
              </dl>
            </article>

            <article className="analytics-panel">
              <div className="panel-head panel-head--analytics">
                <div>
                  <h2 className="panel-title">{uiText.leadersTitle}</h2>
                </div>
                <p className="panel-copy">{uiText.leadersBody}</p>
              </div>

              <div className="leader-list">
                <article className="leader-card leader-card--sea">
                  <span>{uiText.polymarketLead}</span>
                  <strong>{topPolymarketCategory ? translateCategory(topPolymarketCategory.slug, topPolymarketCategory.label, language) : t.noData}</strong>
                  <small>{topPolymarketCategory ? formatCurrency(topPolymarketCategory.polymarket, locale) : t.noData}</small>
                </article>
                <article className="leader-card leader-card--ember">
                  <span>{uiText.kalshiLead}</span>
                  <strong>{topKalshiCategory ? translateCategory(topKalshiCategory.slug, topKalshiCategory.label, language) : t.noData}</strong>
                  <small>{topKalshiCategory ? formatCurrency(topKalshiCategory.kalshi, locale) : t.noData}</small>
                </article>
              </div>

              <div className="leader-summary">
                <div>
                  <span>{uiText.total}</span>
                  <strong>{formatCurrency(visibleDashboardView?.totals.total ?? 0, locale)}</strong>
                </div>
                <div>
                  <span>{uiText.visibleDay}</span>
                  <strong>
                    {formatAsOf(
                      visibleDashboardView?.visibleLastDay ?? null,
                      locale,
                      t.noData,
                    )}
                  </strong>
                </div>
              </div>
            </article>
          </section>
        </>
      ) : null}

    </main>
  );
}

export default App;
