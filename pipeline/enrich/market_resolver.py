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
import sqlite3
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

# "Weak" tokens — strong enough to keep in the score but too generic to count
# as informative on their own. Election years are the prime offender: every
# politics market mentions a year, so a single shared year token across two
# unrelated markets isn't real evidence of a match. (See Roy Cooper / Jon
# Cooper false match: shared tokens were `cooper` + `2026`. Without 2026,
# `cooper` alone shouldn't have been enough to claim the match.)
_WEAK_TOKENS = frozenset(
    {str(y) for y in range(2018, 2036)}
    | {"win", "wins", "won", "loss", "lose", "lost", "winner", "race",
       "primary", "election", "elections", "midterm", "midterms",
       "next", "first", "second", "third", "general",
       # Generic time/order/control filler — these recur across every market
       # title regardless of topic.
       "after", "before", "during", "by", "until", "since", "between",
       "become", "becomes", "becoming", "control", "controls", "following",
       "head", "leader", "leaders",
       # Generic disposition verbs — too common to carry a match on their own
       # (e.g. "Congress banned from trading stocks" must NOT match "clavicular
       # banned from Kick" just because both say "banned").
       "ban", "banned", "bans", "declare", "declares", "declared",
       }
    # Party names are NOT weak — "Democrats win House" needs `democrats` to
    # count as a strong signal so it matches "Democratic Party control House".
    # The conflict-bucket approach handles the cross-party rejection (D vs R).
)

# Countries that show up in non-US prediction markets. If a title mentions one
# of these and the hint doesn't (or vice versa), they're about different
# political systems — reject. The Thailand House of Representatives election
# is a different "house" than the U.S. House of Representatives.
_FOREIGN_COUNTRIES = {
    "thailand", "hungary", "israel", "germany", "france", "uk", "britain",
    "england", "scotland", "wales", "ireland", "italy", "spain", "portugal",
    "japan", "china", "russia", "ukraine", "india", "pakistan", "brazil",
    "mexico", "canada", "australia", "korea", "philippines", "indonesia",
    "vietnam", "argentina", "chile", "venezuela", "colombia", "peru",
    "turkey", "iran", "iraq", "syria", "lebanon", "egypt", "saudi",
    "afghanistan", "bangladesh", "nigeria", "kenya", "ethiopia", "morocco",
    "poland", "netherlands", "belgium", "sweden", "norway", "denmark",
    "finland", "greece", "austria", "switzerland", "hungary", "romania",
}

# Party bucket: a hint about Democrats can't match a title about Republicans.
_BUCKET_PARTY: dict[str, str] = {
    "democrat": "democrat", "democrats": "democrat", "democratic": "democrat",
    "republican": "republican", "republicans": "republican", "gop": "republican",
}

# ----- Categorical / disambiguation gates -----
#
# These are the false-match patterns we keep hitting:
#   - AJ Brown to Eagles  ↔ AJ Brown to Patriots  (different teams)
#   - Roy Cooper NC Senate ↔ Jon Cooper NHL Jack Adams  (different leagues/people)
#   - Tomlin coaches Patriots ↔ Tomlin fired by Feb 28  (different question)
#   - Republicans win Iowa Senate ↔ Republicans win Utah Senate  (different state)
#   - Republicans win Senate (national) ↔ Republicans win Ohio Senate  (national vs single-state)
#   - Vivek Ramaswamy OH gubernatorial ↔ Vivek Ramaswamy popular vote 2024  (different race / year)
#   - Porter / Swalwell CA Senate ↔ CA Governor  (different office)
#
# Strategy: build small "category buckets" of mutually-exclusive tokens. If a
# hint contains a token from one bucket and the candidate title contains a
# DIFFERENT token from the SAME bucket, that's a conflict and we reject.

