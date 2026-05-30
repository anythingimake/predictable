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


def _event_of_types(conn, call_id: int, types: tuple[str, ...]) -> Optional[tuple[float, str]]:
    """Latest event of the given types with a price_pct → (price, event_type)."""
    placeholders = ", ".join("?" for _ in types)
    row = conn.execute(
        f"""SELECT price_pct, event_type FROM call_events
            WHERE call_id = ?
              AND event_type IN ({placeholders})
              AND price_pct IS NOT NULL
            ORDER BY timestamp_sec DESC, id DESC
            LIMIT 1""",
        (call_id, *types),
    ).fetchone()
    if not row:
        return None
    try:
        return float(row["price_pct"]), row["event_type"]
    except (TypeError, ValueError):
        return None


def _infer_winner(current_price: float | None) -> str | None:
    """Infer a settled market's winner from current_price. Only valid for
    markets already marked resolved — the price has snapped to its terminal
    value (~0 or ~100). Normalize units first (some rows are dollars 0..1,
    some cents 0..100) THEN threshold at 50. Reading 1.0 as 1¢ instead of
    $1.00 was the bug that flipped Vrabel/Cooper Flagg into fake losses."""
    if current_price is None:
        return None
    cents = current_price * 100.0 if current_price <= 1.5 else current_price
    return "yes" if cents >= 50.0 else "no"


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
    """Walk every call and assign status / realized_pct / won.

    Two separate questions:
      • OUTCOME (won 1/0): did Stu's side win? Determinable from a settled market
        or a `resolve` event WITHOUT knowing his entry price.
      • RETURN (realized_pct): his % gain/loss. Needs the entry price — left NULL
        when he never stated one. The scoreboard rates by realized_pct, so a
        no-entry-price call counts as resolved-and-won/lost on its card but does
        NOT move the headline hit-rate.

    Precedence (Stu's own words beat the market data):
      1. SOFT exit — Stu's own `exit` price. Needs an entry price (profit depends
         on what he paid), so it's skipped without one.
      2. HARD — the market settled (explicit yes/no resolution, else inferred from
         the settled current_price). Outcome needs no entry price.
      3. RESOLVE event — Stu narrated the settlement. Outcome needs no entry price.
      4. EFFECTIVE — researched outcome, or a passed date + terminal price.
      Otherwise leave the call OPEN. Never guess a winner from a live mid-price.
    Idempotent — recomputes on every run."""
    stats = {"hard": 0, "soft": 0, "effective": 0, "skipped_no_entry": 0, "skipped_other": 0}
    # Reset first so a call that no longer scores (e.g. a market that stopped
    # reporting a clean yes/no) drops back to open instead of keeping a stale
    # realized_pct/won from a prior run. Scoring is the sole authority on
    # status/realized_pct/won; market_id (the link) is owned by the resolver.
    conn.execute("UPDATE calls SET status = 'open', realized_pct = NULL, won = NULL")
    # Defensive: scoring may run against a DB created before the effective_*
    # columns existed (load.py self-migrates, but scoring can run standalone).
    have_eff = "effective_resolution" in {
        r["name"] for r in conn.execute("PRAGMA table_info(markets)")
    }
    eff_select = "m.effective_resolution" if have_eff else "NULL AS effective_resolution"
    calls = conn.execute(
        f"""SELECT c.id, c.side, c.market_id, m.resolved, m.resolution,
                  m.current_price, m.resolution_date, {eff_select}
             FROM calls c
        LEFT JOIN markets m ON m.id = c.market_id"""
    ).fetchall()
    today_iso = date.today().isoformat()
    for c in calls:
        cid = c["id"]
        side = c["side"]
        entry_cents = _entry_price_cents(conn, cid)
        have_entry = entry_cents is not None and entry_cents > 0
        # Return % needs the entry price; the win/loss OUTCOME does not. When Stu
        # never stated an entry, realized stays NULL but `won` is still set from
        # the settlement so the call shows resolved (Won/Lost), not open.
        def _ret(close_cents: float) -> float | None:
            return _realized_pct(side, entry_cents, close_cents) if have_entry else None

        # 1. Stu fully exited it himself — his actual realized return wins. Needs
        #    an entry price (profit depends on what he paid). `trim` is excluded:
        #    a partial trim doesn't close the position (e.g. Dems-House).
        if have_entry:
            ev = _event_of_types(conn, cid, ("exit",))
            if ev is not None:
                close_cents, et = ev
                close_cents = _close_cents_for_event(side, et, close_cents)
                realized = _realized_pct(side, entry_cents, close_cents)
                conn.execute(
                    "UPDATE calls SET status = 'closed', realized_pct = ?, won = ? WHERE id = ?",
                    (realized, 1 if realized > 0 else 0, cid),
                )
                stats["soft"] += 1
                continue

        # 2. Market settled. Trust an explicit yes/no resolution; otherwise infer
        #    the winner from the (settled) current_price with unit-normalization.
        #    Outcome stands without an entry price.
        if c["resolved"] == 1:
            res = (c["resolution"] or "").strip().lower()
            if res not in ("yes", "no"):
                res = _infer_winner(c["current_price"])
            if res in ("yes", "no"):
                close_cents = _hard_close_cents(side, res)
                conn.execute(
                    "UPDATE calls SET status = 'resolved', realized_pct = ?, won = ? WHERE id = ?",
                    (_ret(close_cents), 1 if close_cents >= 50 else 0, cid),
                )
                stats["hard"] += 1
                continue

        # 3. Stu narrated the resolution (a `resolve` event) without a market link.
        #    Outcome from the event; no entry price required.
        ev = _event_of_types(conn, cid, ("resolve",))
        if ev is not None:
            close_cents, et = ev
            close_cents = _close_cents_for_event(side, et, close_cents)
            conn.execute(
                "UPDATE calls SET status = 'closed', realized_pct = ?, won = ? WHERE id = ?",
                (_ret(close_cents), 1 if close_cents >= 50 else 0, cid),
            )
            stats["soft"] += 1
            continue

        # 3.5 RESEARCHED resolution — a cited, web-verified real-world outcome
        #     (pipeline.enrich.resolve_events -> markets.effective_*, loaded from
        #     data/ingest/resolutions/). Higher authority than the price
        #     heuristic below: it's a sourced fact (incl. the exact margin for
        #     bracket markets), not a price inference. Still recorded 'closed'
        #     (effective), never 'resolved' — that's reserved for an actual
        #     exchange settlement.
        eff_res = (c["effective_resolution"] or "").strip().lower()
        if eff_res in ("yes", "no"):
            close_cents = _hard_close_cents(side, eff_res)
            conn.execute(
                "UPDATE calls SET status = 'closed', realized_pct = ?, won = ? WHERE id = ?",
                (_ret(close_cents), 1 if close_cents >= 50 else 0, cid),
            )
            stats["effective"] += 1
            continue

        # 4. EFFECTIVE resolution — the exchange hasn't posted a settlement, but
        #    the event is clearly over and the market has snapped to a terminal
        #    price. Gate is deliberately strict on BOTH axes:
        #      - the resolution_date must be in the PAST (the real-world event
        #        has happened — this is what makes it safe), AND
        #      - current_price (YES-side cents) must be at a hard extreme:
        #        >= 99 (YES won) or <= 1 (NO won).
        #    Price alone is NOT enough: a still-OPEN longshot routinely sits at
        #    1-5c for weeks before news pops it, so a loose threshold would
        #    fabricate losses. 99/1 + a passed date is the conservative call.
        #    Recorded as 'closed' (an effective close), never 'resolved' — that
        #    status is reserved for an actual exchange settlement.
        rd = c["resolution_date"]
        cp = c["current_price"]
        if rd and rd < today_iso and cp is not None:
            eff = "yes" if cp >= 99.0 else ("no" if cp <= 1.0 else None)
            if eff is not None:
                close_cents = _hard_close_cents(side, eff)
                conn.execute(
                    "UPDATE calls SET status = 'closed', realized_pct = ?, won = ? WHERE id = ?",
                    (_ret(close_cents), 1 if close_cents >= 50 else 0, cid),
                )
                stats["effective"] += 1
                continue

        # Nothing scored it. A missing entry price is the usual reason an
        # otherwise-fine call stays open; count it separately for diagnostics.
        if not have_entry:
            stats["skipped_no_entry"] += 1
        else:
            stats["skipped_other"] += 1
    return stats


