"""Connection-only CAD 2 Railway service boundary.

This service deliberately has no CAD 1 routes, imports, schema setup, workers,
or migration behavior.  It proves that CAD 2 can reach only its own PostgreSQL
database plus the shared FCX database before CAD 2 application work begins.
"""
from __future__ import annotations

import os
from typing import Any

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from database_connections import isolated_pair_status


app = FastAPI(title="Faircroft CAD 2 Connection Boundary", version="1.0.0")


def _health() -> dict[str, Any]:
    role = str(os.environ.get("APP_DATABASE_ROLE") or "").strip().lower()
    if role != "cad2":
        return {
            "ok": False,
            "service": "cad2",
            "role_guard": False,
            "error": "APP_DATABASE_ROLE must be cad2",
        }
    status = isolated_pair_status(
        "DATABASE_URL",
        "FCX_DATABASE_URL",
        application_prefix="faircroft-cad2",
    )
    return {
        "service": "cad2",
        "role_guard": True,
        **status,
    }


@app.get("/")
def root() -> dict[str, str]:
    return {
        "service": "Faircroft CAD 2",
        "state": "connection-boundary",
    }


@app.get("/api/health")
def health() -> JSONResponse:
    payload = _health()
    return JSONResponse(payload, status_code=200 if payload.get("ok") else 503)
