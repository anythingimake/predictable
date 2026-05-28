"""
Deterministic, keyword/regex-based tagger.

Given a call's market_hint (plus optional episode_title + raw_quote for
context), returns a list of tag strings — at minimum one broad tag from
BROAD_TAGS plus an auto-derived specific tag from the market hint.

No LLM call. No third-party deps. Pure Python — safe to run inside the
loader hot path.
"""
from __future__ import annotations

import re

from pipeline.extract.tag_taxonomy import BROAD_TAGS, normalize_specific

# Pre-compiled keyword regexes per broad tag. Each list is OR'd together;
# any match adds the broad tag.
#
# Order doesn't matter — we collect every matching tag. A call that's
# political AND social (e.g. abortion ballot measure) gets both.
#
# Patterns use \b word boundaries to avoid partials ("eagle" inside "beagle").

_KW: dict[str, list[re.Pattern[str]]] = {
    "political": [
        re.compile(p, re.IGNORECASE) for p in (
            r"\bsenate\b",
            r"\bhouse\b",
            r"\bcongress(?:ional)?\b",
            r"\bgovernor\b",
            r"\bgubernatorial\b",
            r"\bmayor(?:al)?\b",
            r"\bpresident(?:ial)?\b",
            r"\bprimary\b",
            r"\belection\b",
            r"\bmidterm",
            r"\bcaucus\b",
            r"\bnomination\b",
            r"\bdemocrat",
            r"\brepublican",
            r"\bgop\b",
            r"\bredistrict",
            r"\bvoting\s+rights\b",
            r"\bscotus\b",
            r"\bsupreme\s+court\b",
            r"\bbiden\b",
            r"\btrump\b",
            r"\bvance\b",
            r"\bramaswamy\b",
            r"\bpaxton\b",
            r"\bcornyn\b",
            r"\btalarico\b",
            r"\broy\s+cooper\b",  # NC Senate — Cooper Flagg has Cooper too; be specific
            r"\bkatie\s+porter\b",
            r"\bswalwell\b",
            r"\baoc\b",
            r"\brubio\b",
            r"\bshapiro\b",
            r"\bjd\s+vance\b",
            r"\bbecerra\b",
            r"\bhusted\b",
            r"\bsherrod\s+brown\b",
            r"\bspencer\s+pratt\b",  # reality TV person running for mayor — still political
            r"\bca[- ]\d{1,2}\b",
            r"\bnc[- ]\d{1,2}\b",
            r"\boh[- ]\d{1,2}\b",
            r"\bin[- ]\d{1,2}\b",
            r"\bky[- ]\d{1,2}\b",
            r"\btx[- ]\d{1,2}\b",
            r"\bny[- ]\d{1,2}\b",
            r"\bfl[- ]\d{1,2}\b",
            r"\b(?:district|seat)\s+\d+\b",
            r"\bjungle\s+primary\b",
            r"\bballot\b",
            r"\bcandidate\b",
            r"\bcabinet\b",
            r"\bspeaker\b",
            r"\biran\b",
            r"\bisrael\b",
            r"\bukraine\b",
            r"\bnuclear\s+deal\b",
            r"\bpeace\s+deal\b",
            r"\bsanction",
        )
    ],
    "event": [
        re.compile(p, re.IGNORECASE) for p in (
            r"\brotten\s+tomatoes\b",
            r"\boscar\b",
            r"\bemmy\b",
            r"\bgrammy\b",
            r"\baward\b",
            r"\bmandalorian\b",
            r"\bmovie\b",
            r"\brelease\b",
            r"\bpremiere\b",
            r"\bcourt\s+ruling\b",
            r"\bverdict\b",
            r"\bindict",
            r"\barraign",
            r"\bgrogu\b",
            r"\bdebut\b",
            r"\brookie\s+of\s+the\s+year\b",
            r"\bmvp\b",
            r"\bsuper\s+bowl\b",
            r"\bworld\s+series\b",
            r"\bnba\s+finals?\b",
            r"\bstanley\s+cup\b",
            r"\bdeal\s+by\b",
            r"\bby\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\b",
            r"\bbefore\s+\d{4}\b",
            r"\bthis\s+year\b",
            r"\bacquires\b",
            r"\bmerger\b",
            r"\bipo\b",
        )
    ],
    "sports": [
        re.compile(p, re.IGNORECASE) for p in (
            r"\bnfl\b",
            r"\bnba\b",
            r"\bmlb\b",
            r"\bnhl\b",
            r"\bncaa\b",
            r"\beagle(?:s)?\b",
            r"\bpatriots\b",
            r"\bsteelers\b",
            r"\bcowboys\b",
            r"\b49ers\b",
            r"\bbroncos\b",
            r"\bvrabel\b",
            r"\btomlin\b",
            r"\baj\s+brown\b",
            r"\ba\.j\.\s+brown\b",
            r"\bcooper\s+flagg\b",
            r"\bcoaches?\b",
            r"\brookie\s+of\s+the\s+year\b",
            r"\bweek\s+\d+\b",
            r"\bplayoff",
            r"\bfinals?\b",
            r"\bjack\s+adams\b",
            r"\bteam\b",
            r"\bquarterback\b",
            r"\bdraft\b",
        )
    ],
    "entertainment": [
        re.compile(p, re.IGNORECASE) for p in (
            # Awards
            r"\boscar\b",
            r"\bemmy\b",
            r"\bgrammy\b",
            r"\bgolden\s+globe",
            r"\btony\s+award",
            r"\bbafta\b",
            # Studios / streaming
            r"\bnetflix\b",
            r"\bdisney\b",
            r"\bhbo\b",
            r"\bhulu\b",
            r"\bparamount\b",
            r"\bapple\s+tv\b",
            r"\bprime\s+video\b",
            r"\bmarvel\b",
            r"\bpixar\b",
            r"\blucasfilm\b",
            # Film / TV
            r"\bmovie\b",
            r"\bfilm\b",
            r"\bbox\s+office\b",
            r"\bpremiere\b",
            r"\brotten\s+tomatoes\b",
            r"\bmetacritic\b",
            r"\bimdb\b",
            r"\btv\s+show\b",
            r"\bseason\s+(?:premiere|finale|\d+)\b",
            r"\bmandalorian\b",
            r"\bgrogu\b",
            r"\bstar\s+wars\b",
            # Music
            r"\bbillboard\b",
            r"\balbum\b",
            r"\btaylor\s+swift\b",
            r"\bbeyonc[eé]\b",
            r"\bdrake\b",
            r"\bspotify\b",
            # YouTube / creators / podcasts
            r"\byoutube\b",
            r"\byoutuber\b",
            r"\bmr\.?\s*beast\b",
            r"\btiktok\b",
            r"\bpodcast\b",
            r"\bjoe\s+rogan\b",
            # Celebrities (generic)
            r"\bcelebrity\b",
            r"\bcelebrities\b",
            r"\breality\s+tv\b",
            r"\bkardashian\b",
            r"\bspencer\s+pratt\b",
            r"\bactor\b",
            r"\bactress\b",
            r"\bhollywood\b",
            r"\bbroadway\b",
            r"\bdivorce\b",
            r"\bengagement\b",
        )
    ],
    "social": [
        re.compile(p, re.IGNORECASE) for p in (
            r"\babortion\b",
            r"\btrans\b",
            r"\bgender\b",
            r"\blgbt",
            r"\bgay\s+marriage\b",
            r"\bfree\s+speech\b",
            r"\bfirst\s+amendment\b",
            r"\bsecond\s+amendment\b",
            r"\bguns?\b",
            r"\bimmigrat",
            r"\bborder\b",
            r"\bdeportat",
            r"\baffirmative\s+action\b",
            r"\bdei\b",
            r"\bdiversity\b",
            r"\brace\s+relations\b",
            r"\bcritical\s+race\b",
            r"\bcrt\b",
            r"\bbook\s+ban",
            r"\breligious\s+liberty\b",
            r"\bvaccin",
        )
    ],
    "fun": [
        re.compile(p, re.IGNORECASE) for p in (
            r"\bspencer\s+pratt\b",
            r"\bcelebrity\b",
            r"\breality\s+tv\b",
            r"\bkardashian\b",
            r"\bdogecoin\b",
            r"\bmeme\b",
            r"\bmandalorian\b",
            r"\bgrogu\b",
            r"\brotten\s+tomatoes\b",
        )
    ],
}

