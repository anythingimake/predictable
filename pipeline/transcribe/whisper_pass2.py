"""
Pass 2 — targeted re-transcription of low-confidence segments with a larger model.

Reads Pass 1 segments, applies a confidence gate, and runs faster-whisper
large-v3 ONLY on the windowed audio around each flagged segment. Avoids the
cost of running large-v3 on the whole episode.

Usage:
    from pipeline.transcribe.whisper_pass2 import rescue_low_confidence
    rescued = rescue_low_confidence("episode.mp3", pass1_result)
    # rescued = [{"orig_index": 12, "start": ..., "end": ..., "text": "...", "model": "large-v3"}, ...]
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

# Confidence gate — flag segments matching ANY of these
LOW_LOGPROB = -0.6
HIGH_NO_SPEECH = 0.4
HIGH_COMPRESSION = 2.4

# Window padding (seconds) added before/after the flagged segment when re-transcribing
WINDOW_PAD_SEC = 1.0

_model_cache: dict[str, Any] = {}


def _get_model(name: str, device: str = "cpu", compute_type: str = "int8"):
    if name not in _model_cache:
        from faster_whisper import WhisperModel

        _model_cache[name] = WhisperModel(name, device=device, compute_type=compute_type)
    return _model_cache[name]


def is_low_confidence(seg: dict) -> bool:
    """Confidence gate — matches the rule described in CLAUDE.md."""
    return (
        seg.get("avg_logprob", 0.0) < LOW_LOGPROB
        or seg.get("no_speech_prob", 0.0) > HIGH_NO_SPEECH
        or seg.get("compression_ratio", 0.0) > HIGH_COMPRESSION
    )


def flag_segments(pass1_segments: list[dict]) -> list[int]:
    """Return indices of segments flagged for re-transcription."""
    return [i for i, s in enumerate(pass1_segments) if is_low_confidence(s)]


def rescue_low_confidence(
    audio_path: str | Path,
    pass1_result: dict,
    *,
    model_name: str = "large-v3",
    language: str = "en",
) -> list[dict]:
    """Re-transcribe windowed audio around each flagged segment.

    Returns a list of {orig_index, start, end, text, model} dicts. The caller
    (stitch.py) merges these back into the unified transcript.
    """
    pass1_segments = pass1_result["segments"]
    duration = pass1_result["info"]["duration"]
    flagged = flag_segments(pass1_segments)
    if not flagged:
        return []

    model = _get_model(model_name)
    rescued: list[dict] = []
    for idx in flagged:
        seg = pass1_segments[idx]
        win_start = max(0.0, seg["start"] - WINDOW_PAD_SEC)
        win_end = min(duration, seg["end"] + WINDOW_PAD_SEC)
        clip_iter, _ = model.transcribe(
            str(audio_path),
            language=language,
            beam_size=5,
            vad_filter=False,
            condition_on_previous_text=False,
            clip_timestamps=[win_start, win_end],
        )
        clip_text = " ".join(s.text.strip() for s in clip_iter)
        rescued.append(
            {
                "orig_index": idx,
                "start": seg["start"],
                "end": seg["end"],
                "text": clip_text.strip(),
                "model": model_name,
            }
        )
    return rescued
