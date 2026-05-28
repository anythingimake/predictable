#!/usr/bin/env bash
# Production server-side refresh.
# Runs hourly via cron. Pulls latest extraction JSON from GitHub, reloads
# SQLite, restarts the API. Idempotent — if nothing new, exits quickly.
#
# Install on the server:
#   sudo crontab -e
#   17 * * * * /opt/predictable-repo/deploy/refresh.sh >>/var/log/predictable-refresh.log 2>&1
#
# Pipeline steps (in order):
#   1. git pull         — fetch new extraction JSON from cloud routine
#   2. sync_substack    — pull bodies + comments for any new episodes' substack_slugs
#   3. pipeline.load    — load JSON into SQLite (idempotent per episode)
#   4. market_resolver  — match new calls' market_hint → actual markets
#   5. cross_reference_youtube — link Megaphone episodes to YouTube videos
#   6. probe_resolutions — refresh market resolution + current price
#   7. price_snapshot   — daily price candles for live + resolved markets
#   8. scoring          — hard+soft score, refresh scoreboard_snapshot
#   9. pm2 restart      — bounce API so better-sqlite3 reopens the DB
#
# Steps 2 + 4 + 5 are SAFE TO SKIP between runs (idempotent), so missing-data
# fixes happen on the next tick. Per-step `|| echo "X failed"` ensures one
# bad source (e.g., YouTube IP-banned) doesn't kill the chain.

set -e

REPO=/opt/predictable-repo
DB=/var/lib/predictable/predictable.sqlite
PM2=/usr/local/bin/pm2

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
# the hourly tick so live data stays fresh between extraction routines.
if [ "$NEW_COMMITS" = "1" ]; then
  echo "[$(date -Is)] pulling $LOCAL -> $REMOTE"
  git pull --quiet --ff-only origin main
else
  echo "[$(date -Is)] up to date ($LOCAL) — running data-refresh subset"
fi

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

# Link new Megaphone episodes to YouTube videos by date + duration. Refreshes
# view/like counts for already-linked episodes when --refresh-meta is passed
# (skipped here on hourly tick to keep things cheap).
PREDICTABLE_DB="$DB" python3 -m pipeline.enrich.cross_reference_youtube 2>&1 || echo "cross_reference_youtube failed"

# Probe market resolutions + current price for every market in the DB.
PREDICTABLE_DB="$DB" python3 -m pipeline.enrich.probe_resolutions 2>&1 || echo "probe failed"

# Daily price candles for live + resolved markets (idempotent — same-day rows
# get UPSERT'd with the latest price).
PREDICTABLE_DB="$DB" python3 -m pipeline.enrich.price_snapshot 2>&1 || echo "price_snapshot failed"

# Hard+soft score, refresh today's scoreboard_snapshot.
PREDICTABLE_DB="$DB" python3 -m pipeline.enrich.scoring 2>&1 || echo "scoring failed"

# Bounce the API so better-sqlite3 reopens the file
$PM2 restart predictable-api --update-env >/dev/null 2>&1 || $PM2 restart predictable-api >/dev/null 2>&1

echo "[$(date -Is)] refresh done (commits: $LOCAL -> $REMOTE)"
