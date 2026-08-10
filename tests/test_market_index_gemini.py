import unittest

from market_math import market_gemini_exposure_shares


class MarketGeminiExposureTests(unittest.TestCase):
    def test_buy_heavy_constituent_keeps_positive_exposure(self) -> None:
        self.assertEqual(market_gemini_exposure_shares(350, 125), 225)

    def test_sell_heavy_fcxv_constituent_is_not_dropped(self) -> None:
        self.assertEqual(market_gemini_exposure_shares(125, 350), 225)

    def test_balanced_constituent_is_flat(self) -> None:
        self.assertEqual(market_gemini_exposure_shares(250, 250), 0)


if __name__ == "__main__":
    unittest.main()
