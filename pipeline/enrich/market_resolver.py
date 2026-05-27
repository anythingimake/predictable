"""
Resolve free-text `market_hint` strings (what Stu said on-air) to concrete
prediction markets on Kalshi or Polymarket.

For each call where `market_id IS NULL`:
  1. Pull candidates from Kalshi (events -> markets) and Polymarket (public-search).
  2. Run `match_market(hint, candidates)` — a deterministic heuristic ranker
     using fuzzy title overlap + recency. Returns the best plausible candidate
     or None.
  3. If matched: upsert the market and stamp `calls.market_id`.
  4. If not: append a row to `data/logs/unresolved_markets-{date}.json` for
     human review.

Idempotent — only touches calls with NULL market_id.

This module is structured so the matching can be replaced by an LLM later,
but the default `match_market()` works without any LLM available — needed
for unattended cron runs.
"""
from __future__ import annotations

import json
import re
from datetime import date, datetime, timezone
from difflib import SequenceMatcher
from typing import Optional

import requests

from pipeline.db import connect, upsert_market
from pipeline.ingest import kalshi, polymarket
from pipeline.paths import LOGS


# ----- Stopwords (drop generic filler before title-similarity scoring) -----

_STOPWORDS = frozenset(
    {
        "the", "a", "an", "of", "in", "on", "at", "to", "for", "by", "with",
        "and", "or", "but", "is", "are", "was", "were", "be", "been", "being",
        "will", "would", "should", "could", "may", "might", "must", "shall",
        "have", "has", "had", "do", "does", "did", "this", "that", "these",
        "those", "i", "you", "he", "she", "it", "we", "they", "what", "which",
        "who", "whom", "when", "where", "why", "how", "all", "any", "some",
        "no", "not", "only", "own", "same", "so", "than", "too", "very",
        "more", "most", "vs", "vs.", "market", "markets", "bet", "contract",
        "kalshi", "polymarket", "predictit",
    }
)


def _tokens(s: str) -> set[str]:
    s = (s or "").lower()
    parts = re.findall(r"[a-z0-9]+", s)
    return {p for p in parts if p and p not in _STOPWORDS and len(p) > 1}


def _title_overlap(hint: str, title: str) -> float:
    """Jaccard overlap of meaningful tokens, blended with sequence ratio."""
    a, b = _tokens(hint), _tokens(title)
    if not a or not b:
        return 0.0
    jac = len(a & b) / len(a | b)
    seq = SequenceMatcher(None, (hint or "").lower(), (title or "").lower()).ratio()
    return 0.7 * jac + 0.3 * seq


def _recency_bonus(end_iso: str | None) -> float:
    """Small bonus for markets ending soonest after today (still open or just-closed).
    Decays sharply for very-old or very-far-away end dates."""
    if not end_iso:
        return 0.0
    try:
        # accept "2026-05-30T22:35:00Z" and "2026-05-30"
        s = end_iso.replace("Z", "+00:00")
        end = datetime.fromisoformat(s if "T" in s else f"{s}T00:00:00+00:00")
    except (ValueError, TypeError):
        return 0.0
    today = datetime.now(timezone.utc)
    days = abs((end - today).days)
    # peak at 0 days away, half-life ~60 days
    return 0.05 * (1.0 / (1.0 + days / 60.0))


# ----- Candidate gatherers -----

# Module-level event cache — populated lazily on first hint, reused for all
# subsequent hints in the same run. Kalshi's `/events` is the same response
# regardless of hint, so re-fetching per hint just wastes time.
_KALSHI_EVENTS_CACHE: list[dict] | None = None


def _kalshi_events() -> list[dict]:
    """Pull BOTH open and recently-settled events, paginated. Stu's calls
    routinely target markets that have already moved to 'settled' by the time
    we run; the old open-only path was a real gap (missed the Paxton +20%
    margin market that was the headline of the May 27 episode)."""
    global _KALSHI_EVENTS_CACHE
    if _KALSHI_EVENTS_CACHE is not None:
        return _KALSHI_EVENTS_CACHE
    out: list[dict] = []
    seen: set[str] = set()
    for status in ("open", "settled", "closed"):
        cursor: str | None = None
        for _ in range(8):  # ≤ 1600 events per status — enough for v1
            params: dict = {"status": status, "limit": 200}
            if cursor:
                params["cursor"] = cursor
            try:
                r = requests.get(
                    "https://api.elections.kalshi.com/trade-api/v2/events",
                    params=params,
                    headers={"User-Agent": "predictable-pipeline/1.0"},
                    timeout=20,
                )
                if not r.ok:
                    break
                data = r.json()
            except requests.RequestException:
                break
            for e in data.get("events", []) or []:
                tk = e.get("event_ticker")
                if tk and tk not in seen:
                    seen.add(tk)
                    out.append(e)
            cursor = data.get("cursor")
            if not cursor:
                break
    _KALSHI_EVENTS_CACHE = out
    return out


