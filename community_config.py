"""Strict service identity and FCX API boundary for Faircroft CAD 1.

CAD 1 owns only its community database, Arma bridge, and Bank Bridge adapter.
It is never permitted to connect to the FCX PostgreSQL database or run the
global exchange engine.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

from database_connections import probe_environment, required_url


def _required(name: str) -> str:
    value = str(os.environ.get(name) or "").strip()
    if not value:
        raise RuntimeError(f"{name} is required for CAD 1")
    return value


def _bool(name: str, default: bool = False) -> bool:
    raw = str(os.environ.get(name, "1" if default else "0")).strip().lower()
    return raw in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class CommunityConfig:
    community_id: str
    arma_server_id: str
    arma_bridge_api_key: str
    fcx_api_url: str
    fcx_api_key: str
    fcx_community_id: str
    fcx_remote_market_enabled: bool
    fcx_global_admin_enabled: bool

    @classmethod
    def load(cls) -> "CommunityConfig":
        role = str(os.environ.get("APP_DATABASE_ROLE") or "cad1").strip().lower()
        if role != "cad1":
            raise RuntimeError("APP_DATABASE_ROLE must be cad1")

        community_id = _required("COMMUNITY_ID").lower()
        if community_id not in {"faircroft", "cad1"}:
            raise RuntimeError("CAD 1 COMMUNITY_ID must identify Faircroft/CAD 1")

        fcx_community_id = _required("FCX_COMMUNITY_ID").lower()
        if fcx_community_id != community_id:
            raise RuntimeError("FCX_COMMUNITY_ID must exactly match COMMUNITY_ID")

        if not _bool("FCX_REMOTE_MARKET_ENABLED", True):
            raise RuntimeError("FCX_REMOTE_MARKET_ENABLED must remain enabled in CAD 1")
        if _bool("FCX_GLOBAL_ADMIN_ENABLED", False):
            raise RuntimeError("FCX_GLOBAL_ADMIN_ENABLED cannot be enabled in CAD 1")
        if _bool("FCX_RUN_INTEGRATED_ENGINE", False):
            raise RuntimeError("FCX_RUN_INTEGRATED_ENGINE cannot run inside CAD 1")
        if str(os.environ.get("FCX_DATABASE_URL") or "").strip():
            raise RuntimeError("FCX_DATABASE_URL must not be present in CAD 1")

        required_url("DATABASE_URL")
        return cls(
            community_id=community_id,
            arma_server_id=_required("ARMA_SERVER_ID"),
            arma_bridge_api_key=_required("ARMA_BRIDGE_API_KEY"),
            fcx_api_url=_required("FCX_API_URL").rstrip("/"),
            fcx_api_key=_required("FCX_API_KEY"),
            fcx_community_id=fcx_community_id,
            fcx_remote_market_enabled=True,
            fcx_global_admin_enabled=False,
        )

    def verify_database_connection(self) -> None:
        probe = probe_environment(
            "DATABASE_URL",
            application_name=f"thunderlink-{self.community_id}-startup",
        )
        if not probe.connected:
            raise RuntimeError(
                f"CAD 1 database preflight failed: {probe.error_type or 'connection_failed'}"
            )


def preflight() -> CommunityConfig:
    config = CommunityConfig.load()
    config.verify_database_connection()
    from fcx_client import FcxClient

    bootstrap = FcxClient(config).bootstrap()
    community = bootstrap.get("community") if isinstance(bootstrap.get("community"), dict) else {}
    remote_id = str(bootstrap.get("community_id") or community.get("community_id") or "").strip().lower()
    if remote_id != config.community_id:
        raise RuntimeError("FCX credential is not assigned to the Faircroft/CAD 1 community")
    return config

