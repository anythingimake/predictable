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


def pull_channel_videos(limit: int = 60) -> list[dict]:
    """Return channel video metadata (id, title, duration, etc.). Flat — no audio download."""
    opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
        "skip_download": True,
        "playlistend": limit,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(CHANNEL, download=False)
    entries = info.get("entries", []) or []
    return [
        {
            "id": e.get("id"),
            "title": e.get("title"),
            "duration_sec": int(e.get("duration") or 0),
            "view_count": e.get("view_count"),
            "live_status": e.get("live_status"),
            "url": f"https://www.youtube.com/watch?v={e.get('id')}",
        }
        for e in entries
        if e.get("id")
    ]


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