# US state names + 2-letter codes (lowercased). Includes the few district/
# territory tokens that legitimately appear in markets.
_US_STATES = {
    "alabama": "al", "alaska": "ak", "arizona": "az", "arkansas": "ar",
    "california": "ca", "colorado": "co", "connecticut": "ct", "delaware": "de",
    "florida": "fl", "georgia": "ga", "hawaii": "hi", "idaho": "id",
    "illinois": "il", "indiana": "in", "iowa": "ia", "kansas": "ks",
    "kentucky": "ky", "louisiana": "la", "maine": "me", "maryland": "md",
    "massachusetts": "ma", "michigan": "mi", "minnesota": "mn", "mississippi": "ms",
    "missouri": "mo", "montana": "mt", "nebraska": "ne", "nevada": "nv",
    "ohio": "oh", "oklahoma": "ok", "oregon": "or", "pennsylvania": "pa",
    "tennessee": "tn", "texas": "tx", "utah": "ut", "vermont": "vt",
    "virginia": "va", "washington": "wa", "wisconsin": "wi", "wyoming": "wy",
    # multi-word states get their distinctive first word as well
    "carolina": None,  # NC/SC — code disambiguation requires "north"/"south"
    "dakota": None,    # ND/SD — same
    "jersey": None,    # NJ
    "hampshire": None, # NH
    "mexico": None,    # NM (also a country — fine, gate is symmetric)
}
# Map code -> state token
_STATE_CODES = {v: k for k, v in _US_STATES.items() if v}
# Special-case "north/south" prefix tokens are NOT state markers on their own.
# We treat the discriminator as the *combination*. For matcher simplicity we
# treat NC/SC/ND/SD as opaque codes when present.
_TWO_LETTER_STATE_CODES = set(_STATE_CODES.keys()) | {"nc", "sc", "nd", "sd", "nj", "nh", "nm", "wv", "ri"}

# Categories where tokens compete: hint says one, title says another → reject.
# Each bucket is `{token: canonical}` so synonyms (gubernatorial ↔ governor,
# presidential ↔ president, eagle ↔ eagles) don't false-conflict.
_BUCKET_OFFICE: dict[str, str] = {
    "senate": "senate", "senator": "senate", "senatorial": "senate",
    "house": "house", "congress": "house", "congressional": "house",
    "governor": "governor", "gubernatorial": "governor",
    "mayor": "mayor", "mayoral": "mayor",
    "president": "president", "presidential": "president", "presidency": "president",
    "attorney": "attorney",
}
_BUCKET_SPORT_LEAGUE: dict[str, str] = {
    t: t for t in ("nfl", "nba", "nhl", "mlb", "mls", "pga", "ufc", "wnba", "ncaa")
}
# NFL teams (lowercased). Singular / plural / common short-forms map to the
# canonical team token so "Eagle" → eagles and "Niners" → 49ers don't
# false-conflict with their own canonical.
_NFL_TEAMS: dict[str, str] = {}
for canonical, aliases in {
    "patriots": ("patriot", "pats"),
    "eagles": ("eagle",),
    "cowboys": ("cowboy",),
    "giants": ("giant",),
    "jets": ("jet",),
    "bills": ("bill",),
    "dolphins": ("dolphin",),
    "ravens": ("raven",),
    "bengals": ("bengal",),
    "browns": ("brown",),  # NOTE: collides with surname Brown — handled below
    "steelers": ("steeler",),
    "texans": ("texan",),
    "colts": ("colt",),
    "jaguars": ("jaguar", "jags"),
    "titans": ("titan",),
    "broncos": ("bronco",),
    "chiefs": ("chief",),
    "raiders": ("raider",),
    "chargers": ("charger",),
    "commanders": ("commander",),
    "vikings": ("viking",),
    "packers": ("packer",),
    "bears": ("bear",),
    "lions": ("lion",),
    "saints": ("saint",),
    "buccaneers": ("buccaneer", "bucs"),
    "falcons": ("falcon",),
    "panthers": ("panther",),
    "seahawks": ("seahawk",),
    "49ers": ("niners",),
    "rams": ("ram",),
    "cardinals": ("cardinal",),
}.items():
    _NFL_TEAMS[canonical] = canonical
    for a in aliases:
        _NFL_TEAMS[a] = canonical

