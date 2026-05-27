"""Canonical filesystem paths for the pipeline. Single source of truth."""
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "data"
AUDIO = DATA / "audio"
TRANSCRIPTS = DATA / "transcripts"
INGEST_RAW = DATA / "ingest"
LOGS = DATA / "logs"
SQLITE = DATA / "predictable.sqlite"

for _p in (DATA, AUDIO, TRANSCRIPTS, INGEST_RAW, LOGS):
    _p.mkdir(parents=True, exist_ok=True)


def ingest_dir(source: str) -> Path:
    """Per-source raw JSON staging area (e.g. data/ingest/megaphone/)."""
    p = INGEST_RAW / source
    p.mkdir(parents=True, exist_ok=True)
    return p
