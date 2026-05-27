"""
Kalshi public market data — no auth needed for read endpoints.

Usage:
    from pipeline.ingest.kalshi import search_markets, get_market, get_candlesticks
    results = search_markets(series_ticker="KXMASSIE")
    market = get_market("KXMASSIE-26JUN23-T")
    candles = get_candlesticks("KXMASSIE-26JUN23-T", start_ts, end_ts)
"""
from __future__ import annotations

from typing import Iterable

import requests

BASE = "https://api.elections.kalshi.com/trade-api/v2"
UA = {"User-Agent": "predictable-pipeline/1.0"}


def _get(path: str, params: dict | None = None) -> dict:
    r = requests.get(f"{BASE}{path}", params=params or {}, headers=UA, timeout=15)
    r.raise_for_status()
    return r.json()


def search_markets(
    *,
    event_ticker: str | None = None,
    series_ticker: str | None = None,
    status: str = "open",
    limit: int = 100,
) -> list[dict]:
    """List markets matching a filter. Paginates through cursors."""
    out: list[dict] = []
    cursor = None
    while True:
        params: dict = {"limit": min(limit, 200), "status": status}
        if event_ticker:
            params["event_ticker"] = event_ticker
        if series_ticker:
            params["series_ticker"] = series_ticker
        if cursor:
            params["cursor"] = cursor
        data = _get("/markets", params)
        out.extend(data.get("markets") or [])
        cursor = data.get("cursor")
        if not cursor or len(out) >= limit:
            break
    return out[:limit]


def get_market(ticker: str) -> dict | None:
    """Single market by ticker. Falls back to /historical if not live."""
    try:
        data = _get(f"/markets/{ticker}")
        return data.get("market")
    except requests.HTTPError:
        try:
            data = _get(f"/historical/markets/{ticker}")
            return data.get("market")
        except requests.HTTPError:
            return None


def _series_from_ticker(ticker: str) -> str:
    """Kalshi market tickers are `{series_ticker}-{event_suffix}-{contract_suffix}`.
    The series ticker is everything up to the first hyphen separator. The
    canonical candlesticks endpoint is `/series/{series}/markets/{ticker}/...`."""
    return ticker.split("-", 1)[0]


def get_candlesticks(ticker: str, start_ts: int, end_ts: int, interval_min: int = 60) -> list[dict]:
    """Historical price candlesticks for a market between unix timestamps.

    Kalshi exposes candlesticks under
      /trade-api/v2/series/{series}/markets/{ticker}/candlesticks
    The shorter `/markets/{ticker}/candlesticks` path returns 404 for many
    tickers (e.g. all the KX-prefixed margin-of-victory contracts). We try
    the canonical series path first, then fall back to the bare path, then
    to the historical alias as a last resort.
    """
    series = _series_from_ticker(ticker)
    params = {"start_ts": start_ts, "end_ts": end_ts, "period_interval": interval_min}
    for path in (
        f"/series/{series}/markets/{ticker}/candlesticks",
        f"/markets/{ticker}/candlesticks",
        f"/historical/markets/{ticker}/candlesticks",
    ):
        try:
            data = _get(path, params)
        except requests.HTTPError:
            continue
        cs = data.get("candlesticks") or []
        if cs:
            return cs
    return []


def events(*, status: str = "open", limit: int = 50) -> list[dict]:
    data = _get("/events", {"limit": limit, "status": status})
    return data.get("events") or []


if __name__ == "__main__":
    ms = search_markets(status="open", limit=3)
    print(f"Got {len(ms)} open markets")
    for m in ms[:3]:
        print(f"  {m.get('ticker'):40}  {m.get('yes_ask_dollars'):>6}  {m.get('title','')[:50]}")
