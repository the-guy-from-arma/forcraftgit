"""Railway entry point that preserves CAD 1 while isolating CAD 2."""

from __future__ import annotations

import os
import sys


def main() -> None:
    role = os.getenv("APP_DATABASE_ROLE", "cad1").strip().lower()

    if role == "cad2":
        command = [
            sys.executable,
            "-m",
            "uvicorn",
            "cad2_service:app",
            "--host",
            "0.0.0.0",
            "--port",
            os.getenv("PORT", "8000"),
        ]
    else:
        # Keep the existing CAD 1 application process unchanged.
        command = [sys.executable, "app.py"]

    os.execv(sys.executable, command)


if __name__ == "__main__":
    main()
