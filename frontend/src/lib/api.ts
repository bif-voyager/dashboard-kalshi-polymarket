export type RangeValue = "7d" | "30d" | "90d" | "all";
export type CategoryScope = "both" | "polymarket" | "kalshi";
export type DashboardPlatform = "Kalshi" | "Polymarket";

export interface DashboardRow {
  day: string;
  platform: DashboardPlatform;
  category: string;
  volume_usd: number;
}

export interface DashboardMeta {
  cached_at: string;
  is_stale: boolean;
  kalshi_query_id: number;
  polymarket_query_id: number;
  kalshi_last_day: string | null;
  polymarket_last_day: string | null;
  common_last_day: string | null;
  categories: string[];
}

export interface DashboardDataResponse {
  rows: DashboardRow[];
  meta: DashboardMeta;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, init);
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const payload = await response.json();
      detail = payload.detail ?? detail;
    } catch {
      detail = response.statusText;
    }
    throw new ApiError(detail, response.status);
  }
  return response.json() as Promise<T>;
}

export async function fetchDashboardData(): Promise<DashboardDataResponse> {
  return request<DashboardDataResponse>("/api/dashboard-data");
}
