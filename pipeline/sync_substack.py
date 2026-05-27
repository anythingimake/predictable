"""
Sync Substack bodies + comments for every episodes row with a substack_slug.

Steps:
1. Read every substack_slug from the episodes table.
2. snapshot_bodies(slugs) — per-slug body JSON to data/ingest/substack/bodies/
3. snapshot_comments(slugs) — per-slug comments JSON to data/ingest/substack/comments/
4. Re-run load_substack_bodies_and_comments to push into SQLite.
5. Print a tight summary.

Usage:
    python -m pipeline.sync_substack            # skip slugs already on disk
    python -m pipeline.sync_substack --force    # re-fetch everything
"""
from __future__ import annotations

import argparse

from pipeline.db import connect, init_db
from pipeline.ingest.substack import snapshot_bodies, snapshot_comments
from pipeline.load import load_substack_bodies_and_comments
from pipeline.paths import INGEST_RAW


def _existing(dir_name: str, slugs: list[str]) -> set[str]:
    d = INGEST_RAW / "substack" / dir_name
    if not d.exists():
        return set()
    have: set[str] = set()
    for slug in slugs:
        if (d / f"{slug}.json").exists():
            have.add(slug)
    return have


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-fetch every slug even if a snapshot file already exists.",
    )
    args = parser.parse_args()

    init_db()
    with connect() as conn:
        slugs = [
            r["substack_slug"]
            for r in conn.execute(
                "SELECT substack_slug FROM episodes WHERE substack_slug IS NOT NULL"
            ).fetchall()
            if r["substack_slug"]
        ]
    if not slugs:
        print("[sync_substack] no substack_slug rows in episodes — nothing to do")
        return 0

    bodies_before = _existing("bodies", slugs) if not args.force else set()
    comments_before = _existing("comments", slugs) if not args.force else set()

    print(f"[sync_substack] {len(slugs)} slugs to process (force={args.force})")
    print(f"[sync_substack] bodies on disk: {len(bodies_before)}; comments on disk: {len(comments_before)}")

    snapshot_bodies(slugs, force=args.force)
    snapshot_comments(slugs, force=args.force)

    bodies_after = _existing("bodies", slugs)
    comments_after = _existing("comments", slugs)
    bodies_fetched = len(bodies_after - bodies_before)
    bodies_skipped = len(bodies_before & bodies_after)
    comments_fetched = len(comments_after - comments_before)
    comments_skipped = len(comments_before & comments_after)

    with connect() as conn:
        n_bodies, n_comments = load_substack_bodies_and_comments(conn)

    print("[sync_substack] summary:")
    print(f"  bodies   fetched={bodies_fetched}  skipped={bodies_skipped}")
    print(f"  comments fetched={comments_fetched}  skipped={comments_skipped}")
    print(f"  episodes updated with substack_body: {n_bodies}")
    print(f"  comments upserted into SQLite:       {n_comments}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
