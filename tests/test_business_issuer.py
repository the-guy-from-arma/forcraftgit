import math
import unittest

from business_issuer import _float, _public_company, _text, _ticker


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


if __name__ == "__main__":
    unittest.main()
