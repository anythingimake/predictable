"""
Score resolved + soft-resolved calls and refresh the scoreboard snapshot.

Two paths to a realized_pct:

  HARD-RESOLVE — market.resolved=1 and market.resolution in {'yes','no'}.
    The contract has settled; compute the realized return from the call's
    entry-event price_pct against a payout of 100¢ (win) or 0¢ (loss).

  SOFT-RESOLVE — call has its own 'exit', 'trim', or 'resolve' event with
    a price_pct, meaning Stu noted his close on the show. Use that close as
    the effective price. Status becomes 'closed' (vs 'resolved' for hard).

Price math: every event's `price_pct` is the cents-per-contract Stu actually
paid (or sold for) on whichever side he took. The extraction stores the
quoted price verbatim — "bought NO at 44¢" → price_pct=44 on a NO-side
event, NOT the YES-side equivalent (56¢). So return is a simple
  (close - entry) / entry * 100
regardless of side. For hard-resolve, "close" is 100 if Stu's side won the
settlement (resolution matches his side) and 0 if he lost.

Idempotent. Re-running recomputes fresh values.
"""
from __future__ import annotations

import json
from datetime import date
from typing import Optional


def _entry_price_cents(conn, call_id: int) -> Optional[float]:
    row = conn.execute(
        """SELECT price_pct FROM call_events
            WHERE call_id = ? AND event_type = 'entry'
            ORDER BY timestamp_sec ASC, id ASC
            LIMIT 1""",
        (call_id,),
    ).fetchone()
    if not row or row["price_pct"] is None:
        return None
    try:
        return float(row["price_pct"])
    except (TypeError, ValueError):
        return None


def _close_event(conn, call_id: int) -> Optional[tuple[float, str]]:
    """Latest exit/resolve event with a price_pct. `trim` is intentionally
    excluded — a trim is a partial close and shouldn't flip status to closed.

    The event_type matters because the extraction stores `resolve` events with
    YES-side prices (binary settlement framed on the YES axis) while `exit`
    events store the price Stu actually said on his own side."""
    row = conn.execute(
        """SELECT price_pct, event_type FROM call_events
            WHERE call_id = ?
              AND event_type IN ('exit', 'resolve')
              AND price_pct IS NOT NULL
            ORDER BY timestamp_sec DESC, id DESC
            LIMIT 1""",
        (call_id,),
    ).fetchone()
    if not row:
        return None
    try:
        return float(row["price_pct"]), row["event_type"]
    except (TypeError, ValueError):
        return None


def _close_cents_for_event(side: str, event_type: str, price_cents: float) -> float:
    """Normalize a close event's price into Stu's-side cents.

    `exit`/`trim`: Stu said "I sold at X" — already on his side.
    `resolve`: extractor stores the YES-side settlement (0 = YES lost, 100 = YES won).
       For a NO position, flip to Stu's side."""
    if event_type == "resolve":
        s = (side or "").strip().lower()
        if s in ("no", "under"):
            return 100.0 - price_cents
    return price_cents


def _realized_pct(side: str, entry_cents: float, close_cents: float) -> float:
    """Stu paid `entry_cents` per contract on his side and closed at
    `close_cents`. Side is informational — the price is already on the
    contract he actually held."""
    _ = side  # accepted for future per-side adjustments (fees, etc.)
    if entry_cents <= 0:
        return 0.0
    return (close_cents - entry_cents) / entry_cents * 100.0


def _hard_close_cents(side: str, resolution: str) -> float:
    """Final per-contract payout on hard-resolve: 100 if Stu's side won, 0 if lost."""
    s = (side or "").strip().lower()
    r = (resolution or "").strip().lower()
    won = (r == "yes" and s in ("yes", "over")) or (r == "no" and s in ("no", "under"))
    return 100.0 if won else 0.0


def _score_calls(conn) -> dict:
    """Walk every call and assign realized_pct.

    Precedence (Stu's own words beat the market data):
      1. SOFT — Stu's `exit`/`resolve` event with a price. This is what he
         actually did/saw; his realized return. Highest authority.
      2. HARD — the market settled with a clean `resolution` in (yes, no).
         Only trust an explicit yes/no, never a guess from current_price:
         a price of "1.0" is ambiguously dollars-or-cents and flipped known
         wins (Vrabel, Cooper Flagg) into fake -100% losses.
      3. Otherwise leave the call OPEN — an honest "not yet scorable" beats a
         fabricated win or loss.
    Idempotent — recomputes on every run."""
    stats = {"hard": 0, "soft": 0, "skipped_no_entry": 0, "skipped_other": 0}
    # Reset first so a call that no longer scores (e.g. a market that stopped
    # reporting a clean yes/no) drops back to open instead of keeping a stale
    # realized_pct from a prior run. Scoring is the sole authority on
    # status/realized_pct; market_id (the link) is owned by the resolver.
    conn.execute("UPDATE calls SET status = 'open', realized_pct = NULL")
    calls = conn.execute(
        """SELECT c.id, c.side, c.market_id, m.resolved, m.resolution
             FROM calls c
        LEFT JOIN markets m ON m.id = c.market_id"""
    ).fetchall()
    for c in calls:
        cid = c["id"]
        entry_cents = _entry_price_cents(conn, cid)
        if entry_cents is None or entry_cents <= 0:
            stats["skipped_no_entry"] += 1
            continue

        # SOFT first: Stu noted an exit/resolve himself. `trim` is intentionally
        # excluded — it's a partial close, not a status change.
        close = _close_event(conn, cid)
        if close is not None:
            close_cents, event_type = close
            close_cents = _close_cents_for_event(c["side"], event_type, close_cents)
            realized = _realized_pct(c["side"], entry_cents, close_cents)
            conn.execute(
                "UPDATE calls SET status = 'closed', realized_pct = ? WHERE id = ?",
                (realized, cid),
            )
            stats["soft"] += 1
            continue

        # HARD: market settled with a clean yes/no winner (the literal
        # "resolved" string Polymarket sometimes stores is NOT trustworthy).
        if c["resolved"] == 1 and (c["resolution"] or "").strip().lower() in ("yes", "no"):
            close_cents = _hard_close_cents(c["side"], c["resolution"])
            realized = _realized_pct(c["side"], entry_cents, close_cents)
            conn.execute(
                "UPDATE calls SET status = 'resolved', realized_pct = ? WHERE id = ?",
                (realized, cid),
            )
            stats["hard"] += 1
            continue

        stats["skipped_other"] += 1
    return stats