# Names that should hit `political` when they're THE candidate but we don't
# want to also pull in `sports`. The sports patterns include some name
# fragments ("cooper" → could hit Cooper Flagg or Roy Cooper) so we
# disambiguate with this small allowlist that excludes the sports tag when
# matched. Keys are regexes, values are the broad tags to suppress.
_SUPPRESS_SPORTS_IF: list[re.Pattern[str]] = [
    re.compile(p, re.IGNORECASE) for p in (
        r"\broy\s+cooper\b",
        r"\bnc\s+senate\b",
        r"\bsenate\b",
        r"\bgubernatorial\b",
    )
]

# Conversely, names like "Vrabel" (coach) and "Tomlin" (coach) shouldn't be
# pulled into `political` just because the word "coaches" doesn't disqualify
# them. We suppress political when one of these sports-only signals fires.
_SUPPRESS_POLITICAL_IF: list[re.Pattern[str]] = [
    re.compile(p, re.IGNORECASE) for p in (
        r"\bcoaches?\s+(?:patriots|steelers|eagles|cowboys|49ers|broncos)\b",
        r"\bweek\s+\d+\b",
        r"\brookie\s+of\s+the\s+year\b",
        r"\b(?:nba|nfl|mlb|nhl)\s+(?:rookie|mvp|finals?|playoff)\b",
        r"\baj\s+brown\b",
        r"\ba\.j\.\s+brown\b",
        r"\bcooper\s+flagg\b",
    )
]


