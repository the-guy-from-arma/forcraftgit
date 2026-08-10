import unittest

from market_math import market_cap_weighted_allocations


class MarketFecAllocationTests(unittest.TestCase):
    def test_market_cap_weighted_allocations_reconcile_to_the_cent(self) -> None:
        allocations = market_cap_weighted_allocations([(1, 60), (2, 30), (3, 10)], 100.01)

        self.assertEqual([row["amount"] for row in allocations], [60.0, 30.0, 10.01])
        self.assertEqual(round(sum(float(row["amount"]) for row in allocations), 2), 100.01)

    def test_market_cap_weighted_allocations_skip_non_positive_caps(self) -> None:
        allocations = market_cap_weighted_allocations([(1, 0), (2, -5), (3, 25)], 50)

        self.assertEqual(allocations, [{"security_id": 3, "amount": 50.0, "weight": 1.0}])


if __name__ == "__main__":
    unittest.main()
