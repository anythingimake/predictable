"""
Fast price poll — current price for every market that has an open call.

Runs every ~2 minutes via cron. Cheap by design:
  - Skip resolved markets entirely (the price is locked at 0 or 100)
  - Skip markets that no open call points at (resolved-only markets aren't interesting to refresh)
  - One HTTP call per market: Polymarket gamma /markets?slug= or Kalshi /markets/{ticker}
  - Inserts ONE snapshot row per market per run (idempotent on the (market_id, snapshot_date) PK)
  - Updates markets.current_price for the home page Calendar/scoreboard sidebars

No LLM, no extraction, no git, no pm2 restart. Just refresh prices and exit.
The main 30-minute refresh.sh still handles git pull + load + scoring + restart.
"""
from __future__ import annotations

import json
import time
from datetime import date, datetime, timezone

import requests

from pipeline.db import connect

UA = {"User-Agent": "predictable-pipeline/1.0"}


def _polymarket_price(slug: str) -> float | None:
    try:
        r = requests.get(
            "https://gamma-api.polymarket.com/markets",
            params={"slug": slug, "limit": 1},
            headers=UA,
            timeout=8,
        )
        if not r.ok:
            return None
        data = r.json()
        items = data if isinstance(data, list) else (data.get("markets") or [])
        if not items:
            return None
        prices = items[0].get("outcomePrices") or "[]"
        if isinstance(prices, str):
            prices = json.loads(prices)
        return float(prices[0]) if prices else None
    except (requests.RequestException, ValueError, KeyError):
        return None


def _kalshi_price(ticker: str) -> float | None:
    try:
        r = requests.get(
            f"https://api.elections.kalshi.com/trade-api/v2/markets/{ticker}",
            headers=UA,
            timeout=8,
        )
        if not r.ok:
            return None
        m = r.json().get("market") or {}
        last = m.get("last_price_dollars") or m.get("yes_ask_dollars")
        return float(last) if last is not None else None
    except (requests.RequestException, ValueError, KeyError):
        return None


def poll_prices() -> dict:
    """One row per refreshed market into market_price_snapshots; bump current_price."""
    today = date.today().isoformat()
    started = datetime.now(timezone.utc)
    stats = {"polled": 0, "updated": 0, "errors": 0, "duration_sec": 0}

    with connect() as conn:
        # Markets with at least one currently-open call. Skip resolved ones.
        rows = conn.execute(
            """SELECT DISTINCT m.id, m.source, m.ticker
                 FROM markets m
                 JOIN calls c ON c.market_id = m.id
                WHERE COALESCE(m.resolved, 0) = 0
                  AND c.status = 'open'"""
        ).fetchall()

        for r in rows:
            stats["polled"] += 1
            price: float | None = None
            if r["source"] == "polymarket":
                price = _polymarket_price(r["ticker"])
            elif r["source"] == "kalshi":
                price = _kalshi_price(r["ticker"])

            if price is None:
                stats["errors"] += 1
                continue

            conn.execute(
                """INSERT INTO market_price_snapshots (market_id, snapshot_date, price, volume)
                   VALUES (?, ?, ?, NULL)
                   ON CONFLICT(market_id, snapshot_date) DO UPDATE SET price = excluded.price""",
                (r["id"], today, price),
            )
            conn.execute(
                "UPDATE markets SET current_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (price, r["id"]),
            )
            stats["updated"] += 1
            # Trivial rate-limit so we don't hammer either API
            time.sleep(0.05)

    stats["duration_sec"] = round((datetime.now(timezone.utc) - started).total_seconds(), 2)
    return stats


if __name__ == "__main__":
    print(json.dumps(poll_prices(), indent=2))
