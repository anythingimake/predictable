"""
SQLite layer for the pipeline. Initializes schema and provides upsert helpers
the loaders use to push ingested + extracted data into data/predictable.sqlite.
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterable

from pipeline.paths import REPO, SQLITE

SCHEMA_PATH = REPO / "api" / "src" / "schema.sql"


def init_db(db_path: Path = SQLITE) -> None:
    """Create the SQLite file + tables if not present. Idempotent."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")
    with sqlite3.connect(db_path) as conn:
        conn.executescript(schema_sql)
        conn.commit()


@contextmanager
def connect(db_path: Path = SQLITE):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


# ----- Upserts -----


def upsert_episode(conn: sqlite3.Connection, ep: dict) -> None:
    """ep keys: id, publish_date, type, megaphone_title, youtube_title, substack_title,
    youtube_id, substack_slug, audio_url, duration_sec, view_count, like_count,
    comment_count, transcript_text, substack_body, chapter_json, cover_image_url."""
    cols = (
        "id publish_date type megaphone_title youtube_title substack_title "
        "youtube_id substack_slug audio_url duration_sec view_count like_count "
        "comment_count transcript_text substack_body chapter_json cover_image_url"
    ).split()
    values = tuple(ep.get(c) for c in cols)
    placeholders = ", ".join(["?"] * len(cols))
    col_list = ", ".join(cols)
    update_clause = ", ".join(f"{c}=excluded.{c}" for c in cols if c != "id")
    conn.execute(
        f"""INSERT INTO episodes ({col_list}) VALUES ({placeholders})
            ON CONFLICT(id) DO UPDATE SET {update_clause}""",
        values,
    )


def upsert_market(conn: sqlite3.Connection, m: dict) -> str:
    """m keys: source, ticker, question, category, subject_tags (list/json), resolution_date,
    resolved (bool), resolution, current_price, meta_json (dict or str). Returns market id."""
    mid = f"{m['source']}:{m['ticker']}"
    subject_tags = m.get("subject_tags")
    if isinstance(subject_tags, (list, dict)):
        subject_tags = json.dumps(subject_tags)
    meta_json = m.get("meta_json")
    if isinstance(meta_json, (dict, list)):
        meta_json = json.dumps(meta_json)
    conn.execute(
        """INSERT INTO markets (id, source, ticker, question, category, subject_tags,
                                 resolution_date, resolved, resolution, current_price, meta_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             question=excluded.question,
             category=excluded.category,
             subject_tags=excluded.subject_tags,
             resolution_date=excluded.resolution_date,
             resolved=excluded.resolved,
             resolution=excluded.resolution,
             current_price=excluded.current_price,
             meta_json=excluded.meta_json,
             updated_at=CURRENT_TIMESTAMP""",
        (
            mid,
            m["source"],
            m["ticker"],
            m.get("question", ""),
            m.get("category"),
            subject_tags,
            m.get("resolution_date"),
            1 if m.get("resolved") else 0,
            m.get("resolution"),
            m.get("current_price"),
            meta_json,
        ),
    )
    return mid


def insert_call(conn: sqlite3.Connection, call: dict) -> int:
    """Insert a Call. If `call['id']` is provided, insert with that explicit id
    (the loader passes a deterministic stable id so /calls/{id} URLs survive
    re-loads); otherwise fall back to auto-increment.

    `tags` is a JSON-encoded array of strings. If the caller passes a list,
    we json.dumps it; if a string, we trust it's already JSON; if missing,
    default to '[]' (the loader is expected to fill this via tag_call).
    """
    raw_tags = call.get("tags", "[]")
    if isinstance(raw_tags, (list, tuple)):
        tags_json = json.dumps(list(raw_tags))
    else:
        tags_json = raw_tags or "[]"

    explicit_id = call.get("id")
    if explicit_id is not None:
        conn.execute(
            """INSERT INTO calls (id, market_id, market_hint, episode_id, first_event_ts,
                                  side, conviction, size_disclosed, speaker, status, notes, tags)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                explicit_id,
                call.get("market_id"),
                call["market_hint"],
                call["episode_id"],
                call.get("first_event_ts"),
                call["side"],
                call["conviction"],
                call.get("size_disclosed"),
                call.get("speaker", "stu"),
                call.get("status", "open"),
                call.get("notes"),
                tags_json,
            ),
        )
        return explicit_id

    cur = conn.execute(
        """INSERT INTO calls (market_id, market_hint, episode_id, first_event_ts,
                              side, conviction, size_disclosed, speaker, status, notes, tags)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            call.get("market_id"),
            call["market_hint"],
            call["episode_id"],
            call.get("first_event_ts"),
            call["side"],
            call["conviction"],
            call.get("size_disclosed"),
            call.get("speaker", "stu"),
            call.get("status", "open"),
            call.get("notes"),
            tags_json,
        ),
    )
    return cur.lastrowid


