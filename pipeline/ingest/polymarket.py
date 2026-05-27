"""
Polymarket public APIs — Gamma (markets/events) + CLOB (price history).

No auth needed for read. Markets carry `clobTokenIds` (one per outcome);
price history is queried per token.

Usage:
    from pipeline.ingest.polymarket import search_markets, get_market, prices_history
    markets = search_markets(query="Massie")
    history = prices_history(token_id, interval="1d")
"""
from __future__ import annotations

import json
from typing import Any

import requests

GAMMA = "https://gamma-api.polymarket.com"
CLOB = "https://clob.polymarket.com"
UA = {"User-Agent": "predictable-pipeline/1.0"}


def _get(base: str, path: str, params: dict | None = None) -> Any:
    r = requests.get(f"{base}{path}", params=params or {}, headers=UA, timeout=15)
    r.raise_for_status()
    return r.json()


def search_markets(
    *,
    query: str | None = None,
    active: bool = True,
    closed: bool | None = None,
    limit: int = 50,
) -> list[dict]:
    """Browse markets. Filters: active, closed, free-text query."""
    params: dict = {"limit": limit, "active": str(active).lower()}
    if closed is not None:
        params["closed"] = str(closed).lower()
    if query:
        params["q"] = query
    data = _get(GAMMA, "/markets", params)
    return data if isinstance(data, list) else (data.get("markets") or [])


def get_market_by_slug(slug: str) -> dict | None:
    """Look up a market by its slug. The Gamma /markets endpoint silently
    hides closed/inactive markets by default, so if the first query is empty
    we retry with `closed=true` to catch resolved ones. (Pre-fix, resolved
    markets like the Paxton primary or Cooper Flagg ROY returned None from
    here, which broke historical price backfill.)"""
    data = _get(GAMMA, "/markets", {"slug": slug, "limit": 1})
    items = data if isinstance(data, list) else (data.get("markets") or [])
    if items:
        return items[0]
    data = _get(GAMMA, "/markets", {"slug": slug, "closed": "true", "limit": 1})
    items = data if isinstance(data, list) else (data.get("markets") or [])
    return items[0] if items else None


def get_event(slug: str) -> dict | None:
    data = _get(GAMMA, "/events", {"slug": slug, "limit": 1})
    items = data if isinstance(data, list) else (data.get("events") or [])
    return items[0] if items else None


def token_ids_for_market(market: dict) -> list[str]:
    """Markets store CLOB token ids as a JSON string in `clobTokenIds`."""
    raw = market.get("clobTokenIds") or "[]"
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return []
    return list(raw)


def prices_history(token_id: str, *, interval: str = "1d") -> list[dict]:
    """Daily/hourly price history for one CLOB token. Returns [{t: unix_sec, p: 0..1}]."""
    data = _get(CLOB, "/prices-history", {"market": token_id, "interval": interval})
    return data.get("history") if isinstance(data, dict) else (data or [])


if __name__ == "__main__":
    ms = search_markets(limit=3)
    print(f"Got {len(ms)} markets")
    for m in ms[:3]:
        print(f"  {(m.get('slug') or '')[:40]:40}  ${m.get('volume24hr',0):>10.0f}/24h  {m.get('question','')[:50]}")