# The bare "brown" alias collides with people whose surname is Brown. Drop it
# from the NFL bucket so "A.J. Brown" doesn't trip a Browns conflict.
_NFL_TEAMS.pop("brown", None)

# Combine into one list of buckets the matcher iterates. Each bucket is a
# `{token: canonical}` dict.
_CONFLICT_BUCKETS: list[dict[str, str]] = [
    _BUCKET_OFFICE,
    _BUCKET_SPORT_LEAGUE,
    _NFL_TEAMS,
]

# Disposition tokens — e.g., "fired" vs "coaches" vs "hired" all describe
# DIFFERENT events about the same person. If the hint says one and the title
# says another, the question isn't the same even if names overlap.
_BUCKET_DISPOSITION: dict[str, str] = {
    "fired": "fired", "fires": "fired",
    "hired": "hired", "hires": "hired",
    "coaches": "coach", "coach": "coach", "coaching": "coach",
    "traded": "traded", "trades": "traded",
    "resign": "resign", "resigns": "resign", "resignation": "resign",
    "indicted": "indicted", "indictment": "indicted",
    "convicted": "convicted", "acquitted": "acquitted",
    "released": "released",
    "popular": "popular",  # "popular vote" is its own kind of question
}
_CONFLICT_BUCKETS.append(_BUCKET_DISPOSITION)
_CONFLICT_BUCKETS.append(_BUCKET_PARTY)

# Geopolitical-event bucket: "war" / "peace" / "deal" / "sanctions" are
# DIFFERENT propositions about the same countries. Stops the US/Iran
# "nuclear deal" and "permanent peace deal" calls from both latching onto the
# unrelated "US/Iran declare war before March?" market just because they share
# the country token "iran".
_BUCKET_GEO_EVENT: dict[str, str] = {
    "war": "war", "invade": "war", "invades": "war", "invasion": "war",
    "attack": "war", "attacks": "war", "strike": "war", "strikes": "war",
    "peace": "peace", "ceasefire": "peace", "truce": "peace", "armistice": "peace",
    "deal": "deal", "agreement": "deal", "treaty": "deal", "accord": "deal",
    "sanctions": "sanctions", "sanction": "sanctions",
}
_CONFLICT_BUCKETS.append(_BUCKET_GEO_EVENT)


# Common stem collapses — "democrats" / "democratic" / "democrat" all mean the
# same political party for matching purposes. Applied before the weak-token
# filter so a hint and title with the same root party reference can match.
_STEM_MAP: dict[str, str] = {
    "democrats": "democrat", "democratic": "democrat",
    "republicans": "republican",
    "midterms": "midterm",
    "primaries": "primary",
    "elections": "election",
    "governors": "governor", "gubernatorial": "governor",
    "presidential": "president", "presidency": "president",
    "senatorial": "senate", "senator": "senate", "senators": "senate",
    "congressional": "congress",
    "patriot": "patriots",  # singular -> plural for NFL team
    "eagle": "eagles",
    "winners": "winner", "winning": "winner",
}


def _tokens(s: str) -> set[str]:
    s = (s or "").lower()
    parts = re.findall(r"[a-z0-9]+", s)
    out: set[str] = set()
    for p in parts:
        if not p or len(p) <= 1 or p in _STOPWORDS:
            continue
        out.add(_STEM_MAP.get(p, p))
    return out


def _strong_tokens(s: str) -> set[str]:
    """Tokens that carry actual identifying signal — names, places, distinctive
    nouns. Used to make sure a 'match' actually shares meaningful content,
    not just generic year + verb."""
    return _tokens(s) - _WEAK_TOKENS


def _states_in(s: str) -> set[str]:
    """All distinct US states referenced in a string, normalized to the full
    state name (so "TX" and "Texas" collapse to the same token)."""
    toks = _tokens(s)
    found: set[str] = set()
    for t in toks:
        if t in _US_STATES and _US_STATES[t]:  # full name → keep
            found.add(t)
        elif t in _STATE_CODES:                  # code → expand
            found.add(_STATE_CODES[t])
    return found


