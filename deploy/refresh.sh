#!/usr/bin/env bash
# Production server-side refresh.
# Runs every 30 minutes via cron. Pulls latest extraction JSON from GitHub,
# rebuilds SQLite in a STAGING copy, atomically swaps it live, restarts the API.
# Idempotent — if nothing new, exits quickly.
#
# Install on the server:
#   sudo crontab -e
#   */30 * * * * /opt/predictable-repo/deploy/refresh.sh >>/var/log/predictable-refresh.log 2>&1
#
# Why a staging copy: load.py DELETEs+reinserts every call, and apply_admin
# re-stamps hides/manual calls only at the END of the chain. Run directly
# against the live DB that left a ~2-minute window every refresh where the
# public API served a half-built dataset (hidden calls visible, manual calls
# missing, wrong scoreboard). Now the live DB is never touched mid-build:
#   build copy -> run all steps -> integrity gate -> flock'd atomic swap.
# Price polls that land on the live DB during the ~2-min build are lost at
# swap; the next 2-minute poll re-writes them. poll_prices.sh shares the same
# flock so a poll can't write during the swap itself.
#
# Pipeline steps (in order, all against the BUILD copy):
#   1. git pull         — fetch new extraction JSON from cloud routine
#   2. sync_substack    — pull bodies + comments for any new episodes' substack_slugs
#   3. pipeline.load    — load JSON into SQLite (idempotent per episode)
#   4. market_resolver  — match new calls' market_hint → actual markets
#   5. build_sagas      — rebuild saga groupings (after resolver)
#   6. cross_reference_youtube — link Megaphone episodes to YouTube videos
#   7. probe_resolutions — refresh market resolution + current price
#   8. price_snapshot   — daily price candles for live + resolved markets
#   9. scoring          — hard+soft score every call
#  10. apply_admin      — stamp admin overrides/hides/manual calls (call_admin → calls)
#  11. snapshot_scoreboard — write today's public-trend row (AFTER apply_admin
#                            so the basis matches the live /api/scoreboard)
#  12. integrity gate + atomic swap + pm2 restart
#
# Steps 2 + 4 + 6 are SAFE TO SKIP between runs (idempotent), so missing-data
# fixes happen on the next tick. Per-step `|| echo "X failed"` ensures one
# bad source (e.g., YouTube IP-banned) doesn't kill the chain. apply_admin MUST
# stay after scoring (scoring resets status/realized_pct every run), and the
# scoreboard snapshot MUST stay after apply_admin. A hard failure in load (no
# `||` guard) aborts the build and the live DB keeps serving untouched.

set -e

REPO=/opt/predictable-repo
LIVE=/var/lib/predictable/predictable.sqlite
DB=/var/lib/predictable/predictable-build.sqlite   # all steps run against this
LOCK=/var/lock/predictable-db.lock
PM2=/usr/bin/pm2

cd "$REPO"

# Fetch + check for new commits
git fetch --quiet origin main
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

NEW_COMMITS=1
if [ "$LOCAL" = "$REMOTE" ]; then
  NEW_COMMITS=0
fi

# When new commits land we always run the full pipeline. When nothing's new we
# still run the cheap re-pulls (substack comments, market probe, scoring) on
# the half-hour tick so live data stays fresh between extraction routines.
if [ "$NEW_COMMITS" = "1" ]; then
  echo "[$(date -Is)] pulling $LOCAL -> $REMOTE"
  git pull --quiet --ff-only origin main
else
  echo "[$(date -Is)] up to date ($LOCAL) — running data-refresh subset"
fi

# Stage: consistent copy of the live DB (sqlite .backup is safe against
# concurrent writers like the 2-minute price poll).
rm -f "$DB" "$DB-wal" "$DB-shm"
sqlite3 "$LIVE" ".backup '$DB'"

