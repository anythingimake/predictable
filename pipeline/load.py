"""
Load ingested + extracted JSON artifacts into SQLite.

Reads:
- data/transcripts/*.json (Whisper output)
- data/ingest/megaphone/*.json (episode metadata)
- data/ingest/substack/*.json (post metadata)
- data/ingest/extract/*-calls.json (Claude extraction output)

Populates: episodes, calls, call_events, mentions, comments tables.

Idempotent — re-running updates existing rows where appropriate.

Usage:
    python -m pipeline.load                  # load everything available
    python -m pipeline.load --episodes-only  # just refresh episode metadata
"""
from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from pipeline.db import (
    connect,
    init_db,
    insert_call,
    insert_call_event,
    insert_mention,
    insert_principle_citation,
    insert_source_media,
    upsert_comment,
    upsert_episode,
    upsert_principle,
)
from pipeline.paths import INGEST_RAW, TRANSCRIPTS


def _latest_snapshot(source: str, prefix: str = "") -> Path | None:
    """Return the most recent ingest snapshot for a source."""
    d = INGEST_RAW / source
    if not d.exists():
        return None
    files = sorted([p for p in d.glob(f"{prefix}*.json")], reverse=True)
    return files[0] if files else None


def _safe_guid(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "_", s)[:120]


def _transcript_for(guid: str) -> dict | None:
    p = TRANSCRIPTS / f"{_safe_guid(guid)}.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def load_episodes(conn) -> int:
    """Load Megaphone snapshot + matching Substack posts + transcripts into episodes table."""
    mega = _latest_snapshot("megaphone")
    if not mega:
        print("[load] no megaphone snapshot found — run pipeline.ingest.megaphone first")
        return 0
    eps = json.loads(mega.read_text(encoding="utf-8"))

    # Build Substack lookup by publish-date prefix (YYYY-MM-DD) for fuzzy join
    sub_by_date: dict[str, dict] = {}
    sub_snap = _latest_snapshot("substack", prefix="archive-")
    if sub_snap:
        for post in json.loads(sub_snap.read_text(encoding="utf-8")):
            d = (post.get("post_date") or "")[:10]
            if d:
                sub_by_date.setdefault(d, post)

    count = 0
    for ep in eps:
        guid = ep["guid"]
        pub_date_iso = ep["pub_date"][:10]
        sub = sub_by_date.get(pub_date_iso)
        transcript = _transcript_for(guid)

        row = {
            "id": guid,
            "publish_date": pub_date_iso,
            "type": "episode",
            "megaphone_title": ep["title"],
            "youtube_title": None,  # filled later by enrich/cross_reference.py
            "substack_title": sub.get("title") if sub else None,
            "youtube_id": None,
            "substack_slug": sub.get("slug") if sub else None,
            "audio_url": ep["audio_url"],
            "duration_sec": ep["duration_sec"],
            "view_count": None,
            "like_count": None,
            "comment_count": None,
            "transcript_text": transcript["full_text"] if transcript else None,
            "substack_body": None,  # filled by Substack body pull
            "chapter_json": None,
            "cover_image_url": sub.get("cover_image") if sub else None,
        }
        upsert_episode(conn, row)
        count += 1
    return count


def load_calls(conn) -> int:
    """Load Claude extraction output (data/ingest/extract/*-calls.json).

    Idempotent per episode: each *-calls.json file is the source of truth for
    that episode's calls + events + mentions + source_media. Re-running clears
    the episode's prior rows and re-inserts from JSON, so the DB always matches.
    """
    extract_dir = INGEST_RAW / "extract"
    if not extract_dir.exists():
        return 0
    files = sorted(extract_dir.glob("*-calls.json"))
    total_calls = 0
    for fp in files:
        guid = fp.stem.replace("-calls", "")
        # Wipe this episode's existing rows so re-loading from JSON doesn't dup.
        # FK order: call_events + source_media first, then calls, then mentions.
        conn.execute(
            "DELETE FROM call_events WHERE call_id IN (SELECT id FROM calls WHERE episode_id = ?)",
            (guid,),
        )
        conn.execute(
            "DELETE FROM source_media WHERE call_id IN (SELECT id FROM calls WHERE episode_id = ?)",
            (guid,),
        )
        conn.execute("DELETE FROM calls WHERE episode_id = ?", (guid,))
        conn.execute("DELETE FROM mentions WHERE episode_id = ?", (guid,))
        data = json.loads(fp.read_text(encoding="utf-8"))
        for call in data.get("calls", []):
            # Find earliest event timestamp
            events = sorted(call.get("events", []), key=lambda e: e.get("timestamp_sec", 0))
            first_ts = events[0].get("timestamp_sec") if events else None

            row = {
                "market_id": None,  # set later by enrich/market_resolver.py
                "market_hint": call.get("market_hint", ""),
                "episode_id": guid,
                "first_event_ts": first_ts,
                "side": call.get("side", "yes"),
                "conviction": call.get("conviction", "opinion"),
                "size_disclosed": call.get("size_disclosed"),
                "speaker": call.get("speaker", "stu"),
                "status": "open",
            }
            call_id = insert_call(conn, row)
            total_calls += 1

            for ev in events:
                insert_call_event(
                    conn,
                    {
                        "call_id": call_id,
                        "episode_id": guid,
                        "timestamp_sec": ev.get("timestamp_sec", 0),
                        "event_type": ev.get("event_type", "entry"),
                        "price_pct": ev.get("price_pct"),
                        "size_pct_of_pos": ev.get("size_pct_of_pos"),
                        "quote": ev.get("cleaned_quote"),
                        "raw_quote": ev.get("raw_quote"),
                    },
                )

            for media in call.get("referenced_media", []):
                insert_source_media(
                    conn,
                    {
                        "call_id": call_id,
                        "mention_id": None,
                        "episode_id": guid,
                        "url": media.get("url"),
                        "source_type": media.get("source_type"),
                        "outlet": media.get("outlet"),
                        "title": media.get("title"),
                    },
                )

        for m in data.get("mentions", []):
            insert_mention(
                conn,
                {
                    "market_id": None,
                    "market_hint": m.get("market_hint", ""),
                    "episode_id": guid,
                    "timestamp_sec": m.get("timestamp_sec", 0),
                    "directional": m.get("directional"),
                    "quote": m.get("cleaned_quote"),
                },
            )
    return total_calls


