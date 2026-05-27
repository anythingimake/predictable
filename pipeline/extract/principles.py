"""
Extract Stu's recurring principles / heuristics from one episode transcript.

Mirrors the calls.py pattern: passes the transcript to Claude via structured
tool-use (see pipeline.extract.client.extract_with_tool), parses the result,
and saves it to data/ingest/extract/{episode_guid}-principles.json for the
loader to ingest.
"""
from __future__ import annotations

import json
from pathlib import Path

from pipeline.extract.client import extract_with_tool, segments_to_text_with_timestamps
from pipeline.paths import ingest_dir

PROMPT = Path(__file__).resolve().parent.parent / "prompts" / "extract_principles.md"

TOOL_NAME = "record_principles"

TOOL_INPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "principles": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "rule": {"type": "string"},
                    "rationale": {"type": "string"},
                    "citations": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "timestamp_sec": {"type": "integer"},
                                "quote": {"type": "string"},
                            },
                            "required": ["timestamp_sec", "quote"],
                        },
                    },
                },
                "required": ["rule", "rationale", "citations"],
            },
        },
    },
    "required": ["principles"],
}


def extract_principles(
    transcript: dict,
    *,
    episode_meta: dict | None = None,
    model: str = "claude-sonnet-4-6",
) -> dict | None:
    """Run principle extraction for one episode. Returns the parsed tool input."""
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

    user_content = "\n".join(parts)
    return extract_with_tool(
        prompt_path=PROMPT,
        user_content=user_content,
        tool_name=TOOL_NAME,
        tool_input_schema=TOOL_INPUT_SCHEMA,
        model=model,
    )


def save_extraction(episode_guid: str, result: dict) -> Path:
    out = ingest_dir("extract") / f"{episode_guid}-principles.json"
    out.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    return out
