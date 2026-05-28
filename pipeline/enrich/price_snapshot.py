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
        ) * 100.0  # dollars (0..1) -> cents (0..100)
        vol = float(market.get("volume_fp") or 0.0) or None
        record_price_snapshot(conn, market_id, _today_iso(), price, vol)
        written += 1
    except (TypeError, ValueError):
        pass

    # Backfill — Kalshi wants unix ts and 1h or 1d candles.
    # `since_iso` defaults to the call's episode publish_date, but for markets
    # like the Paxton runoff that were trading days before Stu mentioned them,
    # the right lookback floor is the market's `open_time`. Fall back to a
    # 30-day rolling window if neither is available.
    floor_iso = since_iso
    open_time = market.get("open_time") or market.get("expected_expiration_time")
    if open_time:
        otime = open_time[:10]
        if not floor_iso or otime < floor_iso:
            floor_iso = otime
    if floor_iso:
        try:
            start = int(datetime.fromisoformat(f"{floor_iso}T00:00:00+00:00").timestamp())
            end = int(datetime.now(timezone.utc).timestamp())
            # Daily-ish: 1440 minutes. If the window is < 2 days, widen it
            # so we always pull *some* history when one's available.
            if end - start < 86400 * 2:
                start = end - 86400 * 30
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
            # Prefer yes_ask.close, then price.close, then price.mean.
            # Kalshi v2 candles return *both* `close` (cents int) and
            # `close_dollars` (string like "0.0700"). The bare `close` is
            # missing on some markets so we try the _dollars variant too.
            cprice = None
            for key in ("yes_ask", "price"):
                node = c.get(key) or {}
                if not isinstance(node, dict):
                    continue
                for field in ("close", "close_dollars", "mean", "mean_dollars",
                              "open", "open_dollars", "previous_dollars"):
                    if node.get(field) is not None:
                        cprice = node.get(field)
                        break
                if cprice is not None:
                    break
            if cprice is None:
                continue
            try:
                cprice = float(cprice)
                # Kalshi candle prices come as cents OR dollars depending on
                # which field we picked. The `_dollars` fields are 0..1
                # strings; the bare fields are 0..100 ints. Normalize to cents.
                if cprice <= 1.5:
                    cprice = cprice * 100.0
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
        cur_price = float(prices[0]) * 100.0 if prices else None  # dollars -> cents
        vol = market.get("volume24hr") or market.get("volume")
        vol = float(vol) if vol is not None else None
        if cur_price is not None:
            record_price_snapshot(conn, market_id, _today_iso(), cur_price, vol)
            written += 1
    except (TypeError, ValueError, json.JSONDecodeError):
        pass

    # Backfill via CLOB prices-history on the YES token. For markets that have
    # been closed for a while, `interval=1d` returns an empty series — the
    # CLOB only seems to keep the rolling 30/60-day window for fine intervals.
    # `interval=all` returns the full lifetime series for closed markets.
    token_ids = polymarket.token_ids_for_market(market)
    if not token_ids:
        return written
    yes_token = token_ids[0]
    try:
        hist = polymarket.prices_history(yes_token, interval="1d")
        if not hist:
            hist = polymarket.prices_history(yes_token, interval="all")
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
            record_price_snapshot(conn, market_id, day, float(p) * 100.0, None)  # dollars -> cents
            written += 1
        except (TypeError, ValueError):
            continue
    return written


# ----- Orchestration -----


def snapshot_all() -> dict:
    """Walk every market with at least one call (open OR resolved), snapshot + backfill.

    Two passes:
      1. Open/closed-call markets — current price + history from first event date.
         This is the original daily-cron behavior.
      2. Resolved-call markets that don't yet have any history rows — pull the
         full candlestick / prices-history series so the call detail page can
         render a real chart instead of the empty-state placeholder. (Pre-fix,
         the Paxton +20% chart was always empty because resolved markets were
         filtered out of the pass-1 loop.)
    """
    by_market = 0
    total_rows = 0
    skipped = 0

    with connect() as conn:
        # Pass 1: live markets — current price + recent history (idempotent
        # daily refresh).
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

        # Pass 2: resolved-call markets with no history yet. We only do this
        # once per market — the snapshots table has the data forever after.
        # Live-pass rows that already wrote today's snapshot are not in this
        # query because of the LEFT JOIN ... HAVING COUNT(snapshot_date)=0
        # guard, so there's no double-work.
        resolved_rows = list(
            conn.execute(
                """SELECT DISTINCT m.id AS market_id, m.source, m.ticker
                     FROM markets m
                     JOIN calls c ON c.market_id = m.id
                LEFT JOIN market_price_snapshots mps ON mps.market_id = m.id
                    WHERE c.status = 'resolved'
                 GROUP BY m.id, m.source, m.ticker
                   HAVING COUNT(mps.snapshot_date) = 0"""
            )
        )
        for r in resolved_rows:
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
                print(f"[price_snapshot] resolved-backfill error on {mid}: {e}")
                skipped += 1
                continue
            if n:
                by_market += 1
                total_rows += n
                print(f"[price_snapshot] resolved-backfill: {mid} -> {n} rows")

    return {"markets_snapshotted": by_market, "rows_written": total_rows, "skipped": skipped}


if __name__ == "__main__":
    print(snapshot_all())
