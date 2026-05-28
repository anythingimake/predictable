"""
Walk every row in calls and rewrite its `tags` column from tag_call(...).

Idempotent — safe to re-run. Always sets a non-empty JSON array.

Usage:
    python -m pipeline.scripts.retag_all
    python -m pipeline.scripts.retag_all --db data/predictable.sqlite.prod_pull
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

# Allow `python pipeline/scripts/retag_all.py` to work without -m.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.extract.tagger import tag_call  # noqa: E402
from pipeline.paths import SQLITE  # noqa: E402


def retag(db_path: Path) -> tuple[int, int]:
    """Returns (total_rows, rows_changed)."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    # Ensure the column exists — useful when running against an older DB
    # snapshot before schema.sql migration has been re-applied.
    cols = [r[1] for r in conn.execute("PRAGMA table_info(calls)").fetchall()]
    if "tags" not in cols:
        conn.execute("ALTER TABLE calls ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'")
        conn.commit()

    rows = conn.execute(
        """SELECT c.id, c.market_hint, c.tags AS current_tags,
                  e.megaphone_title AS episode_title
           FROM calls c
           LEFT JOIN episodes e ON e.id = c.episode_id"""
    ).fetchall()

    # Pull a representative event quote per call (one query, indexed by call_id).
    quotes_by_call: dict[int, str] = {}
    for row in conn.execute(
        """SELECT call_id, COALESCE(raw_quote, quote, '') AS q
           FROM call_events
           WHERE event_type = 'entry'
           ORDER BY call_id, timestamp_sec"""
    ).fetchall():
        cid = row["call_id"]
        if cid not in quotes_by_call:
            quotes_by_call[cid] = row["q"] or ""

    changed = 0
    for r in rows:
        new_tags = tag_call(
            market_hint=r["market_hint"] or "",
            episode_title=r["episode_title"] or "",
            raw_quote=quotes_by_call.get(r["id"], ""),
        )
        new_json = json.dumps(new_tags)
        if (r["current_tags"] or "") != new_json:
            conn.execute("UPDATE calls SET tags = ? WHERE id = ?", (new_json, r["id"]))
            changed += 1
    conn.commit()
    conn.close()
    return len(rows), changed


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--db", default=str(SQLITE), help="Path to SQLite file")
    args = p.parse_args()

    db_path = Path(args.db)
    if not db_path.exists():
        print(f"[retag] DB not found: {db_path}", file=sys.stderr)
        return 1

    total, changed = retag(db_path)
    print(f"[retag] {db_path}: {total} rows scanned, {changed} updated")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
