from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.models.api import DashboardDataResponse, HealthResponse
from app.state import AppServices

router = APIRouter(prefix="/api")


def get_services() -> AppServices:
    from app.state import services

    if services is None:
        raise RuntimeError("Application services are not initialized")
    return services


@router.get("/health", response_model=HealthResponse)
async def health(app_services: AppServices = Depends(get_services)) -> dict:
    return app_services.dashboard_data.health_payload()


@router.get("/dashboard-data", response_model=DashboardDataResponse)
async def dashboard_data(app_services: AppServices = Depends(get_services)) -> dict:
    try:
        return await app_services.dashboard_data.get_dashboard_data()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
