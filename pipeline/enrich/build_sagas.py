"""
Rebuild the saga set (recurring markets Stu returns to across >= 2 episodes).

Runs as an enrich step AFTER market_resolver so each saga can inherit the market
link its calls resolved to. The actual logic lives in pipeline.load.load_sagas
(deterministic stable ids, stale-row pruning) — this is just the orchestrator
entry point, mirroring the other enrich stages' `*_all()` shape.

Usage: python -m pipeline.enrich.build_sagas
"""
from __future__ import annotations

import json

from pipeline.db import connect
from pipeline.load import load_sagas


def build_all() -> dict:
    with connect() as conn:
        n = load_sagas(conn)
    return {"sagas": n}


if __name__ == "__main__":
    print(json.dumps(build_all()))
