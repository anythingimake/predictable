"""
Extract Stu's calls from one episode transcript using Claude.

Schema mirrors the `extract_calls.md` prompt. Output is saved to
data/ingest/extract/{episode_guid}-calls.json for downstream loading into SQLite.
"""
from __future__ import annotations

import json
from pathlib import Path

from pipeline.extract.client import extract_with_tool, segments_to_text_with_timestamps
from pipeline.paths import ingest_dir

PROMPT = Path(__file__).resolve().parent.parent / "prompts" / "extract_calls.md"

TOOL_NAME = "record_calls"

TOOL_INPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "calls": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "market_source": {"type": "string", "enum": ["kalshi", "polymarket", "predictit", "unknown"]},
                    "market_hint": {"type": "string"},
                    "market_ticker_hint": {"type": "string"},
                    "side": {"type": "string", "enum": ["yes", "no", "over", "under"]},
                    "conviction": {
                        "type": "string",
                        "enum": ["play", "solid", "flyer", "watch", "opinion", "pass"],
                    },
                    "speaker": {"type": "string"},
                    "size_disclosed": {"type": ["string", "null"]},
                    "events": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "timestamp_sec": {"type": "integer"},
                                "event_type": {
                                    "type": "string",
                                    "enum": ["entry", "add", "trim", "exit", "resolve"],
                                },
                                "price_pct": {"type": ["number", "null"]},
                                "size_pct_of_pos": {"type": ["number", "null"]},
                                "raw_quote": {"type": "string"},
                                "cleaned_quote": {"type": "string"},
                            },
                            "required": ["timestamp_sec", "event_type", "raw_quote", "cleaned_quote"],
                        },
                    },
                    "referenced_media": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "source_type": {"type": "string"},
                                "title": {"type": "string"},
                                "outlet": {"type": "string"},
                            },
                        },
                    },
                },
                "required": ["market_source", "market_hint", "side", "conviction", "events"],
            },
        },
        "mentions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "market_source": {"type": "string"},
                    "market_hint": {"type": "string"},
                    "directional": {
                        "type": "string",
                        "enum": ["bullish", "bearish", "neutral", "explainer"],
                    },
                    "timestamp_sec": {"type": "integer"},
                    "cleaned_quote": {"type": "string"},
                },
                "required": ["market_hint", "directional", "timestamp_sec", "cleaned_quote"],
            },
        },
    },
    "required": ["calls", "mentions"],
}


def extract_calls(
    transcript: dict,
    *,
    episode_meta: dict | None = None,
    substack_body: str | None = None,
    model: str = "claude-sonnet-4-6",
) -> dict | None:
    """Run call extraction for one episode. Returns the parsed tool input."""
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
    if substack_body:
        parts.append("")
        parts.append("## Substack post body (clean written version of the same content)")
        parts.append(substack_body[:8000])

    user_content = "\n".join(parts)
    return extract_with_tool(
        prompt_path=PROMPT,
        user_content=user_content,
        tool_name=TOOL_NAME,
        tool_input_schema=TOOL_INPUT_SCHEMA,
        model=model,
    )


def save_extraction(episode_guid: str, result: dict) -> Path:
    out = ingest_dir("extract") / f"{episode_guid}-calls.json"
    out.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    return out
