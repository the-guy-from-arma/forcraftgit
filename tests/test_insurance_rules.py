import unittest

from insurance_rules import insurance_claim_filing_error


class InsuranceClaimFilingModeTests(unittest.TestCase):
    def test_emergency_claim_is_available_during_declaration(self):
        self.assertIsNone(insurance_claim_filing_error(True, "server_reset"))

    def test_everyday_claim_is_blocked_during_declaration(self):
        message = insurance_claim_filing_error(True, "theft")
        self.assertIn("Only State of Emergency", message or "")

    def test_stock_claim_is_blocked_during_declaration(self):
        message = insurance_claim_filing_error(True, "stock_bankruptcy")
        self.assertIn("Only State of Emergency", message or "")

    def test_emergency_claim_closes_when_declaration_is_lifted(self):
        message = insurance_claim_filing_error(False, "server_reset")
        self.assertIn("declaration was lifted", message or "")

    def test_everyday_claim_returns_after_declaration_is_lifted(self):
        self.assertIsNone(insurance_claim_filing_error(False, "car_accident"))


if __name__ == "__main__":
    unittest.main()
