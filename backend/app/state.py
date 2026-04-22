from __future__ import annotations

from dataclasses import dataclass

from app.clients.dune import DuneClient
from app.config import Settings
from app.services.dashboard_data import DashboardDataService


@dataclass(slots=True)
class AppServices:
    settings: Settings
    dashboard_data: DashboardDataService
    dune: DuneClient


services: AppServices | None = None
