"""
Glossary substitution for transcribed text — canonicalize domain terms that
Whisper consistently mistranscribes (e.g., 'Cal-Shi' → 'Kalshi').

Maintained as a curated list. Substitutions are case-insensitive and
word-boundary aware. Extended over time as new mishearings are observed.
"""
from __future__ import annotations

import re

# Each entry: list of (mistranscription patterns) → canonical form
GLOSSARY: list[tuple[list[str], str]] = [
    # Platforms
    (["cal[\\s-]?shi", "cal\\s?sheet", "kal\\s?shi", "khi", "couchy", "kouchi"], "Kalshi"),
    (["poly\\s?market", "polly\\s?market", "polymark", "polymar"], "Polymarket"),
    (["predict[\\s-]?it"], "PredictIt"),
    # People mentioned often in the show
    (["thomas\\s?massie"], "Thomas Massie"),
    (["bill\\s?cassidy"], "Bill Cassidy"),
    (["vivek\\s?ramaswamy"], "Vivek Ramaswamy"),
    (["aoc"], "AOC"),
    (["spencer\\s?pratt"], "Spencer Pratt"),
    (["gavin\\s?newsom"], "Gavin Newsom"),
    (["ken\\s?paxton", "paxton"], "Paxton"),
    # Orgs / outlets
    (["cftc"], "CFTC"),
    (["nyt", "new\\s?york\\s?times"], "NYT"),
    (["wsj", "wall\\s?street\\s?journal"], "WSJ"),
    (["npr"], "NPR"),
    # Trading terms (capitalization only)
    (["yes\\s?contract"], "YES contract"),
    (["no\\s?contract"], "NO contract"),
]


def _compile() -> list[tuple[re.Pattern, str]]:
    compiled = []
    for patterns, canonical in GLOSSARY:
        for p in patterns:
            # Whole-word match, case-insensitive
            compiled.append((re.compile(rf"\b{p}\b", re.IGNORECASE), canonical))
    return compiled


_RULES = _compile()


def canonicalize(text: str) -> str:
    """Apply glossary substitutions to a string of transcribed text."""
    out = text
    for pat, canon in _RULES:
        out = pat.sub(canon, out)
    return out


def canonicalize_segments(segments: list[dict]) -> list[dict]:
    """Apply to a list of segment dicts with a 'text' key."""
    return [{**s, "text": canonicalize(s.get("text", ""))} for s in segments]
