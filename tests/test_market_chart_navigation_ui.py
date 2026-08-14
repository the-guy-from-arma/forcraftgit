from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
CSS = (ROOT / "static" / "styles.css").read_text(encoding="utf-8")


def test_ravenhood_chart_has_zoom_pan_and_history_controls():
    assert 'data-market-chart-zoom' in APP
    assert 'data-market-chart-pan' in APP
    assert 'data-market-chart-reset' in APP
    assert 'data-market-chart-earlier' in APP
    assert 'data-market-chart-later' in APP
    assert 'Scroll to zoom · drag to move through time' in APP


def test_ravenhood_chart_reprojects_recorded_ohlc_and_volume():
    assert 'const renderChartViewport = () =>' in APP
    assert 'market-v19-volume-bar' in APP
    assert 'point.open, point.high, point.low, point.price' in APP
    assert 'data-market-forecast' in APP
    assert '.market-v19-volume-bar' in CSS


def test_chart_navigation_supports_wheel_drag_keyboard_and_mobile():
    assert 'addEventListener("wheel"' in APP
    assert 'setPointerCapture?.' in APP
    assert 'interactivePriceChart.classList.add("is-panning")' in APP
    assert 'event.key === "Home"' in APP
    assert 'touch-action:pan-y' in CSS


def test_chart_interaction_temporarily_pauses_live_refresh():
    assert 'state.marketChartInteractionUntil = Date.now() + 2200' in APP
    assert 'Date.now() < Number(state.marketChartInteractionUntil || 0)' in APP
