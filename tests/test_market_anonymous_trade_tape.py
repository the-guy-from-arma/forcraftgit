from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class MarketAnonymousTradeTapeTests(unittest.TestCase):
    def test_payload_merges_resident_and_automated_buy_and_sell_flow(self):
        source = (ROOT / "app.py").read_text(encoding="utf-8")
        start = source.index("def market_anonymous_trade_tape")
        end = source.index("def market_payload", start)
        helper = source[start:end]
        self.assertIn("FROM market_orders", helper)
        self.assertIn("t.buy_volume", helper)
        self.assertIn("t.sell_volume", helper)
        self.assertIn("LOWER(t.source)='gemini'", helper)

    def test_public_tape_contract_does_not_return_identity_fields(self):
        source = (ROOT / "app.py").read_text(encoding="utf-8")
        start = source.index("def market_anonymous_trade_tape")
        end = source.index("def market_payload", start)
        returned_contract = source[source.index("return [{", start):end]
        self.assertNotIn('"account_id"', returned_contract)
        self.assertNotIn('"user_id"', returned_contract)
        self.assertNotIn('"civ_number"', returned_contract)
        self.assertNotIn('"name"', returned_contract)

    def test_wallstreet_payload_exposes_anonymous_tape(self):
        source = (ROOT / "app.py").read_text(encoding="utf-8")
        self.assertIn('"anonymous_trade_tape": anonymous_trade_tape', source)

    def test_anonymous_flow_renders_below_market_movers_not_header_tape(self):
        source = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        discovery_start = source.index('<aside class="market-v13-discovery">')
        discovery_end = source.index('</aside>', discovery_start)
        discovery = source[discovery_start:discovery_end]
        self.assertIn('market-live-execution-feed', discovery)
        self.assertIn('Hot right now', discovery)
        self.assertNotIn('market-live-order-tape', source)

    def test_live_feed_keeps_user_activity_anonymous(self):
        source = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        feed_start = source.index('const anonymousTradeTape')
        feed_end = source.index('return `<main', feed_start)
        feed = source[feed_start:feed_end]
        self.assertIn('ANONYMOUS', feed)
        self.assertIn('GEMINI', feed)
        self.assertNotIn('account_id', feed)
        self.assertNotIn('user_id', feed)
        self.assertNotIn('civ_number', feed)


if __name__ == "__main__":
    unittest.main()
