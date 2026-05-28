"""
Re-pull Substack comments for any episode published in the last 14 days.

Comments are snapshotted once at episode-load time. New Stu replies (which often
clarify entry prices, trims, position changes) posted days later never reach
the DB unless we explicitly re-fetch. This module forces a fresh snapshot for
recent episodes and re-loads them into SQLite.

Idempotent — `upsert_comment` updates body on conflict.

Usage:
    python -m pipeline.sync.repull_recent_comments
    python -m pipeline.sync.repull_recent_comments --days 30  # widen window
"""
from __future__ import annotations

import argparse
import json
from datetime import date, timedelta

from pipeline.db import connect
from pipeline.ingest.substack import snapshot_comments
from pipeline.load import load_substack_bodies_and_comments


def repull(days: int = 14) -> dict:
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    with connect() as conn:
        slugs = [
            r["substack_slug"]
            for r in conn.execute(
                """SELECT substack_slug
                     FROM episodes
                    WHERE substack_slug IS NOT NULL
                      AND publish_date >= ?""",
                (cutoff,),
            ).fetchall()
            if r["substack_slug"]
        ]
    if not slugs:
        print(f"[repull-comments] no episodes since {cutoff}")
        return {"slugs": 0, "comments_loaded": 0}
    print(f"[repull-comments] re-fetching comments for {len(slugs)} episode(s) since {cutoff}")
    snapshot_comments(slugs, force=True)
    with connect() as conn:
        _n_bodies, n_comments = load_substack_bodies_and_comments(conn)
    print(f"[repull-comments] re-loaded {n_comments} comments")
    return {"slugs": len(slugs), "comments_loaded": n_comments}


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--days", type=int, default=14, help="Re-pull window (days back)")
    args = p.parse_args()
    print(json.dumps(repull(days=args.days), indent=2))
