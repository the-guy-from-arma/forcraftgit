from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
CSS = (ROOT / "static" / "styles.css").read_text(encoding="utf-8")


def test_ravenhood_trade_ticket_supports_cash_and_fractional_share_sizing():
    assert 'data-market-open-ticket' in APP
    assert 'data-market-size-mode="cash"' in APP
    assert 'data-market-share-slider' in APP
    assert 'data-market-cash-slider' in APP
    assert 'step="0.000001"' in APP
    assert 'marketCalculatedQuantity' in APP


def test_trade_ticket_preserves_existing_equity_order_contract():
    assert 'const body = {' in APP
    assert 'ticker: String(form.elements.ticker?.value || "")' in APP
    assert 'side: String(form.elements.side?.value || "buy")' in APP
    assert 'quantity,' in APP
    assert 'body: JSON.stringify(body)' in APP


def test_open_ticket_pauses_market_refresh_while_user_is_editing():
    assert 'state.marketTradeTicketOpen || Date.now() < Number(state.marketChartInteractionUntil || 0) || document.hidden' in APP
    assert 'Ticket refresh paused while you edit' in APP


def test_trade_ticket_is_a_desktop_modal_and_mobile_bottom_sheet():
    assert '.market-trade-overlay' in CSS
    assert '.market-trade-sheet' in CSS
    assert '@media(max-width:720px)' in CSS
    assert 'place-items:end center' in CSS
