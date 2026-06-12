"""
Enrichment orchestrator — runs market_resolver -> price_snapshot -> scoring.

Honors the same PREDICTABLE_DB env-var pattern as the rest of the pipeline
(see pipeline/paths.py) — set it to point at an alternate SQLite file.

Usage:
    python -m pipeline.enrich.run_all
"""
from __future__ import annotations

import sys
import time
import traceback

from pipeline.enrich import apply_admin, build_sagas, market_resolver, price_snapshot, scoring, snapshot_scoreboard
from pipeline.paths import SQLITE


def main() -> int:
    print(f"[enrich] db: {SQLITE}")
    overall_ok = True

    for name, fn in (
        ("market_resolver", market_resolver.resolve_all),
        # After the resolver so each saga inherits its calls' market link.
        ("build_sagas", build_sagas.build_all),
        ("price_snapshot", price_snapshot.snapshot_all),
        ("scoring", scoring.score_all),
        # MUST run after scoring (scoring resets status/realized_pct each run);
        # admin is the source of truth that wins last.
        ("apply_admin", apply_admin.apply_all),
        # LAST: the public-trend snapshot must see the post-admin state
        # (hides re-stamped, manual calls re-created) or it contradicts the
        # live /api/scoreboard.
        ("snapshot_scoreboard", snapshot_scoreboard.snapshot),
    ):
        t0 = time.monotonic()
        print(f"[enrich] --- {name} ---")
        try:
            stats = fn()
            dt = time.monotonic() - t0
            print(f"[enrich] {name} ok ({dt:.1f}s): {stats}")
        except Exception:  # noqa: BLE001 — surface error, keep going to next stage
            traceback.print_exc()
            overall_ok = False
            print(f"[enrich] {name} FAILED — continuing to next stage")

    return 0 if overall_ok else 1


if __name__ == "__main__":
    sys.exit(main())
