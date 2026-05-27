#!/usr/bin/env bash
# Production server-side refresh.
# Runs hourly via cron. Pulls latest extraction JSON from GitHub, reloads
# SQLite, restarts the API. Idempotent — if nothing new, exits quickly.
#
# Install on the server:
#   sudo crontab -e
#   17 * * * * /opt/predictable-repo/deploy/refresh.sh >>/var/log/predictable-refresh.log 2>&1

set -e

REPO=/opt/predictable-repo
DB=/var/lib/predictable/predictable.sqlite
PM2=/usr/local/bin/pm2

cd "$REPO"

# Fetch + check for new commits
git fetch --quiet origin main
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "[$(date -Is)] up to date ($LOCAL)"
  exit 0
fi

echo "[$(date -Is)] pulling $LOCAL -> $REMOTE"
git pull --quiet --ff-only origin main

# Load any new extraction data into SQLite
PREDICTABLE_DB="$DB" python3 -m pipeline.load 2>&1

# Probe market resolutions, then hard+soft score, then refresh scoreboard snapshot
PREDICTABLE_DB="$DB" python3 -m pipeline.enrich.probe_resolutions 2>&1 || echo "probe failed"
PREDICTABLE_DB="$DB" python3 -m pipeline.enrich.scoring 2>&1 || echo "scoring failed"

# Bounce the API so better-sqlite3 reopens the file
$PM2 restart predictable-api --update-env >/dev/null 2>&1 || $PM2 restart predictable-api >/dev/null 2>&1

echo "[$(date -Is)] refreshed to $REMOTE"