def _years_in(s: str) -> set[str]:
    return {t for t in _tokens(s) if t.isdigit() and len(t) == 4 and 2018 <= int(t) <= 2035}


def _bucket_canonicals(tokens: set[str], bucket: dict[str, str]) -> set[str]:
    return {bucket[t] for t in tokens if t in bucket}


def _foreign_countries_in(s: str) -> set[str]:
    return _tokens(s) & _FOREIGN_COUNTRIES


# ----- Question-TYPE gate: plain win/lose vs margin / threshold / bracket -----
#
# A plain "X wins" call and a "margin of victory / by N% / by between A and B"
# market are DIFFERENT questions even when they share every name token. Without
# this, "Cassidy wins Louisiana" latches onto "Cassidy margin between 6% and 9%"
# and "Cornyn wins the nomination" latches onto "Cornyn by 9 or more". And two
# margin markets whose numeric ranges don't line up ("by over 20" vs the narrow
# "by between 20% and 25%" bracket) are also different bets.

_MAGNITUDE_PATTERNS = [
    re.compile(r"margin of victory"),
    re.compile(r"\bby between\b"),
    re.compile(r"\bbetween\s+\d{1,3}\s*%?\s+and\s+\d{1,3}"),
    re.compile(r"\bby\s+(?:over|under|at least|more than|fewer than|less than|nearly|about|around|roughly)?\s*\d{1,3}\b"),
    re.compile(r"\b\d{1,3}\s*%"),  # NB: no trailing \b — "%" is non-word, so "\b" after it never matches
    re.compile(r"\b\d{1,3}\s*(?:percent|points?|pts)\b"),
    re.compile(r"\b\d{1,3}\s*\+"),
    re.compile(r"\b\d{1,3}\s+or\s+(?:more|fewer|less|greater|higher|lower)\b"),
    re.compile(r"\b(?:at least|more than|over|under|fewer than|less than|no more than|no fewer than)\s+\d{1,3}\b"),
]


def _is_magnitude_question(s: str) -> bool:
    """True if the text asks about a numeric MAGNITUDE (margin of victory, a
    percentage / points threshold, a seat count, an A-B bracket) rather than a
    plain binary win/lose outcome. Years (4 digits) deliberately don't count."""
    s = (s or "").lower()
    return any(p.search(s) for p in _MAGNITUDE_PATTERNS)


def _margin_range(s: str) -> tuple[float, float] | None:
    """Best-effort (low, high) the margin/threshold phrase refers to, on a 0-100
    scale. Open-ended phrasings fill the missing bound with 0 or 100. Returns
    None when nothing parses (caller then leans on the coarser type gate)."""
    s = (s or "").lower()
    m = re.search(r"between\s+(\d{1,3})\s*%?\s+and\s+(\d{1,3})", s)
    if m:
        lo, hi = float(m.group(1)), float(m.group(2))
        return (min(lo, hi), max(lo, hi))
    m = re.search(r"(?:over|more than|greater than|at least|no fewer than)\s+(\d{1,3})", s)
    if m:
        return (float(m.group(1)), 100.0)
    m = re.search(r"\b(\d{1,3})\s*\+", s)
    if m:
        return (float(m.group(1)), 100.0)
    m = re.search(r"\b(\d{1,3})\s+or\s+(?:more|greater|higher)\b", s)
    if m:
        return (float(m.group(1)), 100.0)
    m = re.search(r"(?:under|less than|fewer than|below|no more than)\s+(\d{1,3})", s)
    if m:
        return (0.0, float(m.group(1)))
    m = re.search(r"\b(\d{1,3})\s+or\s+(?:fewer|less|lower)\b", s)
    if m:
        return (0.0, float(m.group(1)))
    return None


