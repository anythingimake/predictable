-- Predictable v1.0 — canonical SQLite schema
-- Read by api/src/db.ts (Express) and pipeline/db.py (loader).

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- Episodes (canonical from Megaphone, enriched with YouTube + Substack)
CREATE TABLE IF NOT EXISTS episodes (
  id              TEXT PRIMARY KEY,            -- megaphone guid
  publish_date    DATE NOT NULL,
  type            TEXT NOT NULL DEFAULT 'episode',  -- episode | livestream | short | guest | article
  megaphone_title TEXT,
  youtube_title   TEXT,
  substack_title  TEXT,
  youtube_id      TEXT,
  substack_slug   TEXT,
  audio_url       TEXT,
  duration_sec    INTEGER,
  view_count      INTEGER,
  like_count      INTEGER,
  comment_count   INTEGER,
  transcript_text TEXT,
  substack_body   TEXT,
  chapter_json    TEXT,                        -- JSON array
  cover_image_url TEXT,
  ingested_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Markets (Kalshi, Polymarket, PredictIt)
CREATE TABLE IF NOT EXISTS markets (
  id              TEXT PRIMARY KEY,            -- '{source}:{ticker}'
  source          TEXT NOT NULL,
  ticker          TEXT NOT NULL,
  question        TEXT NOT NULL,
  category        TEXT,
  subject_tags    TEXT,                        -- JSON array
  resolution_date DATE,
  resolved        INTEGER DEFAULT 0,
  resolution      TEXT,
  current_price   REAL,
  meta_json       TEXT,
  -- Researched "effective" resolution: the real-world event is over and we have
  -- a cited outcome, even though the exchange hasn't formally settled (or set a
  -- bogus far-future close date). Populated by pipeline.enrich.resolve_events
  -- (LLM + web research) and loaded from data/ingest/resolutions/. Distinct from
  -- `resolved`/`resolution`, which are reserved for an actual exchange settlement.
  effective_resolution TEXT,                     -- 'yes' | 'no'
  effective_detail     TEXT,                     -- e.g. 'Paxton def. Cornyn 63.8%-36.2%, +27.6 pts'
  effective_event_date TEXT,                     -- real event date (YYYY-MM-DD)
  effective_source     TEXT,                     -- citation URL
  effective_confidence TEXT,                     -- 'high' | 'medium' | 'low'
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS market_price_snapshots (
  market_id       TEXT NOT NULL,
  snapshot_date   DATE NOT NULL,
  price           REAL NOT NULL,
  volume          REAL,
  PRIMARY KEY (market_id, snapshot_date),
  FOREIGN KEY (market_id) REFERENCES markets(id)
);

-- Calls (Stu's positions)
CREATE TABLE IF NOT EXISTS calls (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id       TEXT,                        -- null until resolved by enrich/market_resolver
  market_hint     TEXT NOT NULL,               -- raw text from extraction
  episode_id      TEXT NOT NULL,
  first_event_ts  INTEGER,
  side            TEXT NOT NULL,
  conviction      TEXT NOT NULL,
  size_disclosed  TEXT,
  speaker         TEXT DEFAULT 'stu',
  status          TEXT NOT NULL DEFAULT 'open',-- open | closed | resolved
  realized_pct    REAL,
  stu_claimed_pct REAL,
  notes           TEXT,
  tags            TEXT NOT NULL DEFAULT '[]',  -- JSON array of broad + specific tag strings
  hidden          INTEGER NOT NULL DEFAULT 0,  -- admin-hidden from public views; stamped by enrich/apply_admin
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (market_id) REFERENCES markets(id),
  FOREIGN KEY (episode_id) REFERENCES episodes(id)
);

CREATE TABLE IF NOT EXISTS call_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id         INTEGER NOT NULL,
  episode_id      TEXT NOT NULL,
  timestamp_sec   INTEGER NOT NULL,
  event_type      TEXT NOT NULL,               -- entry | add | trim | exit | resolve | clarify
  price_pct       REAL,
  size_pct_of_pos REAL,
  quote           TEXT,                        -- cleaned
  raw_quote       TEXT,
  FOREIGN KEY (call_id) REFERENCES calls(id),
  FOREIGN KEY (episode_id) REFERENCES episodes(id)
);

CREATE TABLE IF NOT EXISTS mentions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id       TEXT,
  market_hint     TEXT NOT NULL,
  episode_id      TEXT NOT NULL,
  timestamp_sec   INTEGER NOT NULL,
  directional     TEXT,                        -- bullish | bearish | neutral | explainer
  quote           TEXT,
  FOREIGN KEY (market_id) REFERENCES markets(id),
  FOREIGN KEY (episode_id) REFERENCES episodes(id)
);

