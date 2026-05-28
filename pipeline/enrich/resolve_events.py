"""
Event-resolution worklist for the cloud routine.

The exchanges are often slow (or wrong) about formally settling the margin /
bracket markets Stu bets on: Polymarket parks a decided market at 99c with
closed=false; Kalshi leaves margin-of-victory markets 'active' with a bogus
+1-year close date. So a market's real-world event can be long over while the
exchange still reports it unresolved.

This module lists the markets whose calls still need a real-world resolution, so
the routine (which has web search) can research each ONCE, with a cited source,
and write data/ingest/resolutions/{market_id}.json. pipeline.load then folds
those into markets.effective_* and scoring credits the calls. A market is
"pending" when it has a call, isn't a hard exchange settlement, and has no
resolution file yet — the routine's LLM judges whether the event has actually
happened (don't resolve a genuinely future event).

This file does NOT call any LLM or hit the web itself — it's the deterministic
worklist (no API key, no web needed). The research is done in-thread by the
routine against pipeline/prompts/resolve_event.md, exactly like extraction.

Usage:
    python -m pipeline.enrich.resolve_events --list-pending
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys

from pipeline.paths import INGEST_RAW, SQLITE

_RES_DIR = INGEST_RAW / "resolutions"


def _resolution_filename(market_id: str) -> str:
    """market_id 'polymarket:slug' / 'kalshi:TICKER' -> filesystem-safe name.
    Slugs and Kalshi tickers are already safe; only the ':' needs escaping."""
    return market_id.replace(":", "__") + ".json"


def list_pending() -> list[dict]:
    """Markets that have a call, aren't a hard exchange settlement, and have no
    resolution file yet. Each row carries what the researcher needs."""
    if not SQLITE.exists():
        return []
    con = sqlite3.connect(f"file:{SQLITE}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    try:
        rows = con.execute(
            """SELECT m.id, m.source, m.ticker, m.question, m.resolution_date,
                      m.current_price, m.effective_resolution,
                      group_concat(DISTINCT c.side) AS sides,
                      COUNT(c.id) AS call_count
                 FROM markets m
                 JOIN calls c ON c.market_id = m.id
                WHERE COALESCE(m.resolved, 0) = 0
                GROUP BY m.id
                ORDER BY m.resolution_date"""
        ).fetchall()
    except sqlite3.Error:
        return []
    finally:
        con.close()

    pending = []
    for r in rows:
        # Already researched (file on disk) → not pending. We check the file
        # rather than effective_resolution so a freshly-cloned routine (DB not
        # yet loaded) still sees the right state from git-tracked files.
        if (_RES_DIR / _resolution_filename(r["id"])).exists():
            continue
        pending.append(
            {
                "market_id": r["id"],
                "source": r["source"],
                "ticker": r["ticker"],
                "question": r["question"],
                "exchange_close_date": r["resolution_date"],
                "sides": r["sides"],
                "call_count": r["call_count"],
                "resolution_file": f"data/ingest/resolutions/{_resolution_filename(r['id'])}",
            }
        )
    return pending


def main() -> int:
    p = argparse.ArgumentParser(description="List markets needing real-world resolution research.")
    p.add_argument("--list-pending", action="store_true", help="Print the worklist (no web/LLM, no key).")
    p.add_argument("--json", action="store_true", help="Emit the worklist as JSON.")
    args = p.parse_args()

    pending = list_pending()
    if args.json:
        print(json.dumps(pending, indent=2))
        return 0

    if not pending:
        print("[resolve] nothing pending — every called market is settled or already researched.")
        return 0
    print(f"[resolve] {len(pending)} market(s) need real-world resolution research:")
    for m in pending:
        print(f"  {m['source']:11} close={m['exchange_close_date']}  sides={m['sides']:8}  {m['question'][:54]}")
        print(f"      -> write {m['resolution_file']}")
    print(
        "\nResearch each in-thread (web search) per pipeline/prompts/resolve_event.md. "
        "Only resolve events that have ACTUALLY happened; leave genuinely-future ones."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