def _snapshot_scoreboard(conn) -> dict:
    """Both 'resolved' (hard) and 'closed' (soft) count toward the scoreboard,
    but only when they carry a computable return (realized_pct IS NOT NULL) — a
    settled call with no stated entry price is shown Won/Lost on its card yet is
    NOT rated, so it must not move the headline. Restricted to ACTIONABLE tiers
    (play/solid/flyer) to match the live /api/scoreboard endpoint."""
    totals = conn.execute(
        """SELECT
              COUNT(*) AS total,
              SUM(CASE WHEN status IN ('resolved','closed') AND realized_pct IS NOT NULL THEN 1 ELSE 0 END) AS resolved,
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
                  SUM(CASE WHEN status IN ('resolved','closed') AND realized_pct IS NOT NULL THEN 1 ELSE 0 END) AS resolved,
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
                  SUM(CASE WHEN c.status IN ('resolved','closed') AND c.realized_pct IS NOT NULL THEN 1 ELSE 0 END) AS resolved,
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


def _ensure_won_column(conn) -> None:
    """Defensive: scoring writes `calls.won`. load.py normally adds it first, but
    scoring can run standalone against an un-migrated DB — don't crash. Idempotent."""
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(calls)")}
    if "won" not in cols:
        conn.execute("ALTER TABLE calls ADD COLUMN won INTEGER")


def score_all() -> dict:
    from pipeline.db import connect
    with connect() as conn:
        _ensure_won_column(conn)
        stats = _score_calls(conn)
        snap = _snapshot_scoreboard(conn)
    return {"scoring": stats, "scoreboard": snap}


if __name__ == "__main__":
    print(json.dumps(score_all(), indent=2))
