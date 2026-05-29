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
import hashlib
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
from pipeline.extract.tagger import tag_call
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


def _stable_call_id(episode_id: str, market_hint: str, side: str, ordinal: int) -> int:
    """Deterministic call id from a natural key so /calls/{id} URLs survive the
    DELETE+reinsert that load_calls does every run.

    Key = episode_id | normalized hint | side | ordinal (ordinal disambiguates
    two calls on the same market+side within one episode). Truncated to 52 bits
    so it stays inside JS Number.MAX_SAFE_INTEGER (the frontend types id as
    number). Collision risk across ~hundreds of calls is negligible."""
    key = f"{episode_id}|{_normalize_hint(market_hint)}|{(side or '').strip().lower()}|{ordinal}"
    return int(hashlib.sha1(key.encode("utf-8")).hexdigest()[:13], 16)


def _transcript_for(guid: str) -> dict | None:
    p = TRANSCRIPTS / f"{_safe_guid(guid)}.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def _title_overlap(a: str, b: str) -> float:
    """Crude title-similarity score in [0,1]: Jaccard over lowercased word sets,
    ignoring short stopword-ish tokens. Used to pick which same-day Megaphone
    episode a Substack podcast post belongs to."""
    def toks(s: str) -> set[str]:
        return {w for w in re.findall(r"[a-z0-9]+", (s or "").lower()) if len(w) > 2}

    ta, tb = toks(a), toks(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def _assign_podcast_posts(
    eps: list[dict], sub_by_date: dict[str, list[dict]]
) -> dict[str, dict]:
    """Assign each Substack PODCAST post to at most one Megaphone episode, 1:1.

    For each publish-date, consider all (episode, podcast-post) pairs and assign
    greedily in descending title-overlap order, so the strongest title match
    wins the post — independent of the order episodes appear in the snapshot.
    This fixes the old date-prefix join where two same-day episodes both grabbed
    the same post (and the prior greedy-first variant where whichever episode was
    listed first claimed it regardless of title fit).

    Returns {episode_guid: post} for episodes that got a podcast post.
    """
    by_guid: dict[str, dict] = {}
    # Group episodes by date alongside the posts.
    eps_by_date: dict[str, list[dict]] = {}
    for ep in eps:
        eps_by_date.setdefault(ep["pub_date"][:10], []).append(ep)

    for date, day_eps in eps_by_date.items():
        posts = [
            p
            for p in sub_by_date.get(date, [])
            if p.get("type") == "podcast" and p.get("slug")
        ]
        if not posts:
            continue
        # All candidate pairs, best overlap first. Ties fall back to snapshot
        # order, which is deterministic.
        pairs = [
            (_title_overlap(ep["title"], p.get("title") or ""), ei, pi, ep, p)
            for ei, ep in enumerate(day_eps)
            for pi, p in enumerate(posts)
        ]
        pairs.sort(key=lambda t: (-t[0], t[1], t[2]))
        taken_eps: set[str] = set()
        taken_posts: set[str] = set()
        for _score, _ei, _pi, ep, p in pairs:
            if ep["guid"] in taken_eps or p["slug"] in taken_posts:
                continue
            by_guid[ep["guid"]] = p
            taken_eps.add(ep["guid"])
            taken_posts.add(p["slug"])
    return by_guid


def load_episodes(conn) -> int:
    """Load Megaphone episodes + matching Substack podcast posts, then create
    standalone 'article' episodes for newsletter posts that have no audio twin.

    Matching rules:
    - A Megaphone episode attaches the same-date Substack post whose
      type == 'podcast' (the audio version of the same content). Each post
      attaches to at most ONE episode (tracked via `used_slugs`); when several
      same-date podcast posts exist, the closest title match wins.
    - Newsletter posts (type == 'newsletter') whose slug was NOT attached to a
      Megaphone episode become standalone articles (id 'substack:{slug}',
      type 'article') so text-only writeups are first-class.
    """
    mega = _latest_snapshot("megaphone")
    if not mega:
        print("[load] no megaphone snapshot found — run pipeline.ingest.megaphone first")
        return 0
    eps = json.loads(mega.read_text(encoding="utf-8"))

    # Group Substack posts by publish-date prefix (YYYY-MM-DD). We keep the full
    # list per date (not just the first) so 1:1 matching can pick the right one
    # when two episodes/posts share a day.
    sub_by_date: dict[str, list[dict]] = {}
    sub_snap = _latest_snapshot("substack", prefix="archive-")
    if sub_snap:
        for post in json.loads(sub_snap.read_text(encoding="utf-8")):
            d = (post.get("post_date") or "")[:10]
            if d:
                sub_by_date.setdefault(d, []).append(post)

    # 1:1 assignment of podcast posts to episodes (order-independent, best
    # title match wins). Tracks which slugs are spoken for so the article pass
    # below only creates standalone rows for genuinely unattached newsletters.
    assigned = _assign_podcast_posts(eps, sub_by_date)
    used_slugs: set[str] = {p["slug"] for p in assigned.values()}

    count = 0
    for ep in eps:
        guid = ep["guid"]
        pub_date_iso = ep["pub_date"][:10]
        mega_title = ep["title"]

        sub = assigned.get(guid)

        transcript = _transcript_for(guid)

        row = {
            "id": guid,
            "publish_date": pub_date_iso,
            "type": "episode",
            "megaphone_title": mega_title,
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

    # Standalone articles: every newsletter post whose slug wasn't claimed by a
    # Megaphone episode. Podcast posts that simply lacked a Megaphone twin are
    # intentionally skipped — articles are text-only writeups, not audio.
    articles = 0
    for posts in sub_by_date.values():
        for post in posts:
            slug = post.get("slug")
            if not slug or slug in used_slugs:
                continue
            if post.get("type") != "newsletter":
                continue
            used_slugs.add(slug)
            row = {
                "id": f"substack:{slug}",
                "publish_date": (post.get("post_date") or "")[:10],
                "type": "article",
                "megaphone_title": None,
                "youtube_title": None,
                "substack_title": post.get("title"),
                "youtube_id": None,
                "substack_slug": slug,
                "audio_url": None,
                "duration_sec": None,
                "view_count": None,
                "like_count": None,
                "comment_count": None,
                "transcript_text": None,
                "substack_body": None,  # filled by Substack body pull
                "chapter_json": None,
                "cover_image_url": post.get("cover_image"),
            }
            upsert_episode(conn, row)
            articles += 1
            count += 1
    if articles:
        print(f"[load]   ({articles} standalone newsletter articles)")
    return count


def load_calls(conn) -> int:
    """Load Claude extraction output (data/ingest/extract/*-calls.json).

    Idempotent per episode: each *-calls.json file is the source of truth for
    that episode's calls + events + mentions + source_media. Re-running clears
    the episode's prior rows and re-inserts from JSON, so the DB always matches.

    Enrich-owned columns (market_id, status, realized_pct, stu_claimed_pct) are
    PRESERVED across the reload, keyed by the deterministic stable call id. Those
    are computed by market_resolver / scoring and must not be reset to NULL/open
    every cycle — otherwise the resolver has to re-link from scratch each run,
    only the cleanest (winning) markets re-link, and the scoreboard shows an
    inflated 100% from survivorship bias.
    """
    extract_dir = INGEST_RAW / "extract"
    if not extract_dir.exists():
        return 0
    _ensure_calls_columns(conn)  # admin `hidden` column (re-stamped by apply_admin)
    files = sorted(extract_dir.glob("*-calls.json"))
    total_calls = 0
    for fp in files:
        guid = fp.stem.replace("-calls", "")
        # Snapshot enrich-owned columns by stable id before wiping, so links +
        # scores survive the DELETE+reinsert.
        preserved = {
            r["id"]: {
                "market_id": r["market_id"],
                "status": r["status"],
                "realized_pct": r["realized_pct"],
                "stu_claimed_pct": r["stu_claimed_pct"],
                # `notes` carries human pins like 'pin:no-auto-link' (a verified
                # false-match correction). Must survive reload or the cron's
                # resolver would re-link the bad market.
                "notes": r["notes"],
            }
            for r in conn.execute(
                """SELECT id, market_id, status, realized_pct, stu_claimed_pct, notes
                     FROM calls WHERE episode_id = ?""",
                (guid,),
            ).fetchall()
        }
        # Wipe this episode's existing rows so re-loading from JSON doesn't dup.
        # FK order: every table that references calls.id must be cleared BEFORE
        # the calls delete, or the DELETE fails the FK check. That includes
        # strategy_calls and call_clarifications (populated by load_strategies /
        # load_qa) — re-created later in this same load run.
        conn.execute(
            "DELETE FROM call_events WHERE call_id IN (SELECT id FROM calls WHERE episode_id = ?)",
            (guid,),
        )
        conn.execute(
            "DELETE FROM source_media WHERE call_id IN (SELECT id FROM calls WHERE episode_id = ?)",
            (guid,),
        )
        conn.execute(
            "DELETE FROM strategy_calls WHERE call_id IN (SELECT id FROM calls WHERE episode_id = ?)",
            (guid,),
        )
        conn.execute(
            "DELETE FROM call_clarifications WHERE call_id IN (SELECT id FROM calls WHERE episode_id = ?)",
            (guid,),
        )
        conn.execute("DELETE FROM calls WHERE episode_id = ?", (guid,))
        conn.execute("DELETE FROM mentions WHERE episode_id = ?", (guid,))
        data = json.loads(fp.read_text(encoding="utf-8"))
        # Episode title is used as extra context for the deterministic tagger.
        ep_row = conn.execute(
            "SELECT megaphone_title FROM episodes WHERE id = ?", (guid,)
        ).fetchone()
        ep_title = (ep_row["megaphone_title"] if ep_row else "") or ""
        # Track (hint, side) repeats within the episode so two calls on the same
        # market+side get distinct stable ids via an ordinal suffix.
        key_ordinals: dict[tuple[str, str], int] = {}
        for call in data.get("calls", []):
            # Find earliest event timestamp
            events = sorted(call.get("events", []), key=lambda e: e.get("timestamp_sec", 0))
            first_ts = events[0].get("timestamp_sec") if events else None

            hint = call.get("market_hint", "")
            side = call.get("side", "yes")
            base_key = (_normalize_hint(hint), (side or "").strip().lower())
            ordinal = key_ordinals.get(base_key, 0)
            key_ordinals[base_key] = ordinal + 1
            stable_id = _stable_call_id(guid, hint, side, ordinal)

            # If the source JSON already declared tags, honor it; else derive.
            existing_tags = call.get("tags")
            if isinstance(existing_tags, list) and existing_tags:
                tags = list(existing_tags)
            else:
                # Grab a representative quote for context (entry preferred).
                quote_blob = " ".join(
                    (e.get("raw_quote") or e.get("cleaned_quote") or "")
                    for e in events[:3]
                )
                tags = tag_call(
                    market_hint=call.get("market_hint", ""),
                    episode_title=ep_title,
                    raw_quote=quote_blob,
                )

            prev = preserved.get(stable_id)
            row = {
                "id": stable_id,
                # Preserve the resolver's link + scoring's status across reload;
                # fall back to fresh defaults for genuinely new calls.
                "market_id": prev["market_id"] if prev else None,
                "market_hint": hint,
                "episode_id": guid,
                "first_event_ts": first_ts,
                "side": side,
                "conviction": call.get("conviction", "opinion"),
                "size_disclosed": call.get("size_disclosed"),
                "speaker": call.get("speaker", "stu"),
                "status": prev["status"] if prev else "open",
                "notes": prev["notes"] if prev else None,
                "tags": tags,
            }
            call_id = insert_call(conn, row)
            # Restore scoring outputs (not columns insert_call writes).
            if prev and (prev["realized_pct"] is not None or prev["stu_claimed_pct"] is not None):
                conn.execute(
                    "UPDATE calls SET realized_pct = ?, stu_claimed_pct = ? WHERE id = ?",
                    (prev["realized_pct"], prev["stu_claimed_pct"], call_id),
                )
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


_EFFECTIVE_COLS = {
    "effective_resolution": "TEXT",
    "effective_detail": "TEXT",
    "effective_event_date": "TEXT",
    "effective_source": "TEXT",
    "effective_confidence": "TEXT",
}


def _ensure_effective_columns(conn) -> None:
    """Self-migrate: add markets.effective_* to pre-existing DBs. schema.sql
    carries them for fresh builds; CREATE TABLE IF NOT EXISTS won't alter an
    already-created table, so add any missing column here. Idempotent."""
    existing = {r["name"] for r in conn.execute("PRAGMA table_info(markets)")}
    for col, typ in _EFFECTIVE_COLS.items():
        if col not in existing:
            conn.execute(f"ALTER TABLE markets ADD COLUMN {col} {typ}")


def _ensure_calls_columns(conn) -> None:
    """Self-migrate the admin `calls.hidden` column onto pre-existing DBs (same
    reason as _ensure_effective_columns — CREATE TABLE IF NOT EXISTS won't alter
    an existing table). `hidden` is owned by enrich/apply_admin, NOT preserved
    across reload: load_calls reinserts with the default 0 and apply_admin
    re-stamps it later in the same refresh. Idempotent."""
    existing = {r["name"] for r in conn.execute("PRAGMA table_info(calls)")}
    if "hidden" not in existing:
        conn.execute("ALTER TABLE calls ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_calls_hidden ON calls(hidden)")


def load_resolutions(conn) -> int:
    """Load researched 'effective' resolutions (LLM + web research, with a cited
    source) from data/ingest/resolutions/*.json into markets.effective_*.

    Each file resolves ONE market's real-world outcome for the case where the
    event is clearly over but the exchange hasn't formally settled — or set a
    bogus far-future close date (e.g. Kalshi's +1-year margin-of-victory
    markets). Applied only when the resolution is a clean 'yes'/'no'; a
    null/pending file is skipped (an honest unknown beats a fabricated result).
    Distinct from `resolved`/`resolution`, which stay reserved for an actual
    exchange settlement. Idempotent — re-running overwrites with file content.
    """
    res_dir = INGEST_RAW / "resolutions"
    if not res_dir.exists():
        return 0
    _ensure_effective_columns(conn)
    applied = 0
    for fp in sorted(res_dir.glob("*.json")):
        try:
            d = json.loads(fp.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        mid = d.get("market_id")
        res = (d.get("resolution") or "").strip().lower()
        if not mid or res not in ("yes", "no"):
            continue  # pending / malformed → leave the market unresolved
        if not conn.execute("SELECT 1 FROM markets WHERE id = ?", (mid,)).fetchone():
            continue  # market not present yet (created later by resolver) → next cycle
        conn.execute(
            """UPDATE markets SET
                 effective_resolution = ?, effective_detail = ?,
                 effective_event_date = ?, effective_source = ?,
                 effective_confidence = ?, updated_at = CURRENT_TIMESTAMP
               WHERE id = ?""",
            (
                res,
                d.get("outcome_detail"),
                d.get("event_date"),
                d.get("source_url"),
                d.get("confidence"),
                mid,
            ),
        )
        applied += 1
    return applied


def recompute_first_event_ts(conn) -> int:
    """Backfill calls.first_event_ts from MIN(call_events.timestamp_sec).

    Catches calls that were manually inserted (no `events` array in their
    source JSON) or where events were added out-of-band after the call row.
    Updates rows where first_event_ts disagrees with the events table OR
    is NULL while events exist. Returns the number of rows touched.
    """
    fixed = conn.execute(
        """
        UPDATE calls
        SET first_event_ts = (
            SELECT MIN(timestamp_sec) FROM call_events WHERE call_id = calls.id
        )
        WHERE EXISTS (SELECT 1 FROM call_events WHERE call_id = calls.id)
          AND (
            first_event_ts IS NULL
            OR first_event_ts <> (SELECT MIN(timestamp_sec) FROM call_events WHERE call_id = calls.id)
          )
        """
    ).rowcount
    return fixed


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
        # Idempotent per-episode: drop this episode's prior strategies (and their
        # strategy_calls links) before re-inserting, so repeated loads don't
        # accumulate duplicate strategy rows.
        for old in conn.execute(
            "SELECT id FROM strategies WHERE episode_id = ?", (guid,)
        ).fetchall():
            conn.execute("DELETE FROM strategy_calls WHERE strategy_id = ?", (old["id"],))
        conn.execute("DELETE FROM strategies WHERE episode_id = ?", (guid,))
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
        _ensure_calls_columns(conn)  # admin `hidden` column on pre-existing DBs
        n_eps = load_episodes(conn)
        print(f"[load] episodes upserted: {n_eps}")
        if not args.episodes_only:
            n_calls = load_calls(conn)
            print(f"[load] calls inserted: {n_calls}")
            n_res = load_resolutions(conn)
            print(f"[load] effective resolutions applied: {n_res}")
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
            n_first_ts = recompute_first_event_ts(conn)
            print(f"[load] calls.first_event_ts recomputed: {n_first_ts}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
