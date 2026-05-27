"""
PredictIt — tertiary cross-reference source. Single public endpoint dumps every active market.

Usage:
    from pipeline.ingest.predictit import all_markets, find_market
    ms = all_markets()
    m = find_market("massie")
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import requests

from pipeline.paths import ingest_dir

URL = "https://www.predictit.org/api/marketdata/all/"
UA = {"User-Agent": "predictable-pipeline/1.0"}


def all_markets() -> list[dict]:
    r = requests.get(URL, headers=UA, timeout=20)
    r.raise_for_status()
    data = r.json()
    return data.get("markets") if isinstance(data, dict) else (data or [])


def find_market(query: str) -> list[dict]:
    """Case-insensitive substring match across market names + short names."""
    q = query.lower()
    return [
        m
        for m in all_markets()
        if q in (m.get("name") or "").lower() or q in (m.get("shortName") or "").lower()
    ]


def write_snapshot(markets: list[dict]) -> str:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    out = ingest_dir("predictit") / f"{today}.json"
    out.write_text(json.dumps(markets, indent=2), encoding="utf-8")
    return str(out)


if __name__ == "__main__":
    ms = all_markets()
    print(f"PredictIt: {len(ms)} markets")
    for m in ms[:3]:
        print(f"  #{m.get('id')}  {m.get('shortName','')[:60]}")
