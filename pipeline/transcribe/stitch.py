"""
Stitch Pass 1 + Pass 2 into a unified transcript with timestamps.

Output schema (per episode):
{
  "audio_file": "data/audio/{guid}.mp3",
  "language": "en",
  "duration": 2828.5,
  "pass1_model": "small",
  "pass2_model": "large-v3",
  "pass2_rescued_count": 12,
  "segments": [
      {"start": 0.0, "end": 4.2, "text": "...", "source": "pass1"},
      {"start": 22.0, "end": 26.5, "text": "...", "source": "pass2"},
      ...
  ],
  "full_text": "..."   # joined text for free-text search
}

Usage:
    from pipeline.transcribe.stitch import transcribe_episode
    result = transcribe_episode("data/audio/episode.mp3")
"""
from __future__ import annotations

import json
from pathlib import Path

from pipeline.paths import TRANSCRIPTS
from pipeline.transcribe.glossary import canonicalize_segments
from pipeline.transcribe.whisper_pass1 import transcribe_pass1
from pipeline.transcribe.whisper_pass2 import rescue_low_confidence


def stitch(pass1_result: dict, rescued: list[dict]) -> list[dict]:
    """Merge rescued (Pass 2) segments into the Pass 1 segment list."""
    segments = [
        {
            "start": s["start"],
            "end": s["end"],
            "text": s["text"],
            "source": "pass1",
            "avg_logprob": s.get("avg_logprob"),
        }
        for s in pass1_result["segments"]
    ]
    for r in rescued:
        i = r["orig_index"]
        if 0 <= i < len(segments):
            segments[i] = {
                "start": r["start"],
                "end": r["end"],
                "text": r["text"],
                "source": "pass2",
                "model": r["model"],
            }
    return segments


def transcribe_episode(
    audio_path: str | Path,
    *,
    pass1_model: str = "small",
    pass2_model: str = "large-v3",
    output_path: str | Path | None = None,
) -> dict:
    """End-to-end two-pass transcription. Writes JSON to TRANSCRIPTS/{stem}.json."""
    audio_path = Path(audio_path)
    p1 = transcribe_pass1(audio_path, model_name=pass1_model)
    rescued = rescue_low_confidence(audio_path, p1, model_name=pass2_model)
    segments = stitch(p1, rescued)
    segments = canonicalize_segments(segments)
    full_text = " ".join(s["text"] for s in segments).strip()

    out = {
        "audio_file": str(audio_path),
        "language": p1["info"]["language"],
        "duration": p1["info"]["duration"],
        "pass1_model": pass1_model,
        "pass2_model": pass2_model,
        "pass2_rescued_count": len(rescued),
        "pass1_segment_count": len(p1["segments"]),
        "segments": segments,
        "full_text": full_text,
    }

    output_path = output_path or (TRANSCRIPTS / f"{audio_path.stem}.json")
    Path(output_path).write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    return out


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python -m pipeline.transcribe.stitch <audio.mp3>")
        sys.exit(1)
    result = transcribe_episode(sys.argv[1])
    print(f"  Duration:   {result['duration']:.1f}s")
    print(f"  Pass 1:     {result['pass1_segment_count']} segments ({result['pass1_model']})")
    print(f"  Pass 2:     {result['pass2_rescued_count']} rescued ({result['pass2_model']})")
    print(f"  Text len:   {len(result['full_text'])} chars")
    print(f"  Saved:      {TRANSCRIPTS / (Path(sys.argv[1]).stem + '.json')}")