CREATE TABLE IF NOT EXISTS source_media (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id         INTEGER,
  mention_id      INTEGER,
  episode_id      TEXT NOT NULL,
  url             TEXT,
  source_type     TEXT,
  outlet          TEXT,
  title           TEXT,
  FOREIGN KEY (call_id) REFERENCES calls(id),
  FOREIGN KEY (mention_id) REFERENCES mentions(id),
  FOREIGN KEY (episode_id) REFERENCES episodes(id)
);

CREATE TABLE IF NOT EXISTS strategies (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  episode_id      TEXT NOT NULL,
  pattern_type    TEXT,
  description     TEXT,
  FOREIGN KEY (episode_id) REFERENCES episodes(id)
);

CREATE TABLE IF NOT EXISTS strategy_calls (
  strategy_id     INTEGER NOT NULL,
  call_id         INTEGER NOT NULL,
  PRIMARY KEY (strategy_id, call_id),
  FOREIGN KEY (strategy_id) REFERENCES strategies(id),
  FOREIGN KEY (call_id) REFERENCES calls(id)
);

CREATE TABLE IF NOT EXISTS sagas (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  market_id       TEXT,
  status          TEXT NOT NULL DEFAULT 'live',
  FOREIGN KEY (market_id) REFERENCES markets(id)
);

CREATE TABLE IF NOT EXISTS saga_episodes (
  saga_id         INTEGER NOT NULL,
  episode_id      TEXT NOT NULL,
  PRIMARY KEY (saga_id, episode_id),
  FOREIGN KEY (saga_id) REFERENCES sagas(id),
  FOREIGN KEY (episode_id) REFERENCES episodes(id)
);

CREATE TABLE IF NOT EXISTS principles (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  rule            TEXT NOT NULL,
  rationale       TEXT,
  first_episode_id TEXT,
  FOREIGN KEY (first_episode_id) REFERENCES episodes(id)
);

CREATE TABLE IF NOT EXISTS principle_citations (
  principle_id    INTEGER NOT NULL,
  episode_id      TEXT NOT NULL,
  timestamp_sec   INTEGER,
  quote           TEXT,
  PRIMARY KEY (principle_id, episode_id, timestamp_sec),
  FOREIGN KEY (principle_id) REFERENCES principles(id),
  FOREIGN KEY (episode_id) REFERENCES episodes(id)
);

CREATE TABLE IF NOT EXISTS comments (
  id              TEXT PRIMARY KEY,
  episode_id      TEXT NOT NULL,
  author          TEXT NOT NULL,
  body            TEXT NOT NULL,
  posted_at       DATETIME,
  is_stu          INTEGER DEFAULT 0,
  parent_id       TEXT,
  FOREIGN KEY (episode_id) REFERENCES episodes(id)
);

CREATE TABLE IF NOT EXISTS call_clarifications (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id         INTEGER NOT NULL,
  comment_id      TEXT NOT NULL,
  clarification   TEXT NOT NULL,
  extracted_value TEXT,
  FOREIGN KEY (call_id) REFERENCES calls(id),
  FOREIGN KEY (comment_id) REFERENCES comments(id)
);

