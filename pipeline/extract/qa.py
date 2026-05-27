"""
Extract Q&A clarifications from a Substack comment thread on one episode.

Mirrors the calls.py pattern but operates on comments (not transcripts).
Identifies cases where a fan asked a question and Stu / staff replied with
information that clarifies a position discussed in the episode (entry price,
trim, sizing, conviction nuance).

Output: data/ingest/extract/{episode_guid}-qa.json
"""
from __future__ import annotations

import json
from pathlib import Path

from pipeline.extract.client import extract_with_tool
from pipeline.paths import ingest_dir

PROMPT = Path(__file__).resolve().parent.parent / "prompts" / "extract_qa.md"

TOOL_NAME = "record_clarifications"

TOOL_INPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "clarifications": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "comment_id": {"type": "string"},
                    "question": {"type": "string"},
                    "stu_answer": {"type": "string"},
                    "clarifies_about": {"type": "string"},
                    "extracted_value": {"type": ["string", "null"]},
                },
                "required": ["comment_id", "question", "stu_answer", "clarifies_about"],
            },
        },
    },
    "required": ["clarifications"],
}


def _format_comments(comments: list[dict]) -> str:
    """Render the comment thread as a compact list the model can scan."""
    if not comments:
        return "(no comments)"
    lines = []
    for c in comments:
        cid = c.get("id", "?")
        author = c.get("author", "anon")
        is_stu = c.get("is_stu") or c.get("author_is_stu") or False
        marker = " [STU]" if is_stu else ""
        parent = c.get("parent_id")
        parent_str = f" (reply to {parent})" if parent else ""
        body = (c.get("body") or "").strip().replace("\n", " ")
        lines.append(f"- id={cid}{marker}{parent_str} {author}: {body}")
    return "\n".join(lines)


def extract_qa(
    comments: list[dict],
    episode_meta: dict | None = None,
    *,
    model: str = "claude-sonnet-4-6",
) -> dict | None:
    """Run Q&A clarification extraction. Returns the parsed tool input."""
    if not comments:
        return None

    parts: list[str] = []
    if episode_meta:
        parts.append("## Episode metadata")
        for k in ("title", "publish_date", "duration_sec"):
            if k in episode_meta:
                parts.append(f"- {k}: {episode_meta[k]}")
        parts.append("")
    parts.append("## Substack comments")
    parts.append(_format_comments(comments))

    user_content = "\n".join(parts)
    return extract_with_tool(
        prompt_path=PROMPT,
        user_content=user_content,
        tool_name=TOOL_NAME,
        tool_input_schema=TOOL_INPUT_SCHEMA,
        model=model,
    )


def save_extraction(episode_guid: str, result: dict) -> Path:
    out = ingest_dir("extract") / f"{episode_guid}-qa.json"
    out.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    return out
