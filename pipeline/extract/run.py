"""
Deterministic, idempotent extraction runner — the single CLI entry for the
extraction step (the one pipeline step that previously lacked one, despite
docs/architecture.md promising every step has one).

For each transcript in data/transcripts/, it decides which of the four
extractor outputs are missing — checking each TYPE independently rather than
"any matching {guid}-*.json exists" — and produces only the missing ones. This
is the fix for the resume bug that stalled the cloud routine: once a transcript
had a `-calls.json`, the old "any file" check treated it as fully done and
never produced principles/strategies/qa.

Resilience: each (episode, extractor) runs in its own try/except, so one API
error can't kill the batch — a failed item just stays pending for the next run.
Combined with the SDK retry/backoff in client.py, a transient 429/529 is
retried; a hard failure is isolated and logged, never written as an empty file.

qa runs against Substack comments (not the transcript), so it is only "pending"
for episodes that actually have a comments snapshot; comment-less episodes are
N/A for qa and never counted as pending.

Usage:
    # No API key needed — just prints the backlog (per-type) + suspicious files.
    python -m pipeline.extract.run --list-pending

    # Extract everything pending (needs ANTHROPIC_API_KEY).
    python -m pipeline.extract.run

    # Only certain extractors, or cap how many episodes per run.
    python -m pipeline.extract.run --only principles,strategies
    python -m pipeline.extract.run --limit 3

    # Show what would run, do no work / no API calls.
    python -m pipeline.extract.run --dry-run
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

from pipeline.paths import INGEST_RAW, SQLITE, TRANSCRIPTS

# Mirrors client.DEFAULT_MODEL but defined locally so --list-pending / --dry-run
# never import client.py (and therefore the anthropic package): the backlog view
# must work with zero extra deps and no API key.
DEFAULT_MODEL = "claude-sonnet-4-6"

# Extraction order matters: strategies references the episode's already-extracted
# calls, so calls must come first.
KINDS = ("calls", "principles", "strategies", "qa")

_EXTRACT_DIR = INGEST_RAW / "extract"
_COMMENTS_DIR = INGEST_RAW / "substack" / "comments"


def _extract_path(guid: str, kind: str) -> Path:
    return _EXTRACT_DIR / f"{guid}-{kind}.json"


def _transcript_guids() -> list[str]:
    """Transcript filenames are the episode guid (already filesystem-safe)."""
    return sorted(p.stem for p in TRANSCRIPTS.glob("*.json"))


def _latest_megaphone_meta() -> dict[str, dict]:
    """guid -> {title, publish_date, duration_sec} from the newest snapshot."""
    d = INGEST_RAW / "megaphone"
    files = sorted(d.glob("*.json")) if d.exists() else []
    if not files:
        return {}
    try:
        eps = json.loads(files[-1].read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    meta: dict[str, dict] = {}
    for e in eps:
        g = e.get("guid")
        if g:
            meta[g] = {
                "title": e.get("title"),
                "publish_date": e.get("pub_date"),
                "duration_sec": e.get("duration_sec"),
            }
    return meta


def _episode_slugs() -> dict[str, str]:
    """guid -> substack_slug, read read-only from the local SQLite. Best-effort:
    empty if the DB is absent (qa is then simply not evaluated)."""
    if not SQLITE.exists():
        return {}
    try:
        con = sqlite3.connect(f"file:{SQLITE}?mode=ro", uri=True)
        try:
            rows = con.execute(
                "SELECT id, substack_slug FROM episodes WHERE substack_slug IS NOT NULL"
            ).fetchall()
        finally:
            con.close()
    except sqlite3.Error:
        return {}
    return {r[0]: r[1] for r in rows if r[1]}


def _comments_for(slug: str | None) -> list[dict] | None:
    if not slug:
        return None
    p = _COMMENTS_DIR / f"{slug}.json"
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    return data or None


def _load_existing_calls(guid: str) -> list[dict]:
    p = _extract_path(guid, "calls")
    if not p.exists():
        return []
    try:
        return json.loads(p.read_text(encoding="utf-8")).get("calls", [])
    except json.JSONDecodeError:
        return []


def _calls_is_empty(guid: str) -> bool:
    """A present-but-empty calls.json — a likely silent extraction miss worth a
    human eyeball (could also be a genuinely call-less episode)."""
    p = _extract_path(guid, "calls")
    if not p.exists():
        return False
    try:
        return not json.loads(p.read_text(encoding="utf-8")).get("calls")
    except json.JSONDecodeError:
        return True


def _has_api_key() -> bool:
    import os

    if os.environ.get("ANTHROPIC_API_KEY"):
        return True
    env_file = Path.home() / ".secrets" / "anthropic.env"
    return env_file.exists() and "ANTHROPIC_API_KEY=" in env_file.read_text(encoding="utf-8")


def compute_pending(only: set[str] | None = None) -> tuple[dict[str, list[str]], list[str], bool]:
    """Returns (pending {guid: [kinds]}, empty_calls_guids, db_present).

    db_present == False means qa could not be evaluated (no slug map)."""
    slugs = _episode_slugs()
    db_present = bool(slugs) or SQLITE.exists()
    pending: dict[str, list[str]] = {}
    empties: list[str] = []
    for guid in _transcript_guids():
        if _calls_is_empty(guid):
            empties.append(guid)
        miss: list[str] = []
        for kind in ("calls", "principles", "strategies"):
            if not _extract_path(guid, kind).exists():
                miss.append(kind)
        # qa only counts as pending when the episode actually has comments.
        if _comments_for(slugs.get(guid)) and not _extract_path(guid, "qa").exists():
            miss.append("qa")
        if only is not None:
            miss = [k for k in miss if k in only]
        if miss:
            pending[guid] = miss
    return pending, empties, db_present


def run_one(guid: str, kinds: list[str], *, model: str, meta: dict, slug: str | None) -> dict[str, str]:
    """Extract the given kinds for one episode. Each kind is isolated: a failure
    is recorded and the rest still run. Nothing is written on a None result, so
    a failed call never leaves a misleading empty file behind."""
    from pipeline.extract import calls as calls_mod
    from pipeline.extract import principles as principles_mod
    from pipeline.extract import qa as qa_mod
    from pipeline.extract import strategies as strategies_mod

    try:
        transcript = json.loads((TRANSCRIPTS / f"{guid}.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        return {k: f"FAIL: unreadable transcript: {e}" for k in kinds}

    status: dict[str, str] = {}
    for kind in (k for k in KINDS if k in kinds):  # canonical order; calls before strategies
        try:
            if kind == "calls":
                result = calls_mod.extract_calls(transcript, episode_meta=meta, model=model)
                count_key, save = "calls", calls_mod.save_extraction
            elif kind == "principles":
                result = principles_mod.extract_principles(transcript, episode_meta=meta, model=model)
                count_key, save = "principles", principles_mod.save_extraction
            elif kind == "strategies":
                result = strategies_mod.extract_strategies(
                    transcript, meta, _load_existing_calls(guid), model=model
                )
                count_key, save = "strategies", strategies_mod.save_extraction
            else:  # qa
                comments = _comments_for(slug)
                if not comments:
                    status[kind] = "skip (no comments)"
                    continue
                result = qa_mod.extract_qa(comments, meta, model=model)
                count_key, save = "clarifications", qa_mod.save_extraction

            if result is None:
                status[kind] = "FAIL: no tool result (left pending)"
                continue
            save(guid, result)
            status[kind] = f"ok ({len(result.get(count_key, []))})"
        except Exception as e:  # noqa: BLE001 — isolate per-extractor failure
            status[kind] = f"FAIL: {type(e).__name__}: {e}"
    return status


def _print_pending(pending: dict[str, list[str]], empties: list[str], db_present: bool) -> None:
    total = len(_transcript_guids())
    if not pending and not empties:
        print(f"[extract] all {total} transcripts fully extracted — nothing pending.")
    by_kind: dict[str, int] = {}
    for kinds in pending.values():
        for k in kinds:
            by_kind[k] = by_kind.get(k, 0) + 1
    print(f"[extract] {len(pending)}/{total} transcripts have pending work:")
    for guid in sorted(pending):
        print(f"  {guid}  ->  {', '.join(pending[guid])}")
    if by_kind:
        print("[extract] pending by type: " + ", ".join(f"{k}={n}" for k, n in sorted(by_kind.items())))
    if empties:
        print(f"[extract] [!] {len(empties)} calls.json present-but-empty (verify these weren't silent misses):")
        for guid in empties:
            print(f"    {guid}")
    if not db_present:
        print("[extract] note: no local SQLite — qa (comment-based) was not evaluated.")


def main() -> int:
    p = argparse.ArgumentParser(description="Run pending Predictable extractions (idempotent, per-type).")
    p.add_argument("--list-pending", action="store_true", help="Print the backlog and exit (no API key needed).")
    p.add_argument("--dry-run", action="store_true", help="Show what would run; make no API calls.")
    p.add_argument("--only", default=None, help="Comma list of kinds: calls,principles,strategies,qa")
    p.add_argument("--limit", type=int, default=None, help="Process at most N episodes this run.")
    p.add_argument("--model", default=DEFAULT_MODEL, help="Anthropic model id for extraction.")
    args = p.parse_args()

    only: set[str] | None = None
    if args.only:
        only = {k.strip() for k in args.only.split(",") if k.strip()}
        bad = only - set(KINDS)
        if bad:
            print(f"[extract] unknown --only kinds: {', '.join(sorted(bad))} (valid: {', '.join(KINDS)})")
            return 2

    pending, empties, db_present = compute_pending(only)

    if args.list_pending:
        _print_pending(pending, empties, db_present)
        return 0

    if not pending:
        print("[extract] nothing pending — all caught up.")
        return 0

    if not args.dry_run and not _has_api_key():
        print(
            "[extract] ANTHROPIC_API_KEY not set — cannot extract. "
            "Set it (or ~/.secrets/anthropic.env), or run the cloud routine. "
            "Use --list-pending to see the backlog without a key."
        )
        return 2

    meta_map = _latest_megaphone_meta()
    slugs = _episode_slugs()
    targets = sorted(pending)
    if args.limit is not None:
        targets = targets[: args.limit]

    print(f"[extract] {len(targets)} episode(s) to process (model={args.model}):")
    failures = 0
    for guid in targets:
        kinds = pending[guid]
        if args.dry_run:
            print(f"  DRY {guid}  ->  {', '.join(kinds)}")
            continue
        try:
            status = run_one(guid, kinds, model=args.model, meta=meta_map.get(guid, {}), slug=slugs.get(guid))
        except Exception as e:  # noqa: BLE001 — one bad episode must not kill the batch
            print(f"  {guid}  ->  FAIL (episode aborted): {type(e).__name__}: {e}")
            failures += 1
            continue
        parts = ", ".join(f"{k}={v}" for k, v in status.items())
        print(f"  {guid}  ->  {parts}")
        failures += sum(1 for v in status.values() if v.startswith("FAIL"))

    print(f"[extract] done. {failures} extractor failure(s) — failed items remain pending for the next run.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
