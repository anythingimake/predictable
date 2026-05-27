"""
Backfill transcripts for every Predictable-era Megaphone episode.

Idempotent — only processes episodes whose transcripts don't yet exist.
Cleans up MP3 audio after successful transcription to save disk.

Usage:
    # Full backfill (all 18 episodes; downloads large-v3 model on first run)
    python -m pipeline.backfill

    # Just process N missing episodes (oldest first)
    python -m pipeline.backfill --limit 3

    # Skip pass 2 (no large-v3 model needed; faster smoke test)
    python -m pipeline.backfill --skip-pass2

    # Override models
    python -m pipeline.backfill --pass1-model base --pass2-model medium

    # Dry-run — show what would be processed, no work
    python -m pipeline.backfill --dry-run

    # Keep audio files after transcription (for debugging)
    python -m pipeline.backfill --keep-audio
"""
from __future__ import annotations

import argparse
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from time import time

from pipeline.ingest.megaphone import Episode, download_audio, pull_episodes, write_snapshot
from pipeline.paths import TRANSCRIPTS, AUDIO
from pipeline.transcribe.stitch import transcribe_episode
from pipeline.transcribe.whisper_pass1 import transcribe_pass1
from pipeline.transcribe.glossary import canonicalize_segments
import json


def _transcript_path(ep: Episode) -> Path:
    safe = re.sub(r"[^A-Za-z0-9_-]", "_", ep.guid)[:120]
    return TRANSCRIPTS / f"{safe}.json"


def _pass1_only(audio_path: Path, ep: Episode, pass1_model: str) -> dict:
    """Pass 1 only — no large-v3 download. Used with --skip-pass2."""
    p1 = transcribe_pass1(audio_path, model_name=pass1_model)
    segments = [
        {"start": s["start"], "end": s["end"], "text": s["text"], "source": "pass1", "avg_logprob": s["avg_logprob"]}
        for s in p1["segments"]
    ]
    segments = canonicalize_segments(segments)
    full_text = " ".join(s["text"] for s in segments).strip()
    return {
        "audio_file": str(audio_path),
        "language": p1["info"]["language"],
        "duration": p1["info"]["duration"],
        "pass1_model": pass1_model,
        "pass2_model": None,
        "pass2_rescued_count": 0,
        "pass1_segment_count": len(p1["segments"]),
        "segments": segments,
        "full_text": full_text,
    }


def backfill(
    *,
    limit: int | None = None,
    skip_pass2: bool = False,
    pass1_model: str = "small",
    pass2_model: str = "large-v3",
    dry_run: bool = False,
    keep_audio: bool = False,
) -> int:
    eps = pull_episodes()
    write_snapshot(eps)  # always save today's snapshot
    eps_sorted = sorted(eps, key=lambda e: e.pub_date)  # oldest first for backfill
    todo = [e for e in eps_sorted if not _transcript_path(e).exists()]

    if limit is not None:
        todo = todo[:limit]

    print(f"Episodes total: {len(eps)} | already done: {len(eps) - len(todo)} | to process: {len(todo)}")
    if not todo:
        print("Nothing to do — all caught up.")
        return 0

    for i, ep in enumerate(todo, 1):
        marker = "DRY" if dry_run else ">>"
        print(f"\n{marker} [{i}/{len(todo)}] {ep.pub_date[:10]}  ({ep.duration_sec // 60}min)  {ep.title[:60]}")
        if dry_run:
            continue
        t0 = time()
        try:
            mp3 = download_audio(ep)
            dl_dt = time() - t0
            print(f"   downloaded MP3 in {dl_dt:.1f}s -> {mp3.name}")

            t1 = time()
            if skip_pass2:
                result = _pass1_only(mp3, ep, pass1_model)
            else:
                # Stitch uses TRANSCRIPTS/{stem}.json by default — we override to use guid
                out_path = _transcript_path(ep)
                result = transcribe_episode(
                    mp3,
                    pass1_model=pass1_model,
                    pass2_model=pass2_model,
                    output_path=out_path,
                )
            tr_dt = time() - t1

            if skip_pass2:
                _transcript_path(ep).write_text(
                    json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8"
                )

            print(
                f"   transcribed in {tr_dt:.1f}s — {result['pass1_segment_count']} segments, "
                f"{result['pass2_rescued_count']} rescued, {len(result['full_text'])} chars"
            )

            if not keep_audio:
                mp3.unlink(missing_ok=True)
        except Exception as e:  # noqa: BLE001
            print(f"   FAILED: {type(e).__name__}: {e}")

    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="Backfill Predictable transcripts")
    p.add_argument("--limit", type=int, default=None, help="Process only N missing episodes")
    p.add_argument("--skip-pass2", action="store_true", help="Skip large-v3 second pass")
    p.add_argument("--pass1-model", default="small", help="faster-whisper model for pass 1")
    p.add_argument("--pass2-model", default="large-v3", help="faster-whisper model for pass 2")
    p.add_argument("--dry-run", action="store_true", help="Show what would happen, no work")
    p.add_argument("--keep-audio", action="store_true", help="Don't delete MP3s after transcription")
    args = p.parse_args()

    started = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    print(f"Backfill started: {started}")
    rc = backfill(
        limit=args.limit,
        skip_pass2=args.skip_pass2,
        pass1_model=args.pass1_model,
        pass2_model=args.pass2_model,
        dry_run=args.dry_run,
        keep_audio=args.keep_audio,
    )
    return rc


if __name__ == "__main__":
    sys.exit(main())