def load_substack_bodies_and_comments(conn) -> tuple[int, int]:
    """Push per-slug body + comment snapshots into the DB.

    Reads data/ingest/substack/bodies/{slug}.json and .../comments/{slug}.json
    for every episodes row that has a substack_slug. Returns
    (episodes_body_updated, comments_upserted).
    """
    bodies_dir = INGEST_RAW / "substack" / "bodies"
    comments_dir = INGEST_RAW / "substack" / "comments"
    rows = conn.execute(
        "SELECT id, substack_slug FROM episodes WHERE substack_slug IS NOT NULL"
    ).fetchall()
    bodies_updated = 0
    comments_upserted = 0
    for r in rows:
        ep_id = r["id"]
        slug = r["substack_slug"]
        if not slug:
            continue

        body_fp = bodies_dir / f"{slug}.json"
        if body_fp.exists():
            try:
                body_record = json.loads(body_fp.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                body_record = None
            if body_record and body_record.get("body"):
                conn.execute(
                    "UPDATE episodes SET substack_body = ? WHERE id = ?",
                    (body_record["body"], ep_id),
                )
                bodies_updated += 1

        comments_fp = comments_dir / f"{slug}.json"
        if comments_fp.exists():
            try:
                comments_list = json.loads(comments_fp.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                comments_list = []
            for c in comments_list or []:
                payload = dict(c)
                payload["episode_id"] = ep_id
                upsert_comment(conn, payload)
                comments_upserted += 1
    return bodies_updated, comments_upserted


def _normalize_hint(h: str) -> str:
    """Lower + collapse whitespace for fuzzy hint matching."""
    return re.sub(r"\s+", " ", (h or "").lower().strip())


def _find_call_id_by_hint(conn, episode_id: str, hint: str) -> int | None:
    """Best-effort match of an extracted hint to an existing calls.id.

    Strategy: exact-normalized first, else substring containment in either
    direction. Returns None if no plausible match.
    """
    norm = _normalize_hint(hint)
    if not norm:
        return None
    rows = conn.execute(
        "SELECT id, market_hint FROM calls WHERE episode_id = ?", (episode_id,)
    ).fetchall()
    # Exact normalized match
    for r in rows:
        if _normalize_hint(r["market_hint"]) == norm:
            return r["id"]
    # Substring either direction
    for r in rows:
        rn = _normalize_hint(r["market_hint"])
        if rn and (norm in rn or rn in norm):
            return r["id"]
    return None


def _find_call_id_cross_episode(conn, hint: str) -> tuple[int, str] | None:
    """Same as above but across all episodes — used by QA loader when the
    clarification doesn't carry an episode id. Returns (call_id, episode_id)
    or None.
    """
    norm = _normalize_hint(hint)
    if not norm:
        return None
    rows = conn.execute("SELECT id, episode_id, market_hint FROM calls").fetchall()
    for r in rows:
        if _normalize_hint(r["market_hint"]) == norm:
            return (r["id"], r["episode_id"])
    for r in rows:
        rn = _normalize_hint(r["market_hint"])
        if rn and (norm in rn or rn in norm):
            return (r["id"], r["episode_id"])
    return None


def load_principles(conn) -> int:
    """Load data/ingest/extract/*-principles.json into principles + principle_citations."""
    extract_dir = INGEST_RAW / "extract"
    if not extract_dir.exists():
        return 0
    files = sorted(extract_dir.glob("*-principles.json"))
    total = 0
    for fp in files:
        guid = fp.stem.replace("-principles", "")
        data = json.loads(fp.read_text(encoding="utf-8"))
        for p in data.get("principles", []):
            rule = (p.get("rule") or "").strip()
            if not rule:
                continue
            principle_id = upsert_principle(
                conn,
                {
                    "rule": rule,
                    "rationale": p.get("rationale"),
                    "first_episode_id": guid,
                },
            )
            total += 1
            for cit in p.get("citations", []) or []:
                insert_principle_citation(
                    conn,
                    {
                        "principle_id": principle_id,
                        "episode_id": guid,
                        "timestamp_sec": cit.get("timestamp_sec", 0),
                        "quote": cit.get("quote"),
                    },
                )
    return total


def load_strategies(conn) -> int:
    """Load data/ingest/extract/*-strategies.json into strategies + strategy_calls."""
    extract_dir = INGEST_RAW / "extract"
    if not extract_dir.exists():
        return 0
    files = sorted(extract_dir.glob("*-strategies.json"))
    total = 0
    for fp in files:
        guid = fp.stem.replace("-strategies", "")
        data = json.loads(fp.read_text(encoding="utf-8"))
        for s in data.get("strategies", []):
            name = (s.get("name") or "").strip()
            if not name:
                continue
            cur = conn.execute(
                """INSERT INTO strategies (name, episode_id, pattern_type, description)
                   VALUES (?, ?, ?, ?)""",
                (name, guid, s.get("pattern_type"), s.get("description")),
            )
            strategy_id = cur.lastrowid
            total += 1
            for hint in s.get("call_market_hints", []) or []:
                call_id = _find_call_id_by_hint(conn, guid, hint)
                if call_id is None:
                    continue
                conn.execute(
                    """INSERT OR IGNORE INTO strategy_calls (strategy_id, call_id)
                       VALUES (?, ?)""",
                    (strategy_id, call_id),
                )
    return total


def load_sagas(conn) -> int:
    """Load data/ingest/extract/_sagas.json into sagas + saga_episodes."""
    extract_dir = INGEST_RAW / "extract"
    fp = extract_dir / "_sagas.json"
    if not fp.exists():
        return 0
    data = json.loads(fp.read_text(encoding="utf-8"))
    total = 0
    for s in data.get("sagas", []):
        name = (s.get("name") or "").strip()
        if not name:
            continue
        # Avoid duplicate sagas by name (idempotent re-runs)
        row = conn.execute("SELECT id FROM sagas WHERE name = ?", (name,)).fetchone()
        if row:
            saga_id = row["id"]
        else:
            cur = conn.execute(
                "INSERT INTO sagas (name, market_id, status) VALUES (?, ?, ?)",
                (name, None, "live"),
            )
            saga_id = cur.lastrowid
            total += 1
        for ep_id in s.get("episode_ids", []) or []:
            conn.execute(
                """INSERT OR IGNORE INTO saga_episodes (saga_id, episode_id)
                   VALUES (?, ?)""",
                (saga_id, ep_id),
            )
    return total


def load_qa(conn) -> int:
    """Load data/ingest/extract/*-qa.json into call_clarifications.

    For each clarification, fuzzy-match `clarifies_about` to an existing call
    (within the same episode first, then cross-episode as fallback) and link
    it via call_clarifications.
    """
    extract_dir = INGEST_RAW / "extract"
    if not extract_dir.exists():
        return 0
    files = sorted(extract_dir.glob("*-qa.json"))
    total = 0
    for fp in files:
        guid = fp.stem.replace("-qa", "")
        data = json.loads(fp.read_text(encoding="utf-8"))
        for cl in data.get("clarifications", []):
            comment_id = cl.get("comment_id")
            clarifies = cl.get("clarifies_about") or ""
            if not comment_id or not clarifies:
                continue
            call_id = _find_call_id_by_hint(conn, guid, clarifies)
            if call_id is None:
                found = _find_call_id_cross_episode(conn, clarifies)
                call_id = found[0] if found else None
            if call_id is None:
                continue
            text_parts = []
            q = (cl.get("question") or "").strip()
            a = (cl.get("stu_answer") or "").strip()
            if q:
                text_parts.append(f"Q: {q}")
            if a:
                text_parts.append(f"A: {a}")
            clarification_text = " | ".join(text_parts) or clarifies
            conn.execute(
                """INSERT INTO call_clarifications
                    (call_id, comment_id, clarification, extracted_value)
                   VALUES (?, ?, ?, ?)""",
                (call_id, comment_id, clarification_text, cl.get("extracted_value")),
            )
            total += 1
    return total


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--episodes-only", action="store_true")
    args = p.parse_args()

    init_db()
    with connect() as conn:
        n_eps = load_episodes(conn)
        print(f"[load] episodes upserted: {n_eps}")
        if not args.episodes_only:
            n_calls = load_calls(conn)
            print(f"[load] calls inserted: {n_calls}")
            n_bodies, n_comments = load_substack_bodies_and_comments(conn)
            print(f"[load] substack bodies updated: {n_bodies}")
            print(f"[load] substack comments upserted: {n_comments}")
            n_principles = load_principles(conn)
            print(f"[load] principles upserted: {n_principles}")
            n_strategies = load_strategies(conn)
            print(f"[load] strategies inserted: {n_strategies}")
            n_sagas = load_sagas(conn)
            print(f"[load] sagas inserted: {n_sagas}")
            n_qa = load_qa(conn)
            print(f"[load] call_clarifications inserted: {n_qa}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