def _kalshi_candidates(hint: str, max_events: int = 8, max_markets: int = 12) -> list[dict]:
    """Pull cached Kalshi events (open + settled), fuzzy-pick top N by title
    overlap, then expand each to its markets so the matcher can pick the right
    contract within an event (e.g., the +20% margin variant within a margin-of-
    victory event).

    Conservative caps (8 events × 12 markets) — wide enough to catch the actual
    market in events like KXTXRSENRUNOFFMOV (10 brackets), tight enough to keep
    per-hint cost bounded.
    """
    evts = _kalshi_events()
    if not evts:
        return []
    scored = sorted(
        ((_title_overlap(hint, e.get("title", "")), e) for e in evts),
        key=lambda t: t[0],
        reverse=True,
    )
    top_events = [e for s, e in scored[:max_events] if s > 0.05]
    out: list[dict] = []
    for evt in top_events:
        ticker = evt.get("event_ticker")
        if not ticker:
            continue
        # Pull markets in this event regardless of status — Stu's calls often
        # land on contracts that have already settled.
        for status in (None, "settled"):
            try:
                params: dict = {"event_ticker": ticker, "limit": max_markets}
                if status:
                    params["status"] = status
                ms = kalshi.search_markets(**{k: v for k, v in params.items() if k in {"event_ticker", "status"}}, limit=max_markets)
            except (requests.RequestException, TypeError):
                continue
            for m in ms:
                out.append(_normalize_kalshi(m, evt))
            if ms:
                break
        if len(out) >= 60:
            break
    return out


def _normalize_kalshi(m: dict, evt: dict | None = None) -> dict:
    """Reduce a Kalshi market dict to the dict shape `upsert_market` expects + a
    `_title` field used by the matcher.

    For margin-of-victory events the contract title carries the discriminating
    info (e.g., "...by between 20% and 100%"), so we keep the contract title
    primary and append the event context, not the other way around.
    """
    contract_title = m.get("title") or m.get("yes_sub_title") or ""
    evt_title = (evt or {}).get("title", "")
    title = contract_title or evt_title
    # Build a `_title` for matching that includes both the contract specifics
    # AND the event context — gives the matcher the most signal.
    match_title = " — ".join(t for t in (evt_title, contract_title) if t)
    last_price = m.get("last_price_dollars")
    try:
        price = float(last_price if last_price not in (None, "") else (m.get("yes_ask_dollars") or 0.0))
    except (TypeError, ValueError):
        price = None
    # Resolution inference: if status is settled OR last_price is near 0 or 100
    # (binary contracts settle at $0 or $1), trust that as the resolution signal.
    status = (m.get("status") or "").lower()
    resolved = status in {"settled", "closed", "finalized"}
    resolution = (m.get("result") or "").lower() or None
    if not resolution and price is not None:
        if price >= 0.95:
            resolution = "yes"; resolved = True
        elif price <= 0.05:
            resolution = "no"; resolved = True
    return {
        "source": "kalshi",
        "ticker": m["ticker"],
        "question": title,
        "category": (evt or {}).get("category") or m.get("category"),
        "subject_tags": None,
        "resolution_date": (m.get("close_time") or "")[:10] or None,
        "resolved": resolved,
        "resolution": resolution,
        "current_price": price,
        "meta_json": {"event_ticker": m.get("event_ticker"), "status": status},
        "_title": match_title or title,
        "_end": m.get("close_time"),
    }


def _polymarket_candidates(hint: str, limit: int = 10) -> list[dict]:
    """Polymarket's gamma-api `q` param is keyword-poor; use /public-search instead.
    Returns normalized market dicts (one per outcome market within matched events)."""
    try:
        r = requests.get(
            "https://gamma-api.polymarket.com/public-search",
            params={"q": hint, "limit": limit},
            headers={"User-Agent": "predictable-pipeline/1.0"},
            timeout=15,
        )
        r.raise_for_status()
        data = r.json()
    except requests.RequestException:
        return []
    events = (data or {}).get("events") or []
    out: list[dict] = []
    for evt in events:
        for m in (evt.get("markets") or []):
            out.append(_normalize_poly(m, evt))
    # If /public-search has no results, fall back to gamma /markets q (weak, but try)
    if not out:
        try:
            ms = polymarket.search_markets(query=hint, limit=15)
            for m in ms:
                out.append(_normalize_poly(m, None))
        except requests.RequestException:
            pass
    return out