def insert_call_event(conn: sqlite3.Connection, ev: dict) -> int:
    cur = conn.execute(
        """INSERT INTO call_events (call_id, episode_id, timestamp_sec, event_type,
                                    price_pct, size_pct_of_pos, quote, raw_quote)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            ev["call_id"],
            ev["episode_id"],
            ev["timestamp_sec"],
            ev["event_type"],
            ev.get("price_pct"),
            ev.get("size_pct_of_pos"),
            ev.get("quote"),
            ev.get("raw_quote"),
        ),
    )
    return cur.lastrowid


def insert_mention(conn: sqlite3.Connection, m: dict) -> int:
    cur = conn.execute(
        """INSERT INTO mentions (market_id, market_hint, episode_id, timestamp_sec,
                                 directional, quote)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (
            m.get("market_id"),
            m["market_hint"],
            m["episode_id"],
            m["timestamp_sec"],
            m.get("directional"),
            m.get("quote"),
        ),
    )
    return cur.lastrowid


def insert_source_media(conn: sqlite3.Connection, sm: dict) -> int:
    cur = conn.execute(
        """INSERT INTO source_media (call_id, mention_id, episode_id, url,
                                     source_type, outlet, title)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            sm.get("call_id"),
            sm.get("mention_id"),
            sm["episode_id"],
            sm.get("url"),
            sm.get("source_type"),
            sm.get("outlet"),
            sm.get("title"),
        ),
    )
    return cur.lastrowid


def upsert_comment(conn: sqlite3.Connection, c: dict) -> None:
    conn.execute(
        """INSERT INTO comments (id, episode_id, author, body, posted_at, is_stu, parent_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET body=excluded.body""",
        (
            c["id"],
            c["episode_id"],
            c["author"],
            c["body"],
            c.get("posted_at"),
            1 if c.get("is_stu") else 0,
            c.get("parent_id"),
        ),
    )


def upsert_principle(conn: sqlite3.Connection, p: dict) -> int:
    """Insert if rule not present (case-insensitive); else return existing id."""
    existing = conn.execute(
        "SELECT id FROM principles WHERE LOWER(rule) = LOWER(?)", (p["rule"],)
    ).fetchone()
    if existing:
        return existing["id"]
    cur = conn.execute(
        "INSERT INTO principles (rule, rationale, first_episode_id) VALUES (?, ?, ?)",
        (p["rule"], p.get("rationale"), p["first_episode_id"]),
    )
    return cur.lastrowid


def insert_principle_citation(conn: sqlite3.Connection, pc: dict) -> None:
    conn.execute(
        """INSERT OR IGNORE INTO principle_citations
            (principle_id, episode_id, timestamp_sec, quote)
           VALUES (?, ?, ?, ?)""",
        (pc["principle_id"], pc["episode_id"], pc.get("timestamp_sec", 0), pc.get("quote")),
    )


def record_price_snapshot(conn: sqlite3.Connection, market_id: str, date: str,
                          price: float, volume: float | None = None) -> None:
    conn.execute(
        """INSERT INTO market_price_snapshots (market_id, snapshot_date, price, volume)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(market_id, snapshot_date) DO UPDATE SET
             price=excluded.price, volume=excluded.volume""",
        (market_id, date, price, volume),
    )


if __name__ == "__main__":
    init_db()
    with connect() as conn:
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
    print(f"DB initialized at {SQLITE}")
    print(f"Tables ({len(tables)}): {', '.join(tables)}")
