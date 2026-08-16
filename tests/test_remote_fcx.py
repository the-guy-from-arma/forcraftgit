import unittest
import sys
from types import SimpleNamespace
from types import ModuleType
from unittest.mock import patch

# Keep this adapter unit test independent from PostgreSQL and HTTP packages.
community_config_stub = ModuleType("community_config")
community_config_stub.CommunityConfig = type("CommunityConfig", (), {"load": staticmethod(lambda: None)})
fcx_client_stub = ModuleType("fcx_client")
fcx_client_stub.FcxClient = type("FcxClient", (), {})
fcx_client_stub.FcxClientError = type("FcxClientError", (RuntimeError,), {})
sys.modules.setdefault("community_config", community_config_stub)
sys.modules.setdefault("fcx_client", fcx_client_stub)

import remote_fcx


class RemoteFcxPayloadTests(unittest.TestCase):
    def test_grouped_fcx_history_and_execution_volume_are_preserved_for_cad_ui(self):
        client = SimpleNamespace(
            market=lambda **_kwargs: {
                "permissions": {"trading": True, "buy": True, "sell": True},
                "market": {"market_open": True},
                "securities": [{
                    "ticker": "FCF",
                    "price": 12,
                    "previous_price": 10,
                    "market_cap": 120000,
                }],
                "price_history": {
                    "FCF": [
                        {
                            "price": 12,
                            "recorded_at": "2026-08-15T12:01:00Z",
                            "volume": 9,
                            "buy_volume": 6,
                            "sell_volume": 3,
                            "trade_count": 2,
                        },
                        {
                            "price": 11,
                            "recorded_at": "2026-08-15T12:00:00Z",
                            "volume": 4,
                            "buy_volume": 1,
                            "sell_volume": 3,
                            "trade_count": 1,
                        },
                    ]
                },
            },
            portfolio=lambda *_: {"account": {"status": "active"}, "holdings": [], "orders": []},
        )
        user = {"id": 7, "name": "Resident"}
        with patch.object(remote_fcx, "_client", return_value=client), \
             patch.object(remote_fcx, "resolve_account", return_value={"account_id": "acct-7"}), \
             patch.object(remote_fcx.CommunityConfig, "load", return_value=SimpleNamespace(community_id="faircroft")):
            payload = remote_fcx.build_market_payload(
                user=user,
                identity_id="bohemia-7",
                game_bank_balance=500,
                game_bank_synced_at="now",
            )

        self.assertTrue(payload["market_open"])
        self.assertEqual(payload["exchange_market_cap"], 120000)
        self.assertEqual([row["price"] for row in payload["price_history"]["FCF"]], [11, 12])
        self.assertEqual([row["volume"] for row in payload["price_history"]["FCF"]], [4, 9])
        self.assertEqual(payload["price_history"]["FCF"][-1]["buy_volume"], 6)
        self.assertEqual(payload["price_history"]["FCF"][-1]["sell_volume"], 3)


if __name__ == "__main__":
    unittest.main()