def _ranges_match(a: tuple[float, float], b: tuple[float, float], tol: float = 2.0) -> bool:
    """Two margin ranges describe the same bet when both bounds line up within
    `tol` points: (20,100) vs (20,100) -> True; (20,100) vs (20,25) -> False."""
    return abs(a[0] - b[0]) <= tol and abs(a[1] - b[1]) <= tol


def _type_conflict(hint: str, title: str) -> str | None:
    """Just the question-TYPE / margin-range gate, isolated so the repair pass
    can unlink ONLY these mismatches (not pre-existing state/foreign/etc. gates,
    which governed links that were acceptable under the old logic).

    - plain win/lose vs margin/threshold/bracket → different questions, reject.
    - two margin markets with non-overlapping numeric ranges → different bets.
    """
    h_mag = _is_magnitude_question(hint)
    t_mag = _is_magnitude_question(title)
    if h_mag != t_mag:
        return "question-type mismatch (win/lose vs margin/threshold)"
    if h_mag and t_mag:
        hr, tr = _margin_range(hint), _margin_range(title)
        if hr and tr and not _ranges_match(hr, tr):
            return f"margin-range mismatch ({hr} vs {tr})"
    return None


def _conflict(hint: str, title: str) -> str | None:
    """Return a short conflict reason if hint and title both mention competing
    tokens in the same bucket (different state, different office, different
    team), else None. Tokens shared (after canonical-collapse) don't conflict.

    The check is symmetric: a hint that says nothing about state can still
    match a title that does (and vice-versa); only an explicit difference
    triggers rejection. Synonyms like gubernatorial/governor or eagle/eagles
    collapse to one canonical so they don't false-conflict.
    """
    h_tokens = _tokens(hint)
    t_tokens = _tokens(title)

    # Foreign-country conflict — Thailand PM ≠ U.S. House. If one side
    # mentions a non-US country and the other doesn't, reject.
    h_foreign = _foreign_countries_in(hint)
    t_foreign = _foreign_countries_in(title)
    if h_foreign and not t_foreign:
        return f"hint mentions {sorted(h_foreign)} but title is US-scope"
    if t_foreign and not h_foreign:
        return f"title mentions {sorted(t_foreign)} but hint is US-scope"
    if h_foreign and t_foreign and not (h_foreign & t_foreign):
        return f"country mismatch ({sorted(h_foreign)} vs {sorted(t_foreign)})"

    # State conflict
    h_states = _states_in(hint)
    t_states = _states_in(title)
    if h_states and t_states and not (h_states & t_states):
        return f"state mismatch ({sorted(h_states)} vs {sorted(t_states)})"
    # Specificity mismatch: title is about a single state, hint is not — this
    # is the "Republicans win Senate (national)" → "Republicans win Ohio Senate"
    # false-match guard. The reverse (hint mentions state, title doesn't) is
    # also rejected because a state-specific call shouldn't latch onto a
    # national-level market.
    #
    # Override: when hint and title share 3+ strong tokens (a candidate name
    # plus a distinctive descriptor like "margin" / "runoff" / a numeric
    # threshold), specificity mismatch alone shouldn't reject. The Paxton +20%
    # margin call ("Ken Paxton +20% margin (Kalshi/Politicon live market)") is
    # the canonical case — it doesn't say "Texas" but shares paxton+ken+margin
    # +20 with the actual market.
    h_strong = _strong_tokens(hint)
    t_strong = _strong_tokens(title)
    shared_strong = h_strong & t_strong
    if len(shared_strong) < 3:
        if h_states and not t_states:
            return f"hint mentions state(s) {sorted(h_states)} but title is national-scope"
        if t_states and not h_states:
            return f"title mentions state(s) {sorted(t_states)} but hint is national-scope"

    # Year conflict (e.g., 2024 in hint, 2026 in title for the same candidate)
    h_years = _years_in(hint)
    t_years = _years_in(title)
    if h_years and t_years and not (h_years & t_years):
        return f"year mismatch ({sorted(h_years)} vs {sorted(t_years)})"

    # Question-TYPE / margin-range conflict (see _type_conflict): a plain
    # win/lose call vs a margin/threshold/bracket market are different questions,
    # and two margin markets with non-overlapping ranges are different bets.
    tc = _type_conflict(hint, title)
    if tc:
        return tc

    # Bucket conflict (canonicalized)
    for bucket in _CONFLICT_BUCKETS:
        h_b = _bucket_canonicals(h_tokens, bucket)
        t_b = _bucket_canonicals(t_tokens, bucket)
        if h_b and t_b and not (h_b & t_b):
            return f"bucket mismatch ({sorted(h_b)} vs {sorted(t_b)})"
    return None


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

    Acceptance gate (intentionally conservative — false positives are worse than
    leaving a call unresolved for human review):
      1. Reject any candidate whose title `_conflict`s with the hint on a
         categorical bucket (state, year, office, league, NFL team).
      2. Require `score >= 0.25`.
      3. Require at least 2 shared STRONG tokens (names/places/distinctive nouns),
         OR 1 strong token if raw score is >= 0.45.

    The conflict check is what stops the famous false matches:
      - Roy Cooper NC Senate ↔ Jon Cooper NHL (no shared state/league, NHL bucket trips)
      - AJ Brown to Eagles ↔ AJ Brown to Patriots (NFL team mismatch)
      - Republicans win IA Senate ↔ Republicans win UT Senate (state mismatch)
      - Porter / Swalwell CA Senate ↔ CA Governor (office mismatch)
      - Vivek OH gubernatorial 2026 ↔ Vivek popular vote 2024 (year mismatch)
      - Tomlin coaches Patriots Week 1 ↔ Tomlin fired by Feb 28 (no shared strong
        tokens once "patriots" / "fired" / "week" diverge)
    """
    if not market_hint or not candidates:
        return None
    # Pre-filter: drop conflicting candidates entirely so a bad-but-high-score
    # candidate doesn't shadow a good-but-lower-score one.
    safe = [c for c in candidates
            if not _conflict(market_hint, c.get("_title") or c.get("question") or "")]
    if not safe:
        return None
    best, best_score = None, 0.0
    for c in safe:
        score = _title_overlap(market_hint, c.get("_title") or c.get("question") or "")
        score += _recency_bonus(c.get("_end") or c.get("resolution_date"))
        if score > best_score:
            best, best_score = c, score
    if not best:
        return None
    # Threshold bumped 0.20 → 0.25 after the false-match audit on 2026-05-27.
    if best_score < 0.25:
        return None
    hint_strong = _strong_tokens(market_hint)
    title_strong = _strong_tokens(best.get("_title") or best.get("question") or "")
    shared_strong = hint_strong & title_strong
    # 2+ shared strong tokens = solid.
    if len(shared_strong) >= 2:
        return best
    # 1 shared strong token: require strong structural overlap.
    if len(shared_strong) == 1 and best_score >= 0.45:
        return best
    return None


# ----- Orchestration -----


def _strip_internals(c: dict) -> dict:
    return {k: v for k, v in c.items() if not k.startswith("_")}


def _find_sibling(match: dict, hint: str) -> dict | None:
    """Given a matched market on one exchange, look for its sibling on the
    OTHER exchange (Kalshi → Polymarket and vice versa). Returns a normalized
    market dict (with _title) or None.

    Same matching gate as the primary `match_market`. We use the matched
    market's _title as the search hint (more specific than the user's free-
    text hint, so the sibling search has better signal).
    """
    primary_source = match.get("source")
    title = match.get("_title") or match.get("question") or ""
    if not title or not primary_source:
        return None
    if primary_source == "kalshi":
        other = _polymarket_candidates(title)
    elif primary_source == "polymarket":
        other = _kalshi_candidates(title)
    else:
        return None
    if not other:
        return None
    sibling = match_market(title, other)
    if sibling and sibling.get("source") == primary_source:
        return None  # paranoia — shouldn't happen but guard against re-finding self
    return sibling


def resolve_all() -> dict:
    """Walk every call with NULL market_id, attempt resolution, return stats."""
    LOGS.mkdir(parents=True, exist_ok=True)
    unresolved: list[dict] = []
    resolved_n = 0
    skipped_n = 0
    seen_hints: dict[str, dict | None] = {}

    unlinked_n = 0
    with connect() as conn:
        # ── Repair pass: unlink EXISTING links that violate the question-TYPE /
        # margin-range gate (a plain win/lose call mislinked to a margin/bracket
        # market, or a margin call on the wrong bracket). Scoped to
        # `_type_conflict` ONLY, so we don't disturb links that merely trip older
        # gates (state/foreign/etc.) — those governed links that were acceptable
        # under the logic that created them. Human-pinned links are left alone.
        # NULLed calls fall through to the re-resolution loop below (re-linked to
        # a correct-type market, or left in the unresolved log for human review).
        for r in list(
            conn.execute(
                """SELECT c.id, c.market_hint, m.question
                     FROM calls c JOIN markets m ON m.id = c.market_id
                    WHERE c.market_id IS NOT NULL
                      AND (c.notes IS NULL OR c.notes NOT LIKE 'pin:no-auto-link%')"""
            )
        ):
            if _type_conflict(r["market_hint"] or "", r["question"] or ""):
                conn.execute("UPDATE calls SET market_id = NULL WHERE id = ?", (r["id"],))
                unlinked_n += 1
        if unlinked_n:
            print(
                f"[resolver] repair: unlinked {unlinked_n} type/range-mismatched "
                f"call(s) for re-resolution",
                flush=True,
            )

        # Skip human-pinned calls (notes 'pin:no-auto-link') — these are
        # verified false-match corrections (e.g. Letlow "wins outright" must
        # NOT relink to the "finish first" market; Talarico general-election
        # calls must stay open until Nov). Auto-matching keeps re-making these
        # because the hints share strong tokens with the wrong markets.
        rows = list(
            conn.execute(
                """SELECT id, market_hint, episode_id FROM calls
                    WHERE market_id IS NULL
                      AND (notes IS NULL OR notes NOT LIKE 'pin:no-auto-link%')"""
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
                # Look for a sibling market on the other exchange (e.g., the
                # Texas Senate runoff is on both Kalshi and Polymarket).
                # Store the sibling id in meta_json so the UI can surface it.
                sibling = _find_sibling(match, hint)
                if sibling:
                    sibling_id = f"{sibling['source']}:{sibling['ticker']}"
                    sibling_meta = payload.get("meta_json") or {}
                    if isinstance(sibling_meta, str):
                        try:
                            sibling_meta = json.loads(sibling_meta)
                        except json.JSONDecodeError:
                            sibling_meta = {}
                    sibling_meta["sibling_market_id"] = sibling_id
                    payload["meta_json"] = sibling_meta
                    # Also upsert the sibling so /api/markets/{sibling_id} works.
                    upsert_market(conn, _strip_internals(sibling))
                    # Symmetric back-link on the sibling.
                    try:
                        sib_row = conn.execute(
                            "SELECT meta_json FROM markets WHERE id = ?",
                            (sibling_id,),
                        ).fetchone()
                        sib_meta = {}
                        if sib_row and sib_row["meta_json"]:
                            try:
                                sib_meta = json.loads(sib_row["meta_json"]) or {}
                            except json.JSONDecodeError:
                                sib_meta = {}
                        sib_meta["sibling_market_id"] = f"{match['source']}:{match['ticker']}"
                        conn.execute(
                            "UPDATE markets SET meta_json = ? WHERE id = ?",
                            (json.dumps(sib_meta), sibling_id),
                        )
                    except sqlite3.Error:
                        pass
                    print(f"[resolver]   sibling: {sibling_id}", flush=True)
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

    return {"resolved": resolved_n, "unlinked": unlinked_n, "unresolved": len(unresolved), "skipped": skipped_n}


if __name__ == "__main__":
    print(resolve_all())
