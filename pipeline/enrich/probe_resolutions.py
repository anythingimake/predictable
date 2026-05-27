"""
Probe each market's actual current resolution state from its source API.

market_resolver matched calls to markets, but the matcher only captured each
market's snapshot at match-time. Markets that have since resolved show as
resolved=0 in our DB. Probe the source and update.

Also: capture the winning outcome name so scoring can compute realized_pct
direction correctly (call.side YES + outcome YES = win; call.side NO + outcome
YES = loss).
"""
from __future__ import annotations

import json
import time

import requests

from pipeline.db import connect

UA = {"User-Agent": "predictable-pipeline/1.0"}


def _probe_polymarket(slug: str) -> dict | None:
    """Polymarket: GET /markets?slug=… returns the canonical record."""
    r = requests.get(
        "https://gamma-api.polymarket.com/markets",
        params={"slug": slug, "limit": 1},
        headers=UA,
        timeout=15,
    )
    if not r.ok:
        return None
    items = r.json() if isinstance(r.json(), list) else r.json().get("markets") or []
    return items[0] if items else None


def _probe_kalshi(ticker: str) -> dict | None:
    """Kalshi: try /markets/{ticker} then /historical/markets/{ticker}."""
    for path in (f"/markets/{ticker}", f"/historical/markets/{ticker}"):
        r = requests.get(
            f"https://api.elections.kalshi.com/trade-api/v2{path}",
            headers=UA,
            timeout=15,
        )
        if r.ok:
            d = r.json()
            return d.get("market") or d
    return None


def probe_all() -> dict:
    """Walk every market in the DB, refresh resolved + resolution + current_price."""
    updates = {"checked": 0, "resolved_new": 0, "price_updated": 0, "errors": []}
    with connect() as conn:
        rows = conn.execute(
            "SELECT id, source, ticker, question, resolved FROM markets"
        ).fetchall()
        for r in rows:
            updates["checked"] += 1
            try:
                if r["source"] == "polymarket":
                    m = _probe_polymarket(r["ticker"])
                    if not m:
                        continue
                    closed = bool(m.get("closed"))
                    # Polymarket resolution: parse outcomePrices to find winner
                    outcomes = m.get("outcomes") or "[]"
                    prices = m.get("outcomePrices") or "[]"
                    if isinstance(outcomes, str):
                        outcomes = json.loads(outcomes)
                    if isinstance(prices, str):
                        prices = json.loads(prices)
                    resolution = None
                    current = None
                    if outcomes and prices:
                        prices_f = [float(p) for p in prices]
                        current = prices_f[0]  # YES side
                        if closed:
                            # Winner: outcome with price closest to 1.0
                            win_idx = max(range(len(prices_f)), key=lambda i: prices_f[i])
                            winner = outcomes[win_idx].lower()
                            resolution = "yes" if winner in ("yes", "true") else (
                                "no" if winner in ("no", "false") else winner
                            )
                    prev_resolved = bool(r["resolved"])
                    new_resolved = 1 if closed else 0
                    conn.execute(
                        """UPDATE markets SET resolved = ?, resolution = ?,
                           current_price = ?, updated_at = CURRENT_TIMESTAMP
                           WHERE id = ?""",
                        (new_resolved, resolution, current, r["id"]),
                    )
                    if new_resolved and not prev_resolved:
                        updates["resolved_new"] += 1
                    if current is not None:
                        updates["price_updated"] += 1
                elif r["source"] == "kalshi":
                    m = _probe_kalshi(r["ticker"])
                    if not m:
                        continue
                    status = (m.get("status") or "").lower()
                    closed = status in ("settled", "closed", "finalized")
                    result = (m.get("result") or "").lower()
                    resolution = None
                    if closed and result in ("yes", "no"):
                        resolution = result
                    current = None
                    try:
                        ya = m.get("yes_ask_dollars")
                        if ya is not None:
                            current = float(ya)
                    except (TypeError, ValueError):
                        pass
                    prev_resolved = bool(r["resolved"])
                    new_resolved = 1 if closed else 0
                    conn.execute(
                        """UPDATE markets SET resolved = ?, resolution = ?,
                           current_price = ?, updated_at = CURRENT_TIMESTAMP
                           WHERE id = ?""",
                        (new_resolved, resolution, current, r["id"]),
                    )
                    if new_resolved and not prev_resolved:
                        updates["resolved_new"] += 1
                    if current is not None:
                        updates["price_updated"] += 1
                time.sleep(0.3)
            except requests.RequestException as e:
                updates["errors"].append(f"{r['id']}: {e}")
    return updates


if __name__ == "__main__":
    out = probe_all()
    print(json.dumps(out, indent=2))
