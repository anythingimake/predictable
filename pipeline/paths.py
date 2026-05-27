"""Canonical filesystem paths for the pipeline. Single source of truth."""
import os
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "data"
AUDIO = DATA / "audio"
TRANSCRIPTS = DATA / "transcripts"
INGEST_RAW = DATA / "ingest"
LOGS = DATA / "logs"

# SQLite path — honor PREDICTABLE_DB env var so the production server can
# point at /var/lib/predictable/predictable.sqlite while local dev uses the
# in-repo file. Falls back to data/predictable.sqlite.
SQLITE = Path(os.environ.get("PREDICTABLE_DB", DATA / "predictable.sqlite"))

for _p in (DATA, AUDIO, TRANSCRIPTS, INGEST_RAW, LOGS):
    _p.mkdir(parents=True, exist_ok=True)


def ingest_dir(source: str) -> Path:
    """Per-source raw JSON staging area (e.g. data/ingest/megaphone/)."""
    p = INGEST_RAW / source
    p.mkdir(parents=True, exist_ok=True)
    return p