# Substack re-pull — bodies for new episodes, comments for episodes < 14 days
# old (for newer Stu Q&A). Idempotent: skips slugs whose snapshot exists.
PREDICTABLE_DB="$DB" python3 -m pipeline.sync_substack 2>&1 || echo "sync_substack failed"
PREDICTABLE_DB="$DB" python3 -m pipeline.sync.repull_recent_comments 2>&1 || echo "comment-repull failed"

# Load any new extraction data into SQLite
PREDICTABLE_DB="$DB" python3 -m pipeline.load 2>&1

# Match new calls (market_id IS NULL) to actual markets. Conservative gating
# (state/office/team/year buckets) means false matches are filtered upstream;
# unmatched calls land in data/logs/unresolved_markets-{date}.json.
PREDICTABLE_DB="$DB" python3 -m pipeline.enrich.market_resolver 2>&1 || echo "market_resolver failed"

# Rebuild sagas (recurring markets across episodes) AFTER the resolver so each
# saga inherits its calls' market link. Dedupes wording variants to one stable
# row and prunes stale rows. Idempotent.
PREDICTABLE_DB="$DB" python3 -m pipeline.enrich.build_sagas 2>&1 || echo "build_sagas failed"

# Link new Megaphone episodes to YouTube videos by date + duration. Refreshes
# view/like counts for already-linked episodes when --refresh-meta is passed
# (skipped here on the half-hour tick to keep things cheap).
PREDICTABLE_DB="$DB" python3 -m pipeline.enrich.cross_reference_youtube 2>&1 || echo "cross_reference_youtube failed"

# Probe market resolutions + current price for every market in the DB.
PREDICTABLE_DB="$DB" python3 -m pipeline.enrich.probe_resolutions 2>&1 || echo "probe failed"

# Daily price candles for live + resolved markets (idempotent — same-day rows
# get UPSERT'd with the latest price).
PREDICTABLE_DB="$DB" python3 -m pipeline.enrich.price_snapshot 2>&1 || echo "price_snapshot failed"

# Hard+soft score every call.
PREDICTABLE_DB="$DB" python3 -m pipeline.enrich.scoring 2>&1 || echo "scoring failed"

# Apply admin overrides/hides/manual calls (call_admin -> calls). MUST run after
# scoring, which resets status/realized_pct for every call; admin wins last.
PREDICTABLE_DB="$DB" python3 -m pipeline.enrich.apply_admin 2>&1 || echo "apply_admin failed"

# Public-trend snapshot — AFTER apply_admin so the recorded basis (hides
# applied, manual calls present) matches the live /api/scoreboard.
PREDICTABLE_DB="$DB" python3 -m pipeline.enrich.snapshot_scoreboard 2>&1 || echo "snapshot_scoreboard failed"

# Integrity gate: a corrupt/incomplete build must never go live.
sqlite3 "$DB" "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null 2>&1 || true
CHECK=$(sqlite3 "$DB" "PRAGMA quick_check;" 2>&1 || echo "quick_check errored")
if [ "$CHECK" != "ok" ]; then
  echo "[$(date -Is)] BUILD FAILED integrity ($CHECK) — live DB untouched"
  exit 1
fi

# Atomic swap under the shared DB lock (poll_prices.sh takes the same lock, so
# a poll can never write the live file mid-swap). Same filesystem -> mv is an
# atomic rename. Stale -wal/-shm from the old database are removed so the new
# file can't pair with them.
(
  flock -w 60 9 || { echo "[$(date -Is)] swap SKIPPED — could not get DB lock"; exit 1; }
  $PM2 stop predictable-api >/dev/null 2>&1 || true
  sqlite3 "$LIVE" "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null 2>&1 || true
  mv "$DB" "$LIVE"
  rm -f "$LIVE-wal" "$LIVE-shm"
  $PM2 restart predictable-api --update-env >/dev/null 2>&1 || $PM2 restart predictable-api >/dev/null 2>&1 || echo "pm2 restart failed"
) 9>"$LOCK"

echo "[$(date -Is)] refresh done (commits: $LOCAL -> $REMOTE)"