def _broad_tags(text: str) -> list[str]:
    """Run each broad-tag pattern bank over text; return broad tags that
    matched, preserving BROAD_TAGS order.

    Then apply suppression rules to resolve overlap between sports/political
    when the same surname (e.g. "Cooper") could hit both buckets.
    """
    hits: set[str] = set()
    for tag, patterns in _KW.items():
        if any(p.search(text) for p in patterns):
            hits.add(tag)

    # Suppress sports if the call is clearly political (Roy Cooper, etc.)
    if "sports" in hits and any(p.search(text) for p in _SUPPRESS_SPORTS_IF):
        # …unless it's also clearly sports (Cooper Flagg, AJ Brown, coaches).
        if not any(p.search(text) for p in _SUPPRESS_POLITICAL_IF):
            hits.discard("sports")

    # Suppress political if the call is clearly sports (Vrabel coaches…).
    if "political" in hits and any(p.search(text) for p in _SUPPRESS_POLITICAL_IF):
        # Only suppress if there's no other strong political signal.
        # "Spencer Pratt wins LA Mayor" is political AND fun — keep both.
        political_strong = re.search(
            r"\b(?:senate|house|congress|governor|gubernatorial|president|primary|mayor|midterm|election|nomination|redistrict)\b",
            text,
            re.IGNORECASE,
        )
        if not political_strong:
            hits.discard("political")

    return [t for t in BROAD_TAGS if t in hits]


def tag_call(market_hint: str, episode_title: str = "", raw_quote: str = "") -> list[str]:
    """Return the deterministic tag list for a call.

    Always returns at least one broad tag plus one specific tag.
    Conservative — when nothing matches the broad-tag patterns we fall back
    to `["event"]` so we never write an empty list.

    The specific tag is derived from market_hint via normalize_specific. If
    that collapses to empty (rare), we omit it.

    Tags are deduplicated and order-stable: broad tags in BROAD_TAGS order
    first, then specific tags.

    NOTE: broad-tag classification runs on market_hint ONLY. Episode title
    and raw_quote are accepted in the signature for forward-compat (future
    LLM pass) but ignored here — they routinely contaminate calls with
    unrelated tags (a Cooper-Flagg-NBA-ROY call inside a Midterm-themed
    episode shouldn't be tagged `political`).
    """
    hint = market_hint or ""
    _ = (episode_title, raw_quote)  # explicitly unused for now

    broad = _broad_tags(hint)
    if not broad:
        broad = ["event"]  # conservative fallback — never write []

    specific = normalize_specific(hint)
    out: list[str] = list(broad)
    if specific and specific not in out:
        out.append(specific)
    return out
