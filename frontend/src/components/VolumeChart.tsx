import { useEffect, useMemo, useRef } from "react";
import {
  AreaSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  type AreaData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type LogicalRange,
  type MouseEventParams,
  type SeriesType,
  type Time,
  type WhitespaceData,
} from "lightweight-charts";
import type { VolumePoint } from "../lib/dashboard";
import { formatCompactCurrency, formatCurrency } from "../lib/format";
import type { Language } from "../lib/i18n";
import { localeByLanguage, translations } from "../lib/i18n";

export type ChartMode = "line" | "area" | "bar";

export interface ChartWindowRange {
  start: number;
  end: number;
}

interface VolumeChartProps {
  data: VolumePoint[];
  visiblePlatforms: {
    polymarket: boolean;
    kalshi: boolean;
  };
  language: Language;
  chartMode: ChartMode;
  theme: "light" | "dark";
  resetKey: string;
  onWindowChange?: (window: ChartWindowRange) => void;
}

interface ChartPalette {
  bgPanel: string;
  sea: string;
  ember: string;
  seaFill: string;
  emberFill: string;
  grid: string;
  tick: string;
  line: string;
  tooltipBg: string;
  tooltipShadow: string;
  ink: string;
}

interface SeriesRefMap {
  polymarket: ISeriesApi<SeriesType, Time>[];
  kalshi: ISeriesApi<SeriesType, Time>[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function readPalette(): ChartPalette {
  if (typeof window === "undefined") {
    return {
      bgPanel: "#111722",
      sea: "#38bdf8",
      ember: "#22c55e",
      seaFill: "rgba(56, 189, 248, 0.22)",
      emberFill: "rgba(34, 197, 94, 0.22)",
      grid: "rgba(148, 163, 184, 0.14)",
      tick: "rgba(216, 226, 236, 0.72)",
      line: "rgba(148, 163, 184, 0.16)",
      tooltipBg: "rgba(13, 17, 24, 0.98)",
      tooltipShadow: "0 24px 60px rgba(0, 0, 0, 0.45)",
      ink: "#f3f7fb",
    };
  }

  const styles = window.getComputedStyle(document.documentElement);
  const valueOf = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;

  return {
    bgPanel: valueOf("--bg-panel", "#111722"),
    sea: valueOf("--sea", "#38bdf8"),
    ember: valueOf("--ember", "#22c55e"),
    seaFill: valueOf("--sea-soft", "rgba(56, 189, 248, 0.22)"),
    emberFill: valueOf("--ember-soft", "rgba(34, 197, 94, 0.22)"),
    grid: valueOf("--chart-grid", "rgba(148, 163, 184, 0.14)"),
    tick: valueOf("--chart-tick", "rgba(216, 226, 236, 0.72)"),
    line: valueOf("--line", "rgba(148, 163, 184, 0.16)"),
    tooltipBg: valueOf("--tooltip-bg", "rgba(13, 17, 24, 0.98)"),
    tooltipShadow: valueOf("--tooltip-shadow", "0 24px 60px rgba(0, 0, 0, 0.45)"),
    ink: valueOf("--ink", "#f3f7fb"),
  };
}

function formatTooltipDate(value: Time | undefined, locale: string): string {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return new Date(`${value}T00:00:00Z`).toLocaleDateString(locale, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  if (typeof value === "number") {
    return new Date(value * 1000).toLocaleDateString(locale, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  return new Date(Date.UTC(value.year, value.month - 1, value.day)).toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

type LineSeriesPoint = LineData<Time> | AreaData<Time> | WhitespaceData<Time>;

function buildSeriesSegments(data: VolumePoint[], key: "polymarket" | "kalshi"): LineSeriesPoint[][] {
  const segments: LineSeriesPoint[][] = [];
  let current: LineSeriesPoint[] = [];

  for (const point of data) {
    if (point[key] === null) {
      if (current.length) {
        segments.push(current);
        current = [];
      }
      continue;
    }

    current.push({
      time: point.date as Time,
      value: point[key],
    });
  }

  if (current.length) {
    segments.push(current);
  }

  return segments;
}

function barTimeForDate(day: string, key: "polymarket" | "kalshi"): Time {
  const dayOffsetSeconds = key === "polymarket" ? -14_400 : 14_400;
  return (Math.floor(new Date(`${day}T12:00:00Z`).getTime() / 1000) + dayOffsetSeconds) as Time;
}

function buildBarSeriesData(data: VolumePoint[], key: "polymarket" | "kalshi"): HistogramData<Time>[] {
  return data
    .filter((point) => point[key] !== null)
    .map((point) => ({
      time: barTimeForDate(point.date, key),
      value: point[key] ?? 0,
    }));
}

export function VolumeChart({ data, visiblePlatforms, language, chartMode, theme, resetKey, onWindowChange }: VolumeChartProps) {
  const locale = localeByLanguage[language];
  const t = translations[language];
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<SeriesRefMap>({ polymarket: [], kalshi: [] });
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const tooltipDateRef = useRef<HTMLDivElement | null>(null);
  const tooltipPolyRef = useRef<HTMLDivElement | null>(null);
  const tooltipKalshiRef = useRef<HTMLDivElement | null>(null);
  const notifyFrameRef = useRef<number | null>(null);
  const lastNotifiedWindowRef = useRef<ChartWindowRange | null>(null);
  const visibleLogicalRangeRef = useRef<LogicalRange | null>(null);
  const latestDataRef = useRef<VolumePoint[]>(data);
  const latestPointMapRef = useRef<Map<string, VolumePoint>>(new Map());
  const onWindowChangeRef = useRef(onWindowChange);
  const lastDataSignatureRef = useRef<string>("");
  const lastResetKeyRef = useRef<string>("");
  const suppressWindowUntilRef = useRef(0);
  const userWindowIntentUntilRef = useRef(0);
  const latestLocaleRef = useRef(locale);
  const noDataLabelRef = useRef(t.noData);
  const visiblePlatformsRef = useRef(visiblePlatforms);
  const chartModeRef = useRef(chartMode);
  const lastChartModeRef = useRef(chartMode);

  const polymarketSegments = useMemo(() => buildSeriesSegments(data, "polymarket"), [data]);
  const kalshiSegments = useMemo(() => buildSeriesSegments(data, "kalshi"), [data]);
  const polymarketBarData = useMemo(() => buildBarSeriesData(data, "polymarket"), [data]);
  const kalshiBarData = useMemo(() => buildBarSeriesData(data, "kalshi"), [data]);
  const dataSignature = data.length ? `${data[0]?.date}:${data[data.length - 1]?.date}:${data.length}` : "empty";

  function suppressWindowNotifications(milliseconds = 180) {
    suppressWindowUntilRef.current = Math.max(suppressWindowUntilRef.current, Date.now() + milliseconds);
    if (notifyFrameRef.current !== null) {
      cancelAnimationFrame(notifyFrameRef.current);
      notifyFrameRef.current = null;
    }
  }

  function markUserWindowIntent(milliseconds = 1_200) {
    userWindowIntentUntilRef.current = Date.now() + milliseconds;
  }

  useEffect(() => {
    latestDataRef.current = data;
    latestPointMapRef.current = new Map(data.map((point) => [point.date, point]));
  }, [data]);

  function timeToDayKey(value: Time): string | null {
    if (typeof value === "string") {
      return value;
    }

    if (typeof value === "number") {
      return new Date(value * 1000).toISOString().slice(0, 10);
    }

    const month = String(value.month).padStart(2, "0");
    const day = String(value.day).padStart(2, "0");
    return `${value.year}-${month}-${day}`;
  }

  useEffect(() => {
    onWindowChangeRef.current = onWindowChange;
  }, [onWindowChange]);

  useEffect(() => {
    latestLocaleRef.current = locale;
    noDataLabelRef.current = t.noData;
    visiblePlatformsRef.current = visiblePlatforms;
    chartModeRef.current = chartMode;
  }, [chartMode, locale, t.noData, visiblePlatforms]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const palette = readPalette();
    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: palette.bgPanel },
        textColor: palette.tick,
        attributionLogo: false,
      },
      leftPriceScale: {
        visible: false,
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.12, bottom: 0.08 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: false,
        secondsVisible: false,
        minBarSpacing: 0.25,
        rightOffset: 0,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      grid: {
        vertLines: { color: palette.grid, visible: false },
        horzLines: { color: palette.grid, visible: true },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          visible: true,
          color: palette.line,
          labelVisible: false,
          width: 1,
          style: 0,
        },
        horzLine: {
          visible: true,
          color: palette.line,
          labelVisible: false,
          width: 1,
          style: 0,
        },
      },
      localization: {
        locale: latestLocaleRef.current,
        priceFormatter: (value: number) => formatCompactCurrency(value, latestLocaleRef.current),
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: false,
      },
    });

    chartRef.current = chart;

    const handleVisibleLogicalRangeChange = (range: LogicalRange | null) => {
      visibleLogicalRangeRef.current = range;

      const now = Date.now();
      if (now < suppressWindowUntilRef.current || now > userWindowIntentUntilRef.current) {
        lastNotifiedWindowRef.current = null;
        return;
      }

      const rows = latestDataRef.current;
      const maxIndex = Math.max(rows.length - 1, 0);
      let nextWindow: ChartWindowRange;

      if (range === null || rows.length === 0) {
        nextWindow = { start: 0, end: maxIndex };
      } else {
        // Count only points whose center is inside the usable plot area.
        // Lightweight Charts can include edge points that are technically in
        // the logical range but are clipped enough that hover/labels are not
        // useful for the user.
        const edgePaddingPx = 24;
        const plotWidth = container.clientWidth;
        const minX = edgePaddingPx;
        const maxX = Math.max(plotWidth - edgePaddingPx, minX);

        const coordinatesForPoint = (point: VolumePoint): number[] => {
          const times =
            chartModeRef.current === "bar"
              ? [
                  point.polymarket !== null ? barTimeForDate(point.date, "polymarket") : null,
                  point.kalshi !== null ? barTimeForDate(point.date, "kalshi") : null,
                ]
              : [point.date as Time];

          return times
            .map((time) => (time === null ? null : chart.timeScale().timeToCoordinate(time)))
            .filter((coordinate) => coordinate !== null)
            .map((coordinate) => Number(coordinate));
        };

        const firstCoordinates = coordinatesForPoint(rows[0]);
        const lastCoordinates = coordinatesForPoint(rows[maxIndex]);
        const fullDatasetIsBackInView =
          firstCoordinates.length > 0 &&
          lastCoordinates.length > 0 &&
          Math.min(...firstCoordinates) >= -edgePaddingPx &&
          Math.max(...lastCoordinates) <= plotWidth + edgePaddingPx;

        if (fullDatasetIsBackInView) {
          nextWindow = { start: 0, end: maxIndex };
        } else {
          const visibleIndexes: number[] = [];

          for (let index = 0; index <= maxIndex; index += 1) {
            const point = rows[index];
            const mode = chartModeRef.current;
            const candidateTimes: Time[] = [];

            if (mode === "bar") {
              if (visiblePlatformsRef.current.polymarket && point.polymarket !== null) {
                candidateTimes.push(barTimeForDate(point.date, "polymarket"));
              }
              if (visiblePlatformsRef.current.kalshi && point.kalshi !== null) {
                candidateTimes.push(barTimeForDate(point.date, "kalshi"));
              }
            } else {
              candidateTimes.push(point.date as Time);
            }

            const pointIsVisible = candidateTimes.some((time) => {
              const x = chart.timeScale().timeToCoordinate(time);
              return x !== null && x >= minX && x <= maxX;
            });

            if (pointIsVisible) {
              visibleIndexes.push(index);
            }
          }

          if (visibleIndexes.length) {
            nextWindow = {
              start: visibleIndexes[0],
              end: visibleIndexes[visibleIndexes.length - 1],
            };
          } else {
            const nearestIndex = clamp(Math.round((range.from + range.to) / 2), 0, maxIndex);
            nextWindow = { start: nearestIndex, end: nearestIndex };
          }
        }
      }

      if (nextWindow.end < nextWindow.start) {
        nextWindow.end = nextWindow.start;
      }

      if (
        lastNotifiedWindowRef.current?.start === nextWindow.start &&
        lastNotifiedWindowRef.current?.end === nextWindow.end
      ) {
        return;
      }

      if (notifyFrameRef.current !== null) {
        cancelAnimationFrame(notifyFrameRef.current);
      }

      notifyFrameRef.current = window.requestAnimationFrame(() => {
        notifyFrameRef.current = null;
        lastNotifiedWindowRef.current = nextWindow;
        onWindowChangeRef.current?.(nextWindow);
      });
    };

    const handleCrosshairMove = (param: MouseEventParams<Time>) => {
      const tooltip = tooltipRef.current;
      const tooltipDate = tooltipDateRef.current;
      const tooltipPoly = tooltipPolyRef.current;
      const tooltipKalshi = tooltipKalshiRef.current;

      if (!tooltip || !tooltipDate || !tooltipPoly || !tooltipKalshi) {
        return;
      }

      if (!param.point || !param.time || param.point.x < 0 || param.point.y < 0) {
        tooltip.style.opacity = "0";
        return;
      }

      const pointForDay = latestPointMapRef.current.get(timeToDayKey(param.time) ?? "");
      const polymarketValue = pointForDay?.polymarket ?? null;
      const kalshiValue = pointForDay?.kalshi ?? null;

      const currentLocale = latestLocaleRef.current;
      const noDataLabel = noDataLabelRef.current;
      tooltipDate.textContent = formatTooltipDate(param.time, currentLocale);
      tooltipPoly.textContent = `Polymarket: ${polymarketValue === null ? noDataLabel : formatCurrency(polymarketValue, currentLocale)}`;
      tooltipKalshi.textContent = `Kalshi: ${kalshiValue === null ? noDataLabel : formatCurrency(kalshiValue, currentLocale)}`;
      tooltipPoly.style.display = visiblePlatformsRef.current.polymarket ? "block" : "none";
      tooltipKalshi.style.display = visiblePlatformsRef.current.kalshi ? "block" : "none";

      const width = container.clientWidth;
      const height = container.clientHeight;
      const tooltipWidth = tooltip.offsetWidth || 180;
      const tooltipHeight = tooltip.offsetHeight || 78;
      const left = clamp(param.point.x + 14, 12, Math.max(width - tooltipWidth - 12, 12));
      const top = clamp(param.point.y - tooltipHeight - 16, 12, Math.max(height - tooltipHeight - 12, 12));

      tooltip.style.transform = `translate(${left}px, ${top}px)`;
      tooltip.style.opacity = "1";
    };

    const handleDoubleClick = (event: MouseEvent) => {
      event.preventDefault();
      markUserWindowIntent();
      lastNotifiedWindowRef.current = null;
      chart.timeScale().fitContent();
    };

    const handleWheel = (event: WheelEvent) => {
      markUserWindowIntent();
      event.preventDefault();
    };

    const handlePointerDown = () => {
      markUserWindowIntent(4_000);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.buttons > 0) {
        markUserWindowIntent(1_500);
      }
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleLogicalRangeChange);
    chart.subscribeCrosshairMove(handleCrosshairMove);
    container.addEventListener("dblclick", handleDoubleClick);
    container.addEventListener("wheel", handleWheel, { passive: false, capture: true });
    container.addEventListener("pointerdown", handlePointerDown, { capture: true });
    container.addEventListener("pointermove", handlePointerMove, { capture: true });

    return () => {
      if (notifyFrameRef.current !== null) {
        cancelAnimationFrame(notifyFrameRef.current);
      }
      container.removeEventListener("dblclick", handleDoubleClick);
      container.removeEventListener("wheel", handleWheel, { capture: true });
      container.removeEventListener("pointerdown", handlePointerDown, { capture: true });
      container.removeEventListener("pointermove", handlePointerMove, { capture: true });
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleLogicalRangeChange);
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = { polymarket: [], kalshi: [] };
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) {
      return;
    }

    const palette = readPalette();
    chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: palette.bgPanel },
        textColor: palette.tick,
        attributionLogo: false,
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.12, bottom: 0.08 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: false,
        secondsVisible: false,
        minBarSpacing: 0.25,
        rightOffset: 0,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      grid: {
        vertLines: { color: palette.grid, visible: false },
        horzLines: { color: palette.grid, visible: true },
      },
      localization: {
        locale,
        priceFormatter: (value: number) => formatCompactCurrency(value, locale),
      },
    });
  }, [locale, theme]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) {
      return;
    }

    const palette = readPalette();
    suppressWindowNotifications();

    for (const series of seriesRef.current.polymarket) {
      chart.removeSeries(series);
    }
    for (const series of seriesRef.current.kalshi) {
      chart.removeSeries(series);
    }
    seriesRef.current = { polymarket: [], kalshi: [] };

    if (chartMode === "line") {
      seriesRef.current.polymarket = polymarketSegments.map((segment) => {
        const series = chart.addSeries(LineSeries, {
          color: palette.sea,
          lineWidth: 2,
          crosshairMarkerVisible: true,
          lastValueVisible: false,
          priceLineVisible: false,
          visible: visiblePlatforms.polymarket,
        });
        series.setData(segment);
        return series;
      });
      seriesRef.current.kalshi = kalshiSegments.map((segment) => {
        const series = chart.addSeries(LineSeries, {
          color: palette.ember,
          lineWidth: 2,
          crosshairMarkerVisible: true,
          lastValueVisible: false,
          priceLineVisible: false,
          visible: visiblePlatforms.kalshi,
        });
        series.setData(segment);
        return series;
      });
    } else if (chartMode === "area") {
      seriesRef.current.polymarket = polymarketSegments.map((segment) => {
        const series = chart.addSeries(AreaSeries, {
          lineColor: palette.sea,
          topColor: palette.seaFill,
          bottomColor: "rgba(56, 189, 248, 0.03)",
          lineWidth: 2,
          crosshairMarkerVisible: true,
          lastValueVisible: false,
          priceLineVisible: false,
          visible: visiblePlatforms.polymarket,
        });
        series.setData(segment);
        return series;
      });
      seriesRef.current.kalshi = kalshiSegments.map((segment) => {
        const series = chart.addSeries(AreaSeries, {
          lineColor: palette.ember,
          topColor: palette.emberFill,
          bottomColor: "rgba(34, 197, 94, 0.03)",
          lineWidth: 2,
          crosshairMarkerVisible: true,
          lastValueVisible: false,
          priceLineVisible: false,
          visible: visiblePlatforms.kalshi,
        });
        series.setData(segment);
        return series;
      });
    } else {
      const polymarketSeries = chart.addSeries(HistogramSeries, {
        color: palette.sea,
        base: 0,
        priceLineVisible: false,
        lastValueVisible: false,
        visible: visiblePlatforms.polymarket,
      });
      polymarketSeries.setData(polymarketBarData);
      const kalshiSeries = chart.addSeries(HistogramSeries, {
        color: palette.ember,
        base: 0,
        priceLineVisible: false,
        lastValueVisible: false,
        visible: visiblePlatforms.kalshi,
      });
      kalshiSeries.setData(kalshiBarData);
      seriesRef.current.polymarket = [polymarketSeries];
      seriesRef.current.kalshi = [kalshiSeries];
    }

    const chartModeChanged = lastChartModeRef.current !== chartMode;
    const dataChanged = lastDataSignatureRef.current !== dataSignature;
    const resetKeyChanged = lastResetKeyRef.current !== resetKey;

    if (dataChanged || chartModeChanged || resetKeyChanged) {
      lastDataSignatureRef.current = dataSignature;
      lastChartModeRef.current = chartMode;
      lastResetKeyRef.current = resetKey;
      visibleLogicalRangeRef.current = null;
      lastNotifiedWindowRef.current = null;
      window.requestAnimationFrame(() => {
        suppressWindowNotifications();
        if (!data.length) {
          return;
        }
        if (chartMode === "bar") {
          chart.timeScale().setVisibleRange({
            from: barTimeForDate(data[0].date, "polymarket"),
            to: barTimeForDate(data[data.length - 1].date, "kalshi"),
          });
        } else {
          chart.timeScale().setVisibleRange({
            from: data[0].date as Time,
            to: data[data.length - 1].date as Time,
          });
        }
      });
    } else if (visibleLogicalRangeRef.current) {
      suppressWindowNotifications();
      chart.timeScale().setVisibleLogicalRange(visibleLogicalRangeRef.current);
    }
  }, [
    chartMode,
    dataSignature,
    data.length,
    kalshiBarData,
    kalshiSegments,
    polymarketBarData,
    polymarketSegments,
    resetKey,
    theme,
    visiblePlatforms.kalshi,
    visiblePlatforms.polymarket,
  ]);

  return (
    <div className="chart-shell" role="application" aria-label={t.chartInteractionHint}>
      <div ref={containerRef} className="chart-shell__canvas" />
      <div ref={tooltipRef} className="chart-tooltip" aria-hidden="true">
        <div ref={tooltipDateRef} className="chart-tooltip__date" />
        <div ref={tooltipPolyRef} className="chart-tooltip__line chart-tooltip__line--sea" />
        <div ref={tooltipKalshiRef} className="chart-tooltip__line chart-tooltip__line--ember" />
      </div>
    </div>
  );
}
