"""
Tag taxonomy for Calls.

Two layers, both multi-select, both non-mutually-exclusive:

- BROAD_TAGS (fixed, 5): political | event | sports | social | fun
- Specific tags (open vocabulary): kebab-case slugs derived from the market
  hint (e.g. "Texas Senate Republican Primary 2026" → "tx-senate-republican-primary-2026").

A single call can have several of each layer.

No external dependencies — pure Python.
"""
from __future__ import annotations

import re

# Fixed set. Displayed in this exact order in the frontend filter dropdown.
BROAD_TAGS: tuple[str, ...] = ("political", "event", "sports", "social", "fun")

# State name → 2-letter postal code. Used by normalize_specific to compact
# "Texas Senate" → "tx-senate". Keys are lowercased.
_STATE_TO_ABBR: dict[str, str] = {
    "alabama": "al", "alaska": "ak", "arizona": "az", "arkansas": "ar",
    "california": "ca", "colorado": "co", "connecticut": "ct", "delaware": "de",
    "florida": "fl", "georgia": "ga", "hawaii": "hi", "idaho": "id",
    "illinois": "il", "indiana": "in", "iowa": "ia", "kansas": "ks",
    "kentucky": "ky", "louisiana": "la", "maine": "me", "maryland": "md",
    "massachusetts": "ma", "michigan": "mi", "minnesota": "mn", "mississippi": "ms",
    "missouri": "mo", "montana": "mt", "nebraska": "ne", "nevada": "nv",
    "new-hampshire": "nh", "new-jersey": "nj", "new-mexico": "nm", "new-york": "ny",
    "north-carolina": "nc", "north-dakota": "nd", "ohio": "oh", "oklahoma": "ok",
    "oregon": "or", "pennsylvania": "pa", "rhode-island": "ri", "south-carolina": "sc",
    "south-dakota": "sd", "tennessee": "tn", "texas": "tx", "utah": "ut",
    "vermont": "vt", "virginia": "va", "washington": "wa", "west-virginia": "wv",
    "wisconsin": "wi", "wyoming": "wy", "district-of-columbia": "dc",
}

# Trailing parenthetical hints that aren't part of the canonical race name and
# should be dropped from the slug. Match the whole `(...)` group greedily.
_PAREN = re.compile(r"\s*\([^)]*\)\s*")

# Characters we treat as separators in the slug pass. Everything else becomes
# kebab-case alphanumeric.
_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def _strip_parens(s: str) -> str:
    """Drop any '(...)' suffixes from a market hint. The parenthetical is
    usually editorial color ("Stu: NO", "live in-show trade", "Round 1 pick")
    and would pollute the slug."""
    prev = None
    while prev != s:
        prev = s
        s = _PAREN.sub(" ", s)
    return s.strip()


def _kebab(s: str) -> str:
    """Lowercase + replace non-alphanumeric runs with single hyphens."""
    s = s.lower()
    s = _NON_ALNUM.sub("-", s)
    return s.strip("-")


def _compact_state_names(slug: str) -> str:
    """Replace full state names with postal abbreviations inside a kebab slug.

    Multi-word states ("new york") are already hyphenated by _kebab, so we
    can substitute "new-york" → "ny" with a simple replace. Single-word
    states are bounded by hyphens or string edges to avoid partial matches
    inside other tokens (e.g. don't turn "idaho-falls" into something weird).
    """
    for name, abbr in _STATE_TO_ABBR.items():
        slug = re.sub(rf"(^|-){re.escape(name)}(-|$)", rf"\1{abbr}\2", slug)
    return slug


def normalize_specific(s: str) -> str:
    """Turn a free-text race or market name into a kebab-case slug.

    Examples:
        "Texas Senate Republican Primary 2026"
          → "tx-senate-republican-primary-2026"
        "Spencer Pratt wins LA Mayor (Stu likes NO at 24% gain)"
          → "spencer-pratt-wins-la-mayor"
        "Cooper Flagg NBA Rookie of the Year"
          → "cooper-flagg-nba-rookie-of-the-year"

    Returns "" if the input collapses to empty.
    """
    cleaned = _strip_parens(s or "")
    slug = _kebab(cleaned)
    if not slug:
        return ""
    slug = _compact_state_names(slug)
    return slug
