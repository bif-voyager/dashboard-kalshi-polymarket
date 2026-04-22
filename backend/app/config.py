from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Market Dashboard API"
    app_env: str = "development"
    api_port: int = 8000
    request_timeout_seconds: int = 30
    cache_ttl_minutes: int = 60
    cache_file_path: str = "data/dashboard-cache.json"

    dune_api_key: str | None = None
    dune_base_url: str = "https://api.dune.com/api/v1"
    dune_polymarket_query_id: int = 7345278
    dune_kalshi_query_id: int = 7345291
    dune_page_limit: int = 1000
    dune_max_pages: int = 1000

    allowed_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ]
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
