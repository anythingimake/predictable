"""
Match Megaphone episodes to their YouTube counterparts and populate
episodes.youtube_id / youtube_title / view_count / like_count.

Strategy:
1. Pull the channel listing via yt_dlp (`pull_channel_videos`) — gives us
   id + title + duration + publish_date.
2. For each episode in the DB without a youtube_id, find the channel video
   whose publish_date is within ±2 days AND whose duration is within ±5 min.
3. If exactly one candidate matches, link it. If multiple match, pick the
   closest-duration one. If none match, leave the episode alone.
4. For matched episodes, optionally fetch view_count + like_count via the
   per-video meta call (cheaper than touching every video).

Idempotent — only writes to episodes rows where youtube_id IS NULL or where
the existing youtube_id no longer matches the channel listing.

Usage:
    python -m pipeline.enrich.cross_reference_youtube
    python -m pipeline.enrich.cross_reference_youtube --refresh-meta
        # also re-pulls per-video meta for episodes that already have a
        # youtube_id (refreshes view_count / like_count for the dashboard)
"""
from __future__ import annotations

import argparse
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from pipeline.db import connect
from pipeline.ingest.youtube import get_video_meta, pull_channel_videos, write_snapshot

# Match windows
PUBLISH_TOLERANCE_DAYS = 2
DURATION_TOLERANCE_SEC = 5 * 60  # ±5 minutes
# Tight duration window for same-content match — used when channel listing
# has no per-video timestamp (yt-dlp flat mode often returns timestamp: None).
DURATION_TIGHT_SEC = 90  # ±90s = same encoded master


def _parse_date(s: str | None) -> date | None:
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10])
    except (ValueError, TypeError):
        return None


def _date_diff_days(a: date, b: date) -> int:
    return abs((a - b).days)


def _is_plausible(ep_pub: date | None, ep_dur: int | None,
                  vid_pub: date | None, vid_dur: int | None) -> bool:
    """Match in either of two modes:

    1. Date+duration: publish dates within ±2 days AND durations within ±5 min.
    2. Duration-only: durations within ±90 seconds. yt-dlp flat-mode often
       returns `timestamp: None` so we'd lose every match without this.
       Same-content videos encode to within ~90s of each other.
    """
    if not ep_dur or not vid_dur:
        # No duration on one side — fall back to date if both are available.
        if ep_pub and vid_pub:
            return _date_diff_days(ep_pub, vid_pub) <= PUBLISH_TOLERANCE_DAYS
        return False
    dur_diff = abs(ep_dur - vid_dur)
    # Tight duration match alone — strong signal, doesn't need date.
    if dur_diff <= DURATION_TIGHT_SEC:
        return True
    # Date + loose-duration match.
    if ep_pub and vid_pub and _date_diff_days(ep_pub, vid_pub) <= PUBLISH_TOLERANCE_DAYS:
        return dur_diff <= DURATION_TOLERANCE_SEC
    return False


def _score(ep_pub: date | None, ep_dur: int | None,
           vid_pub: date | None, vid_dur: int | None) -> tuple[int, int]:
    """Smaller-is-better. Sort key = (date_diff_days, duration_diff_sec)."""
    dur_diff = abs((ep_dur or 0) - (vid_dur or 0)) if (ep_dur and vid_dur) else 99999
    if ep_pub and vid_pub:
        return (_date_diff_days(ep_pub, vid_pub), dur_diff)
    # No date on one side — sort purely by duration diff.
    return (0, dur_diff)


def cross_reference(refresh_meta: bool = False) -> dict:
    """Walk every episode without a youtube_id, match against the channel
    listing. Returns stats."""
    print("[yt-xref] pulling channel listing...")
    try:
        videos = pull_channel_videos(limit=120)
    except Exception as e:  # noqa: BLE001
        print(f"[yt-xref] channel fetch failed: {e}")
        return {"matched": 0, "skipped": 0, "errors": 1}
    if not videos:
        print("[yt-xref] no videos returned — aborting")
        return {"matched": 0, "skipped": 0, "errors": 1}
    print(f"[yt-xref] {len(videos)} channel videos")
    # Persist the snapshot so the data dir mirrors the rest of the ingest layer.
    try:
        write_snapshot(videos)
    except Exception as e:  # noqa: BLE001
        print(f"[yt-xref] snapshot write failed (continuing): {e}")

    matched_n = 0
    skipped_n = 0
    refreshed_n = 0
    # Track which YouTube videos got claimed in this run so we don't link
    # two Megaphone episodes to the same YouTube video (a clear false match
    # when duration is the only signal).
    claimed_yt: set[str] = set()
    with connect() as conn:
        # Pre-seed `claimed_yt` with episodes that already have a youtube_id,
        # so we don't accidentally claim the same video twice across calls.
        for r in conn.execute("SELECT youtube_id FROM episodes WHERE youtube_id IS NOT NULL"):
            if r["youtube_id"]:
                claimed_yt.add(r["youtube_id"])
        ep_rows = list(conn.execute(
            "SELECT id, publish_date, duration_sec, youtube_id FROM episodes ORDER BY publish_date DESC"
        ))
        for ep in ep_rows:
            ep_pub = _parse_date(ep["publish_date"])
            ep_dur = ep["duration_sec"]
            if not ep_pub and not ep_dur:
                skipped_n += 1
                continue

            already_linked = bool(ep["youtube_id"])

            if already_linked and not refresh_meta:
                continue

            # Find candidates — skip YouTube videos already claimed by an
            # earlier-iterated episode (we walk in publish_date DESC order so
            # the most recent episode wins ties).
            candidates: list[tuple[tuple[int, int], dict]] = []
            for v in videos:
                if v["id"] in claimed_yt:
                    continue
                vid_pub = _parse_date(v.get("publish_date"))
                vid_dur = v.get("duration_sec")
                if _is_plausible(ep_pub, ep_dur, vid_pub, vid_dur):
                    candidates.append((_score(ep_pub, ep_dur, vid_pub, vid_dur), v))
            if not candidates:
                skipped_n += 1
                continue
            candidates.sort(key=lambda t: t[0])
            best = candidates[0][1]
            claimed_yt.add(best["id"])

            youtube_id = best["id"]
            youtube_title = best.get("title")

            # Optionally pull per-video stats for view/like counts.
            view_count = best.get("view_count")
            like_count = None
            if refresh_meta or not already_linked:
                try:
                    meta = get_video_meta(youtube_id)
                    view_count = meta.get("view_count") or view_count
                    like_count = meta.get("like_count")
                except Exception as e:  # noqa: BLE001
                    print(f"[yt-xref] meta fetch failed for {youtube_id}: {e}")

            conn.execute(
                """UPDATE episodes
                      SET youtube_id = ?, youtube_title = ?,
                          view_count = COALESCE(?, view_count),
                          like_count = COALESCE(?, like_count)
                    WHERE id = ?""",
                (youtube_id, youtube_title, view_count, like_count, ep["id"]),
            )
            if already_linked:
                refreshed_n += 1
            else:
                matched_n += 1
                print(f"[yt-xref] linked ep {ep['id'][:8]}.. -> {youtube_id} ({(youtube_title or '')[:60]})")
    return {"matched": matched_n, "refreshed": refreshed_n, "skipped": skipped_n}


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--refresh-meta", action="store_true",
                   help="Also refresh view_count + like_count for episodes already linked")
    args = p.parse_args()
    print(json.dumps(cross_reference(refresh_meta=args.refresh_meta), indent=2))
