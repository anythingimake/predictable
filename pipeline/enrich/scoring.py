"""
Score resolved calls + snapshot the public scoreboard.

For each call where `status != 'resolved'`:
  - If the linked market.resolved == 1, compute the realized return:
      hit  -> ((100 - entry_price_cents) / entry_price_cents) * 100
      miss -> -100 (full loss of the binary position)
  - Update calls.status = 'resolved', calls.realized_pct = <computed>.

Then write today's scoreboard_snapshots row with totals + per-tier + per-category
breakdowns. ON CONFLICT updates so re-running on the same day is safe.

`hit` is determined by whether the market's `resolution` matches `calls.side`:
  - For "yes"/"no": exact string match (case-insensitive).
  - For "over"/"under": same.
  - If `resolution` is unset but `resolved` is true, we conservatively skip the
    call (don't score it) and leave it open for the next run.
"""
from __future__ import annotations

import json
from datetime import date
from typing import Optional


def _entry_price_cents(conn, call_id: int) -> Optional[float]:
    """First call_events row with event_type='entry' for this call. price_pct
    is stored in cents (0-100). Returns None if no entry row found OR price_pct
    is missing — caller MUST skip scoring in that case."""
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


def _side_hits(side: str, resolution: str | None) -> Optional[bool]:
    """Return True if the call's side won, False if it lost, None if unknown."""
    if not resolution:
        return None
    s = (side or "").strip().lower()
    r = (resolution or "").strip().lower()
    if not s or not r:
        return None
    # Common resolution encodings: "yes"/"no", "Yes"/"No", "YES"/"NO", "1"/"0"
    truthy = {"yes", "1", "true", "won", "over"}
    falsy = {"no", "0", "false", "lost", "under"}
    if s in {"yes", "over"}:
        if r in truthy: return True
        if r in falsy: return False
    if s in {"no", "under"}:
        if r in falsy: return True
        if r in truthy: return False
    # If the resolution string literally matches the side
    if r == s:
        return True
    return None


def _score_calls(conn) -> int:
    """Iterate unscored calls whose market is resolved, write realized_pct.
    Returns # of calls newly scored."""
    rows = list(
        conn.execute(
            """SELECT c.id, c.side, m.resolution
                 FROM calls c
                 JOIN markets m ON m.id = c.market_id
                WHERE c.status != 'resolved'
                  AND m.resolved = 1"""
        )
    )
    scored = 0
    for r in rows:
        cid, side, resolution = r["id"], r["side"], r["resolution"]
        entry_cents = _entry_price_cents(conn, cid)
        if entry_cents is None or entry_cents <= 0:
            # No entry-price data — leave open; nothing to score against.
            continue
        hit = _side_hits(side, resolution)
        if hit is None:
            # Resolved but unclear which side won — leave for next run.
            continue
        if hit:
            realized = ((100.0 - entry_cents) / entry_cents) * 100.0
        else:
            realized = -100.0
        conn.execute(
            "UPDATE calls SET status = 'resolved', realized_pct = ? WHERE id = ?",
            (realized, cid),
        )
        scored += 1
    return scored


def _snapshot_scoreboard(conn) -> dict:
    """Compute today's totals + breakdowns, upsert into scoreboard_snapshots."""
    totals = conn.execute(
        """SELECT
              COUNT(*) AS total,
              SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
              SUM(CASE WHEN status = 'resolved' AND realized_pct > 0 THEN 1 ELSE 0 END) AS hits
             FROM calls"""
    ).fetchone()
    total = totals["total"] or 0
    resolved = totals["resolved"] or 0
    hits = totals["hits"] or 0
    hit_rate = (hits / resolved) if resolved else 0.0

    by_tier: dict[str, dict] = {}
    for row in conn.execute(
        """SELECT conviction, COUNT(*) AS total,
                  SUM(CASE WHEN status='resolved' THEN 1 ELSE 0 END) AS resolved,
                  SUM(CASE WHEN status='resolved' AND realized_pct>0 THEN 1 ELSE 0 END) AS hits
             FROM calls GROUP BY conviction"""
    ):
        by_tier[row["conviction"] or "unknown"] = {
            "total": row["total"],
            "resolved": row["resolved"],
            "hits": row["hits"],
            "hit_rate": (row["hits"] / row["resolved"]) if row["resolved"] else 0.0,
        }

    by_category: dict[str, dict] = {}
    for row in conn.execute(
        """SELECT m.category AS category, COUNT(*) AS total,
                  SUM(CASE WHEN c.status='resolved' THEN 1 ELSE 0 END) AS resolved,
                  SUM(CASE WHEN c.status='resolved' AND c.realized_pct>0 THEN 1 ELSE 0 END) AS hits
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
            None,  # bankroll_pct — not yet computed in v1
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
    from pipeline.db import connect  # local import keeps module light
    with connect() as conn:
        scored = _score_calls(conn)
        snap = _snapshot_scoreboard(conn)
    return {"newly_scored": scored, "scoreboard": snap}


if __name__ == "__main__":
    print(score_all())
