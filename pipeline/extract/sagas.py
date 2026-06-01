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
from collections import Counter
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


# NB: hidden calls are intentionally INCLUDED. A saga groups a recurring market
# across episodes; hiding one call (often a near-dup) shouldn't silently delete
# the whole saga. Dedup here is about collapsing wording variants, not pruning by
# visibility.
_SQL = (
    "SELECT market_hint, episode_id, market_id FROM calls "
    "WHERE market_hint IS NOT NULL AND market_hint != ''"
)


def detect_sagas(conn: sqlite3.Connection | None = None) -> list[dict]:
    """Return saga candidates: {name, market_hint, key, market_id, episode_ids}
    for hints appearing in >= 2 distinct episodes.

    `key` is the normalized hint (a stable identity that survives trivial wording
    changes); `name` is the SHORTEST raw hint in the bucket — deterministic, and
    in practice the clean variant without the parenthetical annotation. Picking
    the first-seen raw hint (the old behaviour) drifted with row order and let
    the loader accumulate duplicate saga rows."""
    if conn is None:
        with connect() as c:
            rows = c.execute(_SQL).fetchall()
    else:
        rows = conn.execute(_SQL).fetchall()

    # Group: normalized hint -> raw hints seen, episodes, linked market_ids.
    buckets: dict[str, dict] = {}
    for r in rows:
        raw = r["market_hint"]
        norm = _normalize_hint(raw)
        if not norm:
            continue
        b = buckets.setdefault(norm, {"raws": set(), "episodes": set(), "market_ids": []})
        b["raws"].add(raw)
        b["episodes"].add(r["episode_id"])
        if r["market_id"]:
            b["market_ids"].append(r["market_id"])

    sagas: list[dict] = []
    for norm, data in sorted(buckets.items()):
        eps = sorted(data["episodes"])
        if len(eps) < 2:
            continue
        # Shortest, then lexical — fully deterministic, no dependence on row order.
        display = min(data["raws"], key=lambda h: (len(h), h))
        # Most-common linked market among the bucket's calls (None if unresolved).
        market_id = Counter(data["market_ids"]).most_common(1)[0][0] if data["market_ids"] else None
        sagas.append({
            "name": display,
            "market_hint": display,
            "key": norm,
            "market_id": market_id,
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
