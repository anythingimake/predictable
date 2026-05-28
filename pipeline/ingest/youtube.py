"""
YouTube ingest — channel video list (yt-dlp) + transcripts for shorts/livestreams.

We deliberately use YouTube ONLY for content that doesn't reach the Megaphone
podcast feed (shorts, livestreams, occasional clips). The full-episode transcript
path goes through Megaphone + local Whisper to avoid YouTube rate limits.

Usage:
    from pipeline.ingest.youtube import pull_channel_videos, get_transcript
    videos = pull_channel_videos()
    transcript = get_transcript("Xmjw5KujEPA")
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import yt_dlp
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import (
    NoTranscriptFound,
    TranscriptsDisabled,
    VideoUnavailable,
)

from pipeline.paths import ingest_dir

CHANNEL = "https://www.youtube.com/@PredictableShow/videos"


def pull_channel_videos(limit: int = 60, with_dates: bool = True) -> list[dict]:
    """Return channel video metadata (id, title, duration, publish_date, etc.).

    Flat mode is fast but yt-dlp returns `timestamp: None` for most videos —
    so when `with_dates=True` we do a second pass (`extract_flat: False`,
    limited to `limit` entries) to get `upload_date`. ~3-5s for 30 videos.

    Set `with_dates=False` for the legacy fast path (no dates).
    """
    base = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "playlistend": limit,
    }
    opts = {**base, "extract_flat": True}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(CHANNEL, download=False)
    entries = info.get("entries", []) or []
    out: list[dict] = []
    for e in entries:
        if not e.get("id"):
            continue
        ts = e.get("timestamp")
        publish_date = None
        if ts:
            try:
                publish_date = datetime.fromtimestamp(int(ts), tz=timezone.utc).date().isoformat()
            except (TypeError, ValueError):
                publish_date = None
        out.append({
            "id": e.get("id"),
            "title": e.get("title"),
            "duration_sec": int(e.get("duration") or 0),
            "view_count": e.get("view_count"),
            "live_status": e.get("live_status"),
            "publish_date": publish_date,
            "timestamp": ts,
            "url": f"https://www.youtube.com/watch?v={e.get('id')}",
        })

    if with_dates and any(v["publish_date"] is None for v in out):
        # Second pass: per-video upload_date via the playlist's non-flat mode.
        # Non-flat mode is too slow for 120 videos in one call, so we use a
        # small batch (`limit`) of recent videos — that's enough to cover the
        # ~30 most recent episodes which is all we ever need to match.
        try:
            full_opts = {**base, "extract_flat": False}
            with yt_dlp.YoutubeDL(full_opts) as ydl:
                info2 = ydl.extract_info(CHANNEL, download=False)
            dates_by_id: dict[str, str] = {}
            for e in (info2.get("entries") or []):
                vid = e.get("id")
                upd = e.get("upload_date")  # 'YYYYMMDD'
                if vid and upd and len(upd) == 8:
                    dates_by_id[vid] = f"{upd[:4]}-{upd[4:6]}-{upd[6:8]}"
            for v in out:
                if v["publish_date"] is None and v["id"] in dates_by_id:
                    v["publish_date"] = dates_by_id[v["id"]]
        except Exception:
            # Non-fatal — leave publish_date as None and the matcher will
            # fall back to duration-only.
            pass
    return out


def get_video_meta(video_id: str) -> dict:
    """Full per-video metadata (chapters, tags, like_count, etc.) for one video."""
    opts = {"quiet": True, "no_warnings": True, "skip_download": True}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
    keep = (
        "id",
        "title",
        "duration",
        "view_count",
        "like_count",
        "comment_count",
        "upload_date",
        "channel",
        "channel_id",
        "is_live",
        "was_live",
        "live_status",
        "release_timestamp",
        "chapters",
        "tags",
        "categories",
        "description",
    )
    return {k: info.get(k) for k in keep}


def get_transcript(video_id: str) -> list[dict] | None:
    """Fetch auto-generated transcript snippets. Returns None on failure (rate-limit, no-captions)."""
    try:
        api = YouTubeTranscriptApi()
        fetched = api.fetch(video_id)
        return [{"text": s.text, "start": s.start, "duration": s.duration} for s in fetched]
    except (NoTranscriptFound, TranscriptsDisabled, VideoUnavailable):
        return None
    except Exception:
        # Most commonly: IP rate-limited by YouTube. Fall back silently —
        # the caller decides whether to retry later.
        return None


def write_snapshot(videos: list[dict]) -> Path:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    out = ingest_dir("youtube") / f"channel-{today}.json"
    out.write_text(json.dumps(videos, indent=2), encoding="utf-8")
    return out


if __name__ == "__main__":
    vids = pull_channel_videos()
    write_snapshot(vids)
    print(f"Pulled {len(vids)} channel videos")
    for v in vids[:5]:
        mins = v["duration_sec"] // 60
        print(f"  {v['id']:12}  {mins:>3}min  {(v.get('title') or '')[:60]}")
