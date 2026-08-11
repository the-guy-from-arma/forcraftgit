import math
import unittest
from pathlib import Path

from business_issuer import _float, _public_company, _text, _ticker


ROOT = Path(__file__).resolve().parents[1]
APP_SOURCE = (ROOT / "app.py").read_text(encoding="utf-8")


class BusinessIssuerHelpersTest(unittest.TestCase):
    def test_ticker_is_uppercase_compact_and_bounded(self):
        self.assertEqual(_ticker(" fc-x ipo! 2026 "), "FCXIPO20")

    def test_text_normalizes_whitespace_and_applies_limit(self):
        self.assertEqual(_text("  Faircroft\n  Foundry   Network  ", 19), "Faircroft Foundry N")

    def test_float_rejects_invalid_and_non_finite_values(self):
        self.assertEqual(_float("not-a-number", 7.0), 7.0)
        self.assertEqual(_float(math.inf, 8.0), 8.0)
        self.assertEqual(_float("12.5"), 12.5)

    def test_public_company_normalizes_financial_fields(self):
        public = _public_company(
            {
                "target_market_cap": "123456.789",
                "authorized_shares": "456.123456789",
                "security_active": 1,
                "company_name": "Faircroft Industries",
            }
        )
        self.assertEqual(public["target_market_cap"], 123456.79)
        self.assertEqual(public["authorized_shares"], 456.123457)
        self.assertIs(public["security_active"], True)
        self.assertEqual(public["company_name"], "Faircroft Industries")

    def test_company_action_routes_read_the_numeric_company_segment(self):
        route_source = APP_SOURCE.split('elif path == "/api/business/companies"', 1)[1].split(
            'elif path == "/api/business/applications"', 1
        )[0]
        for handler in (
            "api_business_contribute",
            "api_business_announcement",
            "api_business_retry_funding",
            "api_business_bankruptcy",
        ):
            self.assertIn(f"self.{handler}(db, user, self.path_int(path, 3))", route_source)
        self.assertNotIn("self.path_int(path, 4)", route_source)


if __name__ == "__main__":
    unittest.main()
