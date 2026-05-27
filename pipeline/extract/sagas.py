"""
Detect cross-episode "sagas" — recurring markets Stu returns to in multiple
episodes. Pure SQL for v1, no LLM. Groups `calls` by a normalized
`market_hint` key and emits one saga candidate per hint that appears in
>= 2 distinct episodes.

Output: data/ingest/extract/_sagas.json (single file, refreshed each run)
"""
from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path

from pipeline.db import connect
from pipeline.paths import ingest_dir


def _normalize_hint(hint: str) -> str:
    """Lower, strip trailing parentheticals + punctuation so trivial variants collapse.

    "Democrats win the House in 2026 midterms (updated post-SCOTUS VRA ruling)"
    and "Democrats win the House in 2026 midterms" should collapse to the same
    saga key — the parenthetical is annotation, not the market identity.
    """
    h = (hint or "").lower().strip()
    # Drop parenthetical annotations entirely (recurring extractor noise)
    h = re.sub(r"\([^)]*\)", " ", h)
    h = re.sub(r"[\s\-_/]+", " ", h)
    h = re.sub(r"[^\w\s]", "", h)
    h = re.sub(r"\s+", " ", h).strip()
    return h


def detect_sagas(conn: sqlite3.Connection | None = None) -> list[dict]:
    """Return saga candidates: {name, market_hint, episode_ids} for hints in >= 2 episodes."""
    rows: list[sqlite3.Row]
    if conn is None:
        with connect() as c:
            rows = c.execute(
                "SELECT market_hint, episode_id FROM calls WHERE market_hint IS NOT NULL AND market_hint != ''"
            ).fetchall()
    else:
        rows = conn.execute(
            "SELECT market_hint, episode_id FROM calls WHERE market_hint IS NOT NULL AND market_hint != ''"
        ).fetchall()

    # Group: normalized hint -> {"display": <first raw hint>, "episodes": set}
    buckets: dict[str, dict] = {}
    for r in rows:
        raw = r["market_hint"]
        norm = _normalize_hint(raw)
        if not norm:
            continue
        b = buckets.setdefault(norm, {"display": raw, "episodes": set()})
        b["episodes"].add(r["episode_id"])

    sagas: list[dict] = []
    for norm, data in sorted(buckets.items()):
        eps = sorted(data["episodes"])
        if len(eps) < 2:
            continue
        sagas.append({
            "name": data["display"],
            "market_hint": data["display"],
            "episode_ids": eps,
        })
    return sagas


def save_extraction(sagas: list[dict]) -> Path:
    out = ingest_dir("extract") / "_sagas.json"
    out.write_text(json.dumps({"sagas": sagas}, indent=2, ensure_ascii=False), encoding="utf-8")
    return out


def main() -> int:
    sagas = detect_sagas()
    path = save_extraction(sagas)
    print(f"[sagas] detected {len(sagas)} saga(s) -> {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
