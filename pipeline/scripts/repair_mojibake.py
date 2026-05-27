"""
Repair double-encoded UTF-8 (a.k.a. mojibake) in the production DB.

Symptom: text was UTF-8 bytes, got decoded as Windows-1252, then re-encoded
as UTF-8 — so a smart quote `’` (U+2019, bytes `e2 80 99`) ends up as the
three-character sequence `â€™` (`c3 a2 e2 82 ac e2 84 a2`).

Strategy: for each text field, attempt `s.encode('latin-1').decode('utf-8')`.
If the result is shorter (mojibake collapses) AND round-trips cleanly, take it.
Otherwise leave the value alone. Idempotent — safe to re-run.

Targets (per the data correctness pass):
  episodes.substack_body
  episodes.megaphone_title
  episodes.youtube_title
  episodes.substack_title
  comments.body
  call_events.quote
  call_events.raw_quote
  markets.question
  mentions.quote

Usage:
  python -m pipeline.scripts.repair_mojibake               # report only
  python -m pipeline.scripts.repair_mojibake --apply       # actually write
  python -m pipeline.scripts.repair_mojibake --apply \
      --db /var/lib/predictable/predictable.sqlite        # custom path
"""
from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path

# Bytes that, when seen in a UTF-8 string, are a strong signal that the string
# was double-decoded. `â€` is the start of every mojibake'd smart quote/dash.
# Adding `Ã` (U+00C3) catches `Ã©` (= é), `Ã¶` (= ö), etc.
SIGNAL_PREFIXES = ("â€", "Ã")

TARGETS: list[tuple[str, str, str]] = [
    ("episodes", "substack_body", "id"),
    ("episodes", "megaphone_title", "id"),
    ("episodes", "youtube_title", "id"),
    ("episodes", "substack_title", "id"),
    ("episodes", "transcript_text", "id"),
    ("comments", "body", "id"),
    ("call_events", "quote", "id"),
    ("call_events", "raw_quote", "id"),
    ("markets", "question", "id"),
    ("mentions", "quote", "id"),
]


def is_mojibake(s: str) -> bool:
    """Cheap signal: does the string contain a known mojibake prefix?"""
    return any(p in s for p in SIGNAL_PREFIXES)


def try_repair(s: str) -> str | None:
    """Attempt the latin-1 → utf-8 round-trip. Returns the fixed string,
    or None if the repair fails or doesn't improve things."""
    if not s or not is_mojibake(s):
        return None
    try:
        fixed = s.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return None
    # Only accept the repair if it actually removed the signal and didn't
    # introduce new replacement chars.
    if is_mojibake(fixed):
        return None
    if "�" in fixed:
        return None
    if fixed == s:
        return None
    return fixed


def repair_table(con: sqlite3.Connection, table: str, col: str, pk: str, apply: bool) -> int:
    rows = con.execute(f"SELECT {pk}, {col} FROM {table} WHERE {col} IS NOT NULL").fetchall()
    fixed = 0
    for r in rows:
        pk_val, text = r[0], r[1]
        new = try_repair(text)
        if new is None:
            continue
        fixed += 1
        if apply:
            con.execute(f"UPDATE {table} SET {col} = ? WHERE {pk} = ?", (new, pk_val))
    if fixed:
        action = "REPAIRED" if apply else "WOULD REPAIR"
        print(f"  [{action}] {table}.{col}: {fixed} row(s)")
    return fixed


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--db", default=None, help="Path to predictable.sqlite (defaults to data/predictable.sqlite)")
    p.add_argument("--apply", action="store_true", help="Actually write changes (default: report only)")
    args = p.parse_args()

    db_path = Path(args.db) if args.db else Path(__file__).resolve().parents[2] / "data" / "predictable.sqlite"
    if not db_path.exists():
        print(f"DB not found at {db_path}")
        return 1
    print(f"DB: {db_path}")
    print(f"Mode: {'APPLY' if args.apply else 'DRY RUN'}")
    print()

    con = sqlite3.connect(str(db_path))
    total = 0
    for table, col, pk in TARGETS:
        try:
            total += repair_table(con, table, col, pk, args.apply)
        except sqlite3.OperationalError as e:
            print(f"  [SKIP] {table}.{col}: {e}")
    if args.apply:
        con.commit()
        # Force WAL → main so the scp'd file is self-contained.
        con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    con.close()
    print()
    print(f"Total rows {'repaired' if args.apply else 'that would be repaired'}: {total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
