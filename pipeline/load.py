"""
Load ingested + extracted JSON artifacts into SQLite.

Reads:
- data/transcripts/*.json (Whisper output)
- data/ingest/megaphone/*.json (episode metadata)
- data/ingest/substack/*.json (post metadata)
- data/ingest/extract/*-calls.json (Claude extraction output)

Populates: episodes, calls, call_events, mentions, comments tables.

Idempotent — re-running updates existing rows where appropriate.

Usage:
    python -m pipeline.load                  # load everything available
    python -m pipeline.load --episodes-only  # just refresh episode metadata
"""
from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from pipeline.db import (
    connect,
    init_db,
    insert_call,
    insert_call_event,
    insert_mention,
    insert_source_media,
    upsert_episode,
)
from pipeline.paths import INGEST_RAW, TRANSCRIPTS


def _latest_snapshot(source: str, prefix: str = "") -> Path | None:
    """Return the most recent ingest snapshot for a source."""
    d = INGEST_RAW / source
    if not d.exists():
        return None
    files = sorted([p for p in d.glob(f"{prefix}*.json")], reverse=True)
    return files[0] if files else None


def _safe_guid(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "_", s)[:120]


def _transcript_for(guid: str) -> dict | None:
    p = TRANSCRIPTS / f"{_safe_guid(guid)}.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def load_episodes(conn) -> int:
    """Load Megaphone snapshot + matching Substack posts + transcripts into episodes table."""
    mega = _latest_snapshot("megaphone")
    if not mega:
        print("[load] no megaphone snapshot found — run pipeline.ingest.megaphone first")
        return 0
    eps = json.loads(mega.read_text(encoding="utf-8"))

    # Build Substack lookup by publish-date prefix (YYYY-MM-DD) for fuzzy join
    sub_by_date: dict[str, dict] = {}
    sub_snap = _latest_snapshot("substack", prefix="archive-")
    if sub_snap:
        for post in json.loads(sub_snap.read_text(encoding="utf-8")):
            d = (post.get("post_date") or "")[:10]
            if d:
                sub_by_date.setdefault(d, post)

    count = 0
    for ep in eps:
        guid = ep["guid"]
        pub_date_iso = ep["pub_date"][:10]
        sub = sub_by_date.get(pub_date_iso)
        transcript = _transcript_for(guid)

        row = {
            "id": guid,
            "publish_date": pub_date_iso,
            "type": "episode",
            "megaphone_title": ep["title"],
            "youtube_title": None,  # filled later by enrich/cross_reference.py
            "substack_title": sub.get("title") if sub else None,
            "youtube_id": None,
            "substack_slug": sub.get("slug") if sub else None,
            "audio_url": ep["audio_url"],
            "duration_sec": ep["duration_sec"],
            "view_count": None,
            "like_count": None,
            "comment_count": None,
            "transcript_text": transcript["full_text"] if transcript else None,
            "substack_body": None,  # filled by Substack body pull
            "chapter_json": None,
            "cover_image_url": sub.get("cover_image") if sub else None,
        }
        upsert_episode(conn, row)
        count += 1
    return count


def load_calls(conn) -> int:
    """Load Claude extraction output (data/ingest/extract/*-calls.json)."""
    extract_dir = INGEST_RAW / "extract"
    if not extract_dir.exists():
        return 0
    files = sorted(extract_dir.glob("*-calls.json"))
    total_calls = 0
    for fp in files:
        guid = fp.stem.replace("-calls", "")
        data = json.loads(fp.read_text(encoding="utf-8"))
        for call in data.get("calls", []):
            # Find earliest event timestamp
            events = sorted(call.get("events", []), key=lambda e: e.get("timestamp_sec", 0))
            first_ts = events[0].get("timestamp_sec") if events else None

            row = {
                "market_id": None,  # set later by enrich/market_resolver.py
                "market_hint": call.get("market_hint", ""),
                "episode_id": guid,
                "first_event_ts": first_ts,
                "side": call.get("side", "yes"),
                "conviction": call.get("conviction", "opinion"),
                "size_disclosed": call.get("size_disclosed"),
                "speaker": call.get("speaker", "stu"),
                "status": "open",
            }
            call_id = insert_call(conn, row)
            total_calls += 1

            for ev in events:
                insert_call_event(
                    conn,
                    {
                        "call_id": call_id,
                        "episode_id": guid,
                        "timestamp_sec": ev.get("timestamp_sec", 0),
                        "event_type": ev.get("event_type", "entry"),
                        "price_pct": ev.get("price_pct"),
                        "size_pct_of_pos": ev.get("size_pct_of_pos"),
                        "quote": ev.get("cleaned_quote"),
                        "raw_quote": ev.get("raw_quote"),
                    },
                )

            for media in call.get("referenced_media", []):
                insert_source_media(
                    conn,
                    {
                        "call_id": call_id,
                        "mention_id": None,
                        "episode_id": guid,
                        "url": media.get("url"),
                        "source_type": media.get("source_type"),
                        "outlet": media.get("outlet"),
                        "title": media.get("title"),
                    },
                )

        for m in data.get("mentions", []):
            insert_mention(
                conn,
                {
                    "market_id": None,
                    "market_hint": m.get("market_hint", ""),
                    "episode_id": guid,
                    "timestamp_sec": m.get("timestamp_sec", 0),
                    "directional": m.get("directional"),
                    "quote": m.get("cleaned_quote"),
                },
            )
    return total_calls


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--episodes-only", action="store_true")
    args = p.parse_args()

    init_db()
    with connect() as conn:
        n_eps = load_episodes(conn)
        print(f"[load] episodes upserted: {n_eps}")
        if not args.episodes_only:
            n_calls = load_calls(conn)
            print(f"[load] calls inserted: {n_calls}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