CREATE TABLE IF NOT EXISTS media_vs_markets (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id      TEXT NOT NULL,
  media_outlet    TEXT,
  media_url       TEXT,
  media_take      TEXT,
  market_id       TEXT,
  market_price    REAL,
  stu_frame       TEXT,
  outcome         TEXT,
  FOREIGN KEY (episode_id) REFERENCES episodes(id),
  FOREIGN KEY (market_id) REFERENCES markets(id)
);

CREATE TABLE IF NOT EXISTS glossary (
  term            TEXT PRIMARY KEY,
  definition      TEXT NOT NULL,
  first_episode_id TEXT,
  FOREIGN KEY (first_episode_id) REFERENCES episodes(id)
);

CREATE TABLE IF NOT EXISTS admin_notes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_type      TEXT NOT NULL,
  scope_id        TEXT,
  body            TEXT NOT NULL,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Admin call overrides + manual calls. DB-only side table (NOT in git, like
-- admin_notes); pipeline.enrich.apply_admin stamps these onto `calls` AFTER the
-- pipeline runs (load wipes+reinserts, scoring resets), so admin always wins.
-- One row per calls.id it governs. OVERRIDE row: call_id = an existing pipeline
-- call; non-NULL columns override that call's fields. MANUAL row (is_manual=1):
-- call_id is a deterministic id minted by the API and the row carries the full
-- authored call. The free-text admin note is NOT here — it reuses admin_notes
-- (scope_type='call'), keeping calls.notes free for the resolver 'pin:' channel.
CREATE TABLE IF NOT EXISTS call_admin (
  call_id         INTEGER PRIMARY KEY,         -- governs calls.id (pipeline id OR minted manual id)
  is_manual       INTEGER NOT NULL DEFAULT 0,  -- 1 = admin-created call
  hidden          INTEGER NOT NULL DEFAULT 0,
  -- call-level OVERRIDES (NULL = leave pipeline value alone); also the authored
  -- values for a manual call:
  market_hint     TEXT,
  side            TEXT,                         -- yes|no|over|under
  conviction      TEXT,                         -- play|solid|flyer|watch|opinion|pass
  status          TEXT,                         -- open|closed|resolved
  realized_pct    REAL,
  market_id       TEXT,                         -- admin-forced link
  tags            TEXT,                         -- JSON array string
  -- manual-only fields (ignored for override rows):
  episode_id      TEXT,                         -- REQUIRED for manual (must exist in episodes)
  entry_price     REAL,                         -- cents; drives hybrid outcome + synthesized entry event
  first_event_ts  INTEGER,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scoreboard_snapshots (
  snapshot_date   DATE PRIMARY KEY,
  total_calls     INTEGER,
  resolved_calls  INTEGER,
  hit_count       INTEGER,
  hit_rate        REAL,
  bankroll_pct    REAL,
  by_tier_json    TEXT,
  by_category_json TEXT
);

-- Pipeline housekeeping
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  finished_at     DATETIME,
  episodes_added  INTEGER DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'running',
  error           TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_calls_episode ON calls(episode_id);
CREATE INDEX IF NOT EXISTS idx_calls_market ON calls(market_id);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);
CREATE INDEX IF NOT EXISTS idx_calls_conviction ON calls(conviction);
-- NB: idx_calls_hidden is created by load._ensure_calls_columns AFTER the column
-- is self-migrated onto pre-existing DBs (can't index `hidden` here — init_db
-- runs this whole script, and CREATE TABLE IF NOT EXISTS won't add the column
-- to an already-existing calls table, so indexing it here would fail).
CREATE INDEX IF NOT EXISTS idx_events_call ON call_events(call_id);
CREATE INDEX IF NOT EXISTS idx_events_episode ON call_events(episode_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_market_date ON market_price_snapshots(market_id, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_comments_episode ON comments(episode_id);
CREATE INDEX IF NOT EXISTS idx_mentions_episode ON mentions(episode_id);
CREATE INDEX IF NOT EXISTS idx_episodes_date ON episodes(publish_date);
CREATE INDEX IF NOT EXISTS idx_markets_source ON markets(source);
CREATE INDEX IF NOT EXISTS idx_markets_category ON markets(category);
