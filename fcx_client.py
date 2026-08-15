"""Authenticated FCX API client used by a single CAD community."""
from __future__ import annotations

import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from community_config import CommunityConfig


class FcxClientError(RuntimeError):
    pass


class FcxClient:
    def __init__(self, config: CommunityConfig, timeout_seconds: int = 12):
        self.config = config
        self.timeout_seconds = max(3, int(timeout_seconds))

    def request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        *,
        idempotency_key: str = "",
    ) -> dict[str, Any]:
        body = None if payload is None else json.dumps(payload, separators=(",", ":")).encode("utf-8")
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self.config.fcx_api_key}",
            "X-FCX-Community": self.config.fcx_community_id,
        }
        if body is not None:
            headers["Content-Type"] = "application/json"
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        request = Request(
            f"{self.config.fcx_api_url}/{path.lstrip('/')}",
            data=body,
            headers=headers,
            method=method.upper(),
        )
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                data = response.read().decode("utf-8")
                return json.loads(data) if data else {}
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:500]
            raise FcxClientError(f"FCX returned HTTP {exc.code}: {detail}") from exc
        except (URLError, TimeoutError) as exc:
            raise FcxClientError(f"FCX connection failed: {type(exc).__name__}") from exc

    def bootstrap(self) -> dict[str, Any]:
        return self.request("GET", "/api/v1/community/bootstrap")

    def market(self) -> dict[str, Any]:
        return self.request("GET", "/api/v1/community/market")

    def resolve_account(self, **payload: Any) -> dict[str, Any]:
        return self.request("POST", "/api/v1/community/ravenhood/resolve", payload)

    def portfolio(self, community_user_id: int | str, account_id: str) -> dict[str, Any]:
        query = urlencode({"account_id": str(account_id)})
        return self.request("GET", f"/api/v1/community/ravenhood/{community_user_id}/portfolio?{query}")

    def create_order(self, payload: dict[str, Any], idempotency_key: str) -> dict[str, Any]:
        return self.request("POST", "/api/v1/community/orders", payload, idempotency_key=idempotency_key)

    def get_order(self, trade_request_id: str) -> dict[str, Any]:
        return self.request("GET", f"/api/v1/community/orders/{trade_request_id}")

    def refresh_order(self, trade_request_id: str) -> dict[str, Any]:
        return self.request("POST", f"/api/v1/community/orders/{trade_request_id}/refresh", {})

