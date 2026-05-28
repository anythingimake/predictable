"""
Anthropic client wrapper for extraction passes.

Loads ANTHROPIC_API_KEY from environment (set in .env or shell). Defaults to
Sonnet 4.6 for speed; the caller can override to Opus 4.7 for hard episodes.

Uses tool-use (structured output) — every extractor passes a JSONSchema tool
definition and gets back parsed JSON.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from anthropic import Anthropic

DEFAULT_MODEL = "claude-sonnet-4-6"
HARD_MODEL = "claude-opus-4-7"

# A batch extraction run makes one create() call per episode per extractor, so a
# single transient 429/529/connection blip would otherwise abort the whole run
# mid-batch. The SDK retries 408/409/429/5xx (incl. 529 overloaded) with
# exponential backoff + jitter and honors Retry-After; the default of 2 is too
# shallow for a sustained overload, so we raise it and give long generations
# room with a generous per-request timeout.
MAX_RETRIES = 8
TIMEOUT_SECONDS = 600.0


def _client() -> Anthropic:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        # Fall back to user's standard location if present
        env_file = Path.home() / ".secrets" / "anthropic.env"
        if env_file.exists():
            for line in env_file.read_text(encoding="utf-8").splitlines():
                if line.startswith("ANTHROPIC_API_KEY="):
                    api_key = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
    if not api_key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY not set. Export it or place in ~/.secrets/anthropic.env"
        )
    return Anthropic(api_key=api_key, max_retries=MAX_RETRIES, timeout=TIMEOUT_SECONDS)


def extract_with_tool(
    *,
    prompt_path: str | Path,
    user_content: str,
    tool_name: str,
    tool_input_schema: dict,
    model: str = DEFAULT_MODEL,
    max_tokens: int = 8000,
) -> dict | None:
    """Run an extraction pass. Returns the parsed tool input, or None on failure."""
    system_prompt = Path(prompt_path).read_text(encoding="utf-8")
    client = _client()
    tool = {
        "name": tool_name,
        "description": f"Record structured extraction output for {tool_name}",
        "input_schema": tool_input_schema,
    }
    resp = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system_prompt,
        tools=[tool],
        tool_choice={"type": "tool", "name": tool_name},
        messages=[{"role": "user", "content": user_content}],
    )
    for block in resp.content:
        if getattr(block, "type", None) == "tool_use" and block.name == tool_name:
            return block.input
    return None


def segments_to_text_with_timestamps(segments: list[dict]) -> str:
    """Format segments as '[mm:ss] text' lines for the model."""
    lines = []
    for s in segments:
        t = int(s["start"])
        mm, ss = t // 60, t % 60
        lines.append(f"[{mm:02d}:{ss:02d}] {s['text']}")
    return "\n".join(lines)
