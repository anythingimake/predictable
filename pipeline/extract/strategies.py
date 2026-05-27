"""
Extract Stu's multi-call strategies from one episode transcript.

Strategies are groups of related calls Stu executes as a single play
(tier-ladder, basket, free-roll, pair). This extractor needs the already-
extracted call list from the same episode so the model can reference
existing `market_hint` values rather than re-deriving them.

Output: data/ingest/extract/{episode_guid}-strategies.json
"""
from __future__ import annotations

import json
from pathlib import Path

from pipeline.extract.client import extract_with_tool, segments_to_text_with_timestamps
from pipeline.paths import ingest_dir

PROMPT = Path(__file__).resolve().parent.parent / "prompts" / "extract_strategies.md"

TOOL_NAME = "record_strategies"

TOOL_INPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "strategies": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "pattern_type": {
                        "type": "string",
                        "enum": ["tier-ladder", "basket", "free-roll", "pair"],
                    },
                    "description": {"type": "string"},
                    "call_market_hints": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
                "required": ["name", "pattern_type", "description", "call_market_hints"],
            },
        },
    },
    "required": ["strategies"],
}


def _format_calls(calls: list[dict]) -> str:
    """Compact human-readable listing of the episode's already-extracted calls."""
    if not calls:
        return "(none extracted)"
    lines = []
    for i, c in enumerate(calls, 1):
        side = c.get("side", "?")
        conv = c.get("conviction", "?")
        hint = c.get("market_hint", "")
        lines.append(f"{i}. [{conv}/{side}] {hint}")
    return "\n".join(lines)


def extract_strategies(
    transcript: dict,
    episode_meta: dict | None,
    existing_calls: list[dict],
    *,
    model: str = "claude-sonnet-4-6",
) -> dict | None:
    """Run strategy extraction for one episode. Returns the parsed tool input."""
    segments = transcript.get("segments", [])
    if not segments:
        return None

    parts: list[str] = []
    if episode_meta:
        parts.append("## Episode metadata")
        for k in ("title", "publish_date", "duration_sec"):
            if k in episode_meta:
                parts.append(f"- {k}: {episode_meta[k]}")
        parts.append("")
    parts.append("## Transcript (timestamps as [mm:ss])")
    parts.append(segments_to_text_with_timestamps(segments))
    parts.append("")
    parts.append("## Already-extracted calls from this episode")
    parts.append("(Reference these by their `market_hint` when grouping into strategies.)")
    parts.append("")
    parts.append(_format_calls(existing_calls))

    user_content = "\n".join(parts)
    return extract_with_tool(
        prompt_path=PROMPT,
        user_content=user_content,
        tool_name=TOOL_NAME,
        tool_input_schema=TOOL_INPUT_SCHEMA,
        model=model,
    )


def save_extraction(episode_guid: str, result: dict) -> Path:
    out = ingest_dir("extract") / f"{episode_guid}-strategies.json"
    out.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    return out