def _snapshot_scoreboard(conn) -> dict:
    """Both 'resolved' (hard) and 'closed' (soft) count toward the scoreboard.
    Totals are restricted to ACTIONABLE tiers (play/solid/flyer) to match the
    live /api/scoreboard endpoint — opinion/watch/pass are commentary, not bets."""
    totals = conn.execute(
        """SELECT
              COUNT(*) AS total,
              SUM(CASE WHEN status IN ('resolved','closed') THEN 1 ELSE 0 END) AS resolved,
              SUM(CASE WHEN status IN ('resolved','closed') AND realized_pct > 0 THEN 1 ELSE 0 END) AS hits
             FROM calls
            WHERE conviction IN ('play','solid','flyer')"""
    ).fetchone()
    total = totals["total"] or 0
    resolved = totals["resolved"] or 0
    hits = totals["hits"] or 0
    hit_rate = (hits / resolved) if resolved else 0.0

    by_tier: dict[str, dict] = {}
    for row in conn.execute(
        """SELECT conviction, COUNT(*) AS total,
                  SUM(CASE WHEN status IN ('resolved','closed') THEN 1 ELSE 0 END) AS resolved,
                  SUM(CASE WHEN status IN ('resolved','closed') AND realized_pct>0 THEN 1 ELSE 0 END) AS hits,
                  AVG(CASE WHEN status IN ('resolved','closed') THEN realized_pct END) AS avg_return_pct
             FROM calls GROUP BY conviction"""
    ):
        by_tier[row["conviction"] or "unknown"] = {
            "total": row["total"],
            "resolved": row["resolved"],
            "hits": row["hits"],
            "hit_rate": (row["hits"] / row["resolved"]) if row["resolved"] else 0.0,
            "avg_return_pct": row["avg_return_pct"],
        }

    by_category: dict[str, dict] = {}
    for row in conn.execute(
        """SELECT m.category AS category, COUNT(*) AS total,
                  SUM(CASE WHEN c.status IN ('resolved','closed') THEN 1 ELSE 0 END) AS resolved,
                  SUM(CASE WHEN c.status IN ('resolved','closed') AND c.realized_pct>0 THEN 1 ELSE 0 END) AS hits
             FROM calls c
        LEFT JOIN markets m ON m.id = c.market_id
            GROUP BY m.category"""
    ):
        by_category[row["category"] or "uncategorized"] = {
            "total": row["total"],
            "resolved": row["resolved"],
            "hits": row["hits"],
            "hit_rate": (row["hits"] / row["resolved"]) if row["resolved"] else 0.0,
        }

    today = date.today().isoformat()
    conn.execute(
        """INSERT INTO scoreboard_snapshots
              (snapshot_date, total_calls, resolved_calls, hit_count, hit_rate,
               bankroll_pct, by_tier_json, by_category_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(snapshot_date) DO UPDATE SET
              total_calls = excluded.total_calls,
              resolved_calls = excluded.resolved_calls,
              hit_count = excluded.hit_count,
              hit_rate = excluded.hit_rate,
              bankroll_pct = excluded.bankroll_pct,
              by_tier_json = excluded.by_tier_json,
              by_category_json = excluded.by_category_json""",
        (
            today,
            total,
            resolved,
            hits,
            hit_rate,
            None,
            json.dumps(by_tier),
            json.dumps(by_category),
        ),
    )
    return {
        "snapshot_date": today,
        "total_calls": total,
        "resolved_calls": resolved,
        "hit_count": hits,
        "hit_rate": hit_rate,
    }


def score_all() -> dict:
    from pipeline.db import connect
    with connect() as conn:
        stats = _score_calls(conn)
        snap = _snapshot_scoreboard(conn)
    return {"scoring": stats, "scoreboard": snap}


if __name__ == "__main__":
    print(json.dumps(score_all(), indent=2))
