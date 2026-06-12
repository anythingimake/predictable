"""
Write today's scoreboard_snapshots row (the /api/scoreboard/history feed).

Split out of scoring so it can run LAST in the refresh — after apply_admin has
re-stamped hides and re-created manual calls. Taken inside scoring (the old
home) the snapshot recorded a mid-pipeline basis with hidden calls visible and
manual calls absent, so the public trend permanently contradicted the live
/api/scoreboard headline (64 vs 57 total calls).

Usage:
    PREDICTABLE_DB=... python -m pipeline.enrich.snapshot_scoreboard
"""
from __future__ import annotations

import json

from pipeline.db import connect
from pipeline.enrich.scoring import _snapshot_scoreboard


def snapshot() -> dict:
    with connect() as conn:
        return _snapshot_scoreboard(conn)


if __name__ == "__main__":
    print(json.dumps(snapshot(), indent=2))
