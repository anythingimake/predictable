#!/usr/bin/env bash
# Fast price poll — runs every ~2 minutes via cron.
#
# Cheap, idempotent, no git, no restart. Just hit Kalshi/Polymarket for the
# current price of every market with an open call and write today's snapshot.
#
# Shares /var/lock/predictable-db.lock with refresh.sh so a poll can never
# write the live DB during refresh's atomic swap. If the lock is busy (swap in
# progress, a few seconds at most) the poll skips — the next 2-minute tick
# picks it up.
#
# Install on the server:
#   */2 * * * * /opt/predictable-repo/deploy/poll_prices.sh >>/var/log/predictable-prices.log 2>&1

set -e

REPO=/opt/predictable-repo
DB=/var/lib/predictable/predictable.sqlite
LOCK=/var/lock/predictable-db.lock

cd "$REPO"
echo "[$(date -Is)] price poll start"
(
  flock -w 30 9 || { echo "[$(date -Is)] price poll SKIPPED — DB lock busy (refresh swap)"; exit 0; }
  PREDICTABLE_DB="$DB" python3 -m pipeline.enrich.price_poll
  # Truncate WAL so the readonly API reader sees the fresh prices and the WAL
  # doesn't grow unbounded between refreshes.
  sqlite3 "$DB" "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null 2>&1 || true
) 9>"$LOCK"
echo "[$(date -Is)] price poll done"
