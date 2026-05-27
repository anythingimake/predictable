"""
Pass 1 — fast Whisper transcription on full audio.

Uses faster-whisper with the `small` model by default. Returns segments with
per-segment confidence metrics (avg_logprob, no_speech_prob, compression_ratio)
which Pass 2 uses to decide what to re-transcribe with a larger model.

Usage:
    from pipeline.transcribe.whisper_pass1 import transcribe_pass1
    result = transcribe_pass1("data/audio/episode.mp3")
    # result = {"segments": [...], "info": {...}, "model": "small"}
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

# faster-whisper is imported lazily to keep CLI startup snappy
_model_cache: dict[str, Any] = {}


def _get_model(name: str, device: str = "cpu", compute_type: str = "int8"):
    if name not in _model_cache:
        from faster_whisper import WhisperModel

        _model_cache[name] = WhisperModel(name, device=device, compute_type=compute_type)
    return _model_cache[name]


def transcribe_pass1(
    audio_path: str | Path,
    *,
    model_name: str = "small",
    language: str = "en",
    vad_filter: bool = True,
    beam_size: int = 5,
) -> dict:
    """Run Pass 1 on an MP3/WAV file. Returns rich segment list + metadata."""
    audio_path = str(audio_path)
    model = _get_model(model_name)
    segments_iter, info = model.transcribe(
        audio_path,
        language=language,
        beam_size=beam_size,
        vad_filter=vad_filter,
        word_timestamps=False,
        condition_on_previous_text=True,
    )
    segments = [
        {
            "start": float(s.start),
            "end": float(s.end),
            "text": s.text.strip(),
            "avg_logprob": float(s.avg_logprob),
            "no_speech_prob": float(s.no_speech_prob),
            "compression_ratio": float(s.compression_ratio),
        }
        for s in segments_iter
    ]
    return {
        "segments": segments,
        "info": {
            "language": info.language,
            "language_probability": float(info.language_probability),
            "duration": float(info.duration),
            "duration_after_vad": float(info.duration_after_vad),
        },
        "model": model_name,
    }


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python -m pipeline.transcribe.whisper_pass1 <audio.mp3>")
        sys.exit(1)
    result = transcribe_pass1(sys.argv[1])
    print(f"Segments: {len(result['segments'])}")
    print(f"Duration: {result['info']['duration']:.1f}s")
    print(f"Sample: {result['segments'][0]['text'][:80] if result['segments'] else '(none)'}")