def _normalize_poly(m: dict, evt: dict | None) -> dict:
    # Pick the YES-side price if available
    try:
        prices = m.get("outcomePrices")
        if isinstance(prices, str):
            prices = json.loads(prices)
        price = float(prices[0]) if prices else None
    except (TypeError, ValueError, IndexError, json.JSONDecodeError):
        price = None
    title = m.get("question") or (evt or {}).get("title") or ""
    end = m.get("endDate") or (evt or {}).get("endDate")
    closed = bool(m.get("closed"))
    return {
        "source": "polymarket",
        "ticker": m.get("slug") or m.get("conditionId") or m.get("id"),
        "question": title,
        "category": (evt or {}).get("category"),
        "subject_tags": (evt or {}).get("tags"),
        "resolution_date": (end or "")[:10] or None,
        "resolved": closed,
        "resolution": m.get("umaResolutionStatus"),
        "current_price": price,
        "meta_json": {
            "event_slug": (evt or {}).get("slug"),
            "condition_id": m.get("conditionId"),
            "clob_token_ids": m.get("clobTokenIds"),
        },
        "_title": title,
        "_end": end,
    }


# ----- Match logic -----


def match_market(market_hint: str, candidates: list[dict]) -> Optional[dict]:
    """Pick the best candidate for a free-text hint, or None if nothing is plausible.

    Heuristic = title-overlap (token-Jaccard + sequence ratio) + small recency bonus.
    Threshold tuned conservatively: better to leave for human review than to
    misattribute Stu's call.
    """
    if not market_hint or not candidates:
        return None
    best, best_score = None, 0.0
    for c in candidates:
        score = _title_overlap(market_hint, c.get("_title") or c.get("question") or "")
        score += _recency_bonus(c.get("_end") or c.get("resolution_date"))
        if score > best_score:
            best, best_score = c, score
    # Require both: meaningful overlap AND at least one shared informative token
    informative_overlap = bool(
        _tokens(market_hint) & _tokens(best.get("_title", "") if best else "")
    )
    if best and best_score >= 0.20 and informative_overlap:
        return best
    return None


# ----- Orchestration -----


def _strip_internals(c: dict) -> dict:
    return {k: v for k, v in c.items() if not k.startswith("_")}


def resolve_all() -> dict:
    """Walk every call with NULL market_id, attempt resolution, return stats."""
    LOGS.mkdir(parents=True, exist_ok=True)
    unresolved: list[dict] = []
    resolved_n = 0
    skipped_n = 0
    seen_hints: dict[str, dict | None] = {}

    with connect() as conn:
        rows = list(
            conn.execute(
                "SELECT id, market_hint, episode_id FROM calls WHERE market_id IS NULL"
            )
        )
        for i, row in enumerate(rows, 1):
            cid, hint, eid = row["id"], row["market_hint"], row["episode_id"]
            if not hint or not hint.strip():
                skipped_n += 1
                unresolved.append({"call_id": cid, "reason": "empty market_hint"})
                continue

            # Cache by hint so we don't hammer APIs for repeated mentions
            if hint in seen_hints:
                match = seen_hints[hint]
            else:
                print(f"[resolver] {i}/{len(rows)} hint={hint[:60]!r}", flush=True)
                cands = _kalshi_candidates(hint) + _polymarket_candidates(hint)
                match = match_market(hint, cands)
                seen_hints[hint] = match
                if match:
                    print(f"[resolver]   -> {match['source']}:{match['ticker'][:50]} ({match.get('_title','')[:60]})", flush=True)
                else:
                    print(f"[resolver]   -> no match", flush=True)

            if match:
                payload = _strip_internals(match)
                mid = upsert_market(conn, payload)
                conn.execute("UPDATE calls SET market_id = ? WHERE id = ?", (mid, cid))
                resolved_n += 1
            else:
                unresolved.append(
                    {
                        "call_id": cid,
                        "episode_id": eid,
                        "market_hint": hint,
                        "reason": "no candidate above threshold",
                    }
                )

    if unresolved:
        log_path = LOGS / f"unresolved_markets-{date.today().isoformat()}.json"
        # Merge with any earlier run today to keep a single rolling log per day
        existing: list[dict] = []
        if log_path.exists():
            try:
                existing = json.loads(log_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                existing = []
        existing_keys = {(e.get("call_id"), e.get("market_hint")) for e in existing}
        for u in unresolved:
            if (u.get("call_id"), u.get("market_hint")) not in existing_keys:
                existing.append(u)
        log_path.write_text(
            json.dumps(existing, indent=2, ensure_ascii=False), encoding="utf-8"
        )

    return {"resolved": resolved_n, "unresolved": len(unresolved), "skipped": skipped_n}


if __name__ == "__main__":
    print(resolve_all())
