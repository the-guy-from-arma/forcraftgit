"""Strict PostgreSQL connection boundaries for Railway services.

This module intentionally does not provide database fallbacks.  A service must
receive the exact URL for the database it is allowed to use.  In particular,
CAD 2 must never fall back to CAD 1's ``DATABASE_URL`` and FCX must never fall
back to either CAD database.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import psycopg


@dataclass(frozen=True)
class DatabaseProbe:
    configured: bool
    connected: bool
    error_type: str = ""
    database_identity: str = ""

    def public_payload(self) -> dict[str, Any]:
        """Return connection status without disclosing credentials or names."""
        return {
            "configured": self.configured,
            "connected": self.connected,
            "error_type": self.error_type,
        }


def required_url(variable_name: str) -> str:
    value = str(os.environ.get(variable_name) or "").strip()
    if not value:
        raise RuntimeError(f"{variable_name} is required for this service")
    return value


def probe_url(url: str, *, application_name: str, timeout_seconds: int = 5) -> DatabaseProbe:
    if not str(url or "").strip():
        return DatabaseProbe(configured=False, connected=False, error_type="not_configured")
    try:
        with psycopg.connect(
            url,
            connect_timeout=max(2, int(timeout_seconds)),
            application_name=application_name,
        ) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT current_database(), "
                    "inet_server_addr()::text, inet_server_port(), 1"
                )
                row = cursor.fetchone()
        return DatabaseProbe(
            configured=True,
            connected=bool(row and row[3] == 1),
            # Railway commonly names every provisioned database ``railway``.
            # Include the PostgreSQL server address and port so two dedicated
            # services are not mistaken for one database merely because their
            # database names match.
            database_identity="|".join(str(part or "") for part in row[:3]) if row else "",
        )
    except Exception as exc:
        return DatabaseProbe(
            configured=True,
            connected=False,
            error_type=type(exc).__name__,
        )


def probe_environment(variable_name: str, *, application_name: str) -> DatabaseProbe:
    return probe_url(
        str(os.environ.get(variable_name) or "").strip(),
        application_name=application_name,
    )

