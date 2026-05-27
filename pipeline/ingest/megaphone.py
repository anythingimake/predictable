"""
Megaphone podcast RSS ingest — the canonical episode source.

Filters to Predictable-era (post-launch) and downloads MP3 audio on demand
for transcription. Returns a stable list of episode records.

Usage:
    from pipeline.ingest.megaphone import pull_episodes, download_audio
    episodes = pull_episodes()
    mp3_path = download_audio(episodes[0])
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import feedparser
import requests

from pipeline.paths import AUDIO, ingest_dir

FEED_URL = "https://feeds.megaphone.fm/BMDC7674164347"

# Anything before this date is from the legacy "Stu Does America" show and
# inherited the same RSS feed when it was rebranded. We skip it.
PREDICTABLE_EPOCH = datetime(2026, 4, 1, tzinfo=timezone.utc)

# A short pre-launch promo that isn't really an episode.
SKIP_TITLE_PATTERNS = [
    re.compile(r"Go Subscribe to the .*Stu and Dave", re.I),
]

UA = {"User-Agent": "predictable-pipeline/1.0 (https://predictable.anythingimake.com)"}


@dataclass
class Episode:
    """A single Megaphone episode after filtering."""

    guid: str
    title: str
    pub_date: str  # ISO 8601 UTC
    duration_sec: int
    audio_url: str
    summary: str

    def as_dict(self) -> dict:
        return asdict(self)


def _parse_duration(raw: str | None) -> int:
    """Megaphone returns either an int-string or 'HH:MM:SS'."""
    if not raw:
        return 0
    if ":" in raw:
        parts = [int(p) for p in raw.split(":")]
        while len(parts) < 3:
            parts.insert(0, 0)
        h, m, s = parts[-3], parts[-2], parts[-1]
        return h * 3600 + m * 60 + s
    try:
        return int(raw)
    except ValueError:
        return 0


def _skip(title: str) -> bool:
    return any(p.search(title) for p in SKIP_TITLE_PATTERNS)


def pull_episodes(epoch: datetime = PREDICTABLE_EPOCH) -> list[Episode]:
    """Fetch the feed and return Predictable-era episodes, newest first."""
    feed = feedparser.parse(FEED_URL, request_headers=UA)
    eps: list[Episode] = []
    for entry in feed.entries:
        pub = entry.get("published_parsed")
        if not pub:
            continue
        pub_dt = datetime(*pub[:6], tzinfo=timezone.utc)
        if pub_dt < epoch:
            continue
        title = entry.get("title", "").strip()
        if _skip(title):
            continue
        enclosure = (entry.enclosures or [{}])[0]
        audio_url = enclosure.get("href", "")
        if not audio_url:
            continue
        eps.append(
            Episode(
                guid=entry.get("id") or entry.get("guid") or audio_url,
                title=title,
                pub_date=pub_dt.isoformat(),
                duration_sec=_parse_duration(entry.get("itunes_duration")),
                audio_url=audio_url,
                summary=(entry.get("summary") or "").strip(),
            )
        )
    eps.sort(key=lambda e: e.pub_date, reverse=True)
    return eps


def write_snapshot(episodes: Iterable[Episode]) -> Path:
    """Save today's episode list to data/ingest/megaphone/{date}.json."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    out = ingest_dir("megaphone") / f"{today}.json"
    out.write_text(
        json.dumps([e.as_dict() for e in episodes], indent=2),
        encoding="utf-8",
    )
    return out


def download_audio(episode: Episode, force: bool = False) -> Path:
    """Download episode MP3 to data/audio/{guid}.mp3. Returns the path."""
    safe = re.sub(r"[^A-Za-z0-9_-]", "_", episode.guid)[:120]
    out = AUDIO / f"{safe}.mp3"
    if out.exists() and not force and out.stat().st_size > 1024:
        return out
    with requests.get(episode.audio_url, headers=UA, stream=True, timeout=120) as r:
        r.raise_for_status()
        with open(out, "wb") as f:
            for chunk in r.iter_content(chunk_size=1 << 20):
                if chunk:
                    f.write(chunk)
    return out


if __name__ == "__main__":
    eps = pull_episodes()
    write_snapshot(eps)
    print(f"Found {len(eps)} Predictable-era episodes")
    for e in eps[:5]:
        print(f"  {e.pub_date[:10]}  {e.duration_sec // 60:>3}min  {e.title}")
