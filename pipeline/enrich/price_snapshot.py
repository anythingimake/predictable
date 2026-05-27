"""
Snapshot current + historical prices for every market that has at least one
non-resolved call attached.

For each market_id with an open call:
  - Pull the current price from the source API and write today's snapshot.
  - Backfill daily history from the call's first_event date to today.
  - Skip days already present (record_price_snapshot does ON CONFLICT update,
    but we still avoid re-pulling intervals when possible).

Designed to be a daily cron step — re-running on the same day just updates the
"today" row with the latest price.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timezone
from typing import Iterable

import requests

from pipeline.db import connect, record_price_snapshot
from pipeline.ingest import kalshi, polymarket


# ----- helpers -----


def _today_iso() -> str:
    return date.today().isoformat()


def _ts_to_iso(ts: int) -> str:
    return datetime.fromtimestamp(int(ts), tz=timezone.utc).date().isoformat()


def _earliest_event_date(conn, market_id: str) -> str | None:
    """Earliest call_events.timestamp_sec for the calls linked to this market.
    Falls back to the calls.first_event_ts column, then None."""
    row = conn.execute(
        """SELECT MIN(ce.timestamp_sec) AS first_ev,
                  MIN(c.first_event_ts) AS first_call,
                  MIN(e.publish_date) AS first_pub
             FROM calls c
        LEFT JOIN call_events ce ON ce.call_id = c.id
             JOIN episodes e ON e.id = c.episode_id
            WHERE c.market_id = ?""",
        (market_id,),
    ).fetchone()
    if not row:
        return None
    # call_events.timestamp_sec is seconds-into-episode, NOT a wall clock; use
    # episode publish_date as the floor.
    return row["first_pub"]


# ----- Kalshi -----


def _snapshot_kalshi(conn, market_id: str, ticker: str, since_iso: str | None) -> int:
    """Pull current price + daily history; returns number of rows written."""
    written = 0
    market = kalshi.get_market(ticker)
    if not market:
        return 0

    # Current price -> today's row
    try:
        price = float(
            market.get("yes_ask_dollars")
            or market.get("last_price_dollars")
            or 0.0
        )
        vol = float(market.get("volume_fp") or 0.0) or None
        record_price_snapshot(conn, market_id, _today_iso(), price, vol)
        written += 1
    except (TypeError, ValueError):
        pass

    # Backfill — Kalshi wants unix ts and 1h or 1d candles
    if since_iso:
        try:
            start = int(datetime.fromisoformat(f"{since_iso}T00:00:00+00:00").timestamp())
            end = int(datetime.now(timezone.utc).timestamp())
            # Daily-ish: 1440 minutes
            candles = kalshi.get_candlesticks(ticker, start, end, interval_min=1440)
        except (requests.RequestException, ValueError):
            candles = []
        seen_days: set[str] = set()
        for c in candles:
            # Kalshi candles: {end_period_ts, price (mid/last), volume, yes_bid, yes_ask}
            ts = c.get("end_period_ts") or c.get("start_period_ts")
            if not ts:
                continue
            day = _ts_to_iso(ts)
            if day in seen_days:
                continue
            seen_days.add(day)
            # Prefer yes_ask.close, then price.close, then price.mean
            cprice = None
            for key in ("yes_ask", "price"):
                node = c.get(key) or {}
                if isinstance(node, dict):
                    cprice = node.get("close") or node.get("mean") or node.get("open")
                    if cprice is not None:
                        break
            if cprice is None:
                continue
            try:
                cprice = float(cprice)
                # Kalshi candle prices are in cents (0–100), normalize to dollars (0–1)
                if cprice > 1.5:
                    cprice = cprice / 100.0
                vol = c.get("volume")
                vol = float(vol) if vol is not None else None
                record_price_snapshot(conn, market_id, day, cprice, vol)
                written += 1
            except (TypeError, ValueError):
                continue
    return written


# ----- Polymarket -----


def _snapshot_polymarket(conn, market_id: str, slug_or_id: str, since_iso: str | None) -> int:
    """Pull current price + per-day history via CLOB; returns rows written."""
    written = 0
    market = polymarket.get_market_by_slug(slug_or_id)
    if not market:
        # The "ticker" may have been the condition id or numeric id, not a slug
        return 0

    # Current price
    try:
        prices = market.get("outcomePrices")
        if isinstance(prices, str):
            prices = json.loads(prices)
        cur_price = float(prices[0]) if prices else None
        vol = market.get("volume24hr") or market.get("volume")
        vol = float(vol) if vol is not None else None
        if cur_price is not None:
            record_price_snapshot(conn, market_id, _today_iso(), cur_price, vol)
            written += 1
    except (TypeError, ValueError, json.JSONDecodeError):
        pass

    # Backfill via CLOB prices-history on the YES token
    token_ids = polymarket.token_ids_for_market(market)
    if not token_ids:
        return written
    yes_token = token_ids[0]
    try:
        hist = polymarket.prices_history(yes_token, interval="1d")
    except requests.RequestException:
        hist = []
    seen_days: set[str] = set()
    for pt in hist or []:
        ts = pt.get("t")
        p = pt.get("p")
        if ts is None or p is None:
            continue
        day = _ts_to_iso(ts)
        if since_iso and day < since_iso:
            continue
        if day in seen_days:
            continue
        seen_days.add(day)
        try:
            record_price_snapshot(conn, market_id, day, float(p), None)
            written += 1
        except (TypeError, ValueError):
            continue
    return written


# ----- Orchestration -----


def snapshot_all() -> dict:
    """Walk every market with at least one open call, snapshot + backfill."""
    by_market = 0
    total_rows = 0
    skipped = 0

    with connect() as conn:
        rows = list(
            conn.execute(
                """SELECT DISTINCT m.id AS market_id, m.source, m.ticker
                     FROM markets m
                     JOIN calls c ON c.market_id = m.id
                    WHERE c.status != 'resolved'"""
            )
        )
        for r in rows:
            mid, source, ticker = r["market_id"], r["source"], r["ticker"]
            since = _earliest_event_date(conn, mid)
            try:
                if source == "kalshi":
                    n = _snapshot_kalshi(conn, mid, ticker, since)
                elif source == "polymarket":
                    n = _snapshot_polymarket(conn, mid, ticker, since)
                else:
                    skipped += 1
                    continue
            except Exception as e:  # noqa: BLE001 — keep cron alive
                print(f"[price_snapshot] error on {mid}: {e}")
                skipped += 1
                continue
            if n:
                by_market += 1
                total_rows += n

    return {"markets_snapshotted": by_market, "rows_written": total_rows, "skipped": skipped}


if __name__ == "__main__":
    print(snapshot_all())
