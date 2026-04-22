from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.clients.dune import DuneClient
from app.config import Settings, get_settings
from app.routes.api import router
from app.services.dashboard_data import DashboardDataService
from app.state import AppServices


@asynccontextmanager
async def lifespan(app: FastAPI):
    from app import state

    settings = get_settings()
    dune = DuneClient(settings)
    dashboard_data = DashboardDataService(settings, dune)
    state.services = AppServices(
        settings=settings,
        dashboard_data=dashboard_data,
        dune=dune,
    )
    try:
        yield
    finally:
        await dashboard_data.close()
        await dune.close()
        state.services = None


def create_app() -> FastAPI:
    app = FastAPI(title="Market Dashboard API", version="0.2.0", lifespan=lifespan)
    settings = get_settings()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router)
    return app


app = create_app()
