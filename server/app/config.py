from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    agnes_api_key: str = ""
    agnes_base_url: str = "https://apihub.agnes-ai.com/v1"
    agnes_model: str = "agnes-2.0-flash"
    app_host: str = "127.0.0.1"
    app_port: int = 8000
    database_url: str = "sqlite:///./data/sp_training.db"

    @property
    def sqlite_path(self) -> Path:
        raw = self.database_url
        if raw.startswith("sqlite:///"):
            p = Path(raw.replace("sqlite:///", "", 1))
        else:
            p = Path(raw)
        if not p.is_absolute():
            p = (ROOT / p).resolve()
        return p

    @property
    def api_key_masked(self) -> str:
        key = self.agnes_api_key or ""
        if len(key) < 12:
            return "(未配置)"
        return f"{key[:7]}…{key[-4:]}"


@lru_cache
def get_settings() -> Settings:
    return Settings()
