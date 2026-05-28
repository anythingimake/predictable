# Operations runbook

> When something looks wrong on https://predictable.anythingimake.com, start here.

## Health check

```bash
curl -s https://predictable.anythingimake.com/api/health
# → {"ok":true,"ts":"…"}

curl -s -o /dev/null -w "%{http_code}\n" https://predictable.anythingimake.com/
# → 200
```

If either fails → see "Site is down" below.

## Quick state probes

```bash
# Counts
ssh root@5.78.89.136 'python3 -c "import sqlite3;c=sqlite3.connect(\"/var/lib/predictable/predictable.sqlite\");print(list(c.execute(\"SELECT status, COUNT(*) FROM calls GROUP BY status\")))"'

# Recent extraction commits (loop 2)
gh -R anythingimake/predictable run list --limit 5
git log --oneline --grep="Extract" -5

# Recent cron runs (loop 3)
ssh root@5.78.89.136 'tail -20 /var/log/predictable-refresh.log'
ssh root@5.78.89.136 'tail -20 /var/log/predictable-prices.log'

# pm2 status
ssh root@5.78.89.136 'pm2 list'
```

## Common failure modes

### "Site is down" (frontend returns 5xx or nothing)

1. Is the API up? `curl -s https://predictable.anythingimake.com/api/health`
   - No → see "API is down"
   - Yes → it's nginx or static assets. `ssh root@5.78.89.136 "nginx -t && systemctl reload nginx"` and check `/var/www/predictable/index.html` exists.
2. Cloudflare edge issue? Try cache-busting with `?v=$(date +%s)` on the URL.

### "API is down"

1. `ssh root@5.78.89.136 "pm2 list"` — is `predictable-api` `online` or `errored`?
2. `pm2 logs predictable-api --lines 50 --nostream` — look for the actual error.
3. Common causes:
   - **`SQLITE_READONLY`** — the DB file got opened by a writer with `journal_mode=DELETE` and the API reader can't write the journal back. We dropped pragma SETs on the readonly connection to fix this; if it recurs, check `api/src/db.ts` for new pragma calls.
   - **`EADDRINUSE`** — someone else is on port 3801. `ss -tlnp | grep 3801` to find them; usually a stale pm2 process. `pm2 kill && pm2 start /opt/predictable-api/dist/server.js --name predictable-api --update-env`.
   - **Schema mismatch** — the SQLite was deployed without the latest schema. Compare `api/src/schema.sql` against `PRAGMA table_info(…)` on the live DB.

### "Scoreboard hit rate looks wrong"

1. `ssh root@5.78.89.136 "python3 -c '…SELECT status, COUNT(*) FROM calls GROUP BY status…'"`
2. If `resolved_calls` is way off: `python3 -m pipeline.enrich.scoring` to recompute (idempotent).
3. If a known win is missing: check the call's `events` — does it have an `entry` event with `price_pct`? Scoring skips calls without an entry price.
4. If a false win is showing: probably a bad `market_id` match. Find the call, NULL its `market_id`, re-run resolver.

### "Charts say 'No price history' on a call"

Two paths:
1. The call has `market_id IS NULL` — the resolver didn't match. Check the `unresolved_markets-{date}.json` log in `data/logs/` for why.
2. The call has a market but no snapshots. Run `python3 -m pipeline.enrich.price_snapshot` to backfill historical candles. For resolved markets, the snapshot module pulls Polymarket `prices-history?interval=1d` or Kalshi `/series/{series}/markets/{ticker}/candlesticks`.

### "New episode hasn't been transcribed"

1. Is your local machine on? Loop 1 needs Windows running.
2. `Get-ScheduledTaskInfo -TaskName "Predictable_Nightly_Pipeline"` — when did it last run?
3. `Get-Content ~/predictable-nightly.log -Tail 30` — what's the latest log line?
4. Force-run: `Start-ScheduledTask -TaskName "Predictable_Nightly_Pipeline"`.

### "New transcript exists but no calls extracted"

1. Is the routine running? Check at https://claude.ai/code/routines/trig_01QbCvat28v7JNWYCKcAUPyv
2. Click "Run now" to fire ad-hoc.
3. Routine output should land as a commit `Extract N transcripts: …` from `anythingimake`.

### "Cron-extracted calls aren't linked to markets"

`refresh.sh` runs `market_resolver` automatically (after that wire-up landed). If you see calls with `market_id IS NULL`:
1. `ssh root@5.78.89.136 "cd /opt/predictable-repo && PREDICTABLE_DB=/var/lib/predictable/predictable.sqlite python3 -m pipeline.enrich.market_resolver 2>&1 | tail -20"`
2. Check the matcher's gate — calls with no plausible match stay null and write to `data/logs/unresolved_markets-{date}.json`.

### "False market match (Roy Cooper → Jon Cooper kind)"

1. NULL the bad `market_id`:
   ```sql
   UPDATE calls SET market_id = NULL WHERE id = …;
   ```
2. Re-run resolver. If it re-attaches to the same wrong market, tighten `pipeline/enrich/market_resolver.py:_strong_tokens` and `match_market` gate.

### "Refresh.sh fails"

1. `ssh root@5.78.89.136 "tail -30 /var/log/predictable-refresh.log"`
2. Common: git pull conflict (someone edited a file on the server). `git checkout -- <file>` then re-run.
3. Common: Python import error after a code change. `cd /opt/predictable-repo && python3 -m pipeline.load` to repro outside cron.

### "Price poll fails or slows"

1. `ssh root@5.78.89.136 "tail -30 /var/log/predictable-prices.log"`
2. If Kalshi or Polymarket rate-limits us, the script logs the error per market and skips that one. The next cycle retries. No alarm needed unless we see persistent failures across many markets.

## Logs cheat sheet

| Log | Location | Frequency |
|---|---|---|
| Refresh (loop 3 full) | `/var/log/predictable-refresh.log` | every 30 min |
| Price poll (loop 3 fast) | `/var/log/predictable-prices.log` | every 2 min |
| pm2 stdout | `~/.pm2/logs/predictable-api-out.log` | per request |
| pm2 stderr | `~/.pm2/logs/predictable-api-error.log` | on error |
| nginx access | `/var/log/nginx/access.log` | per request |
| nginx error | `/var/log/nginx/error.log` | on error |
| Local nightly | `~/predictable-nightly.log` (Windows) | nightly |

## When in doubt

- `docs/architecture.md` — what the system does
- `docs/data-model.md` — what the data means
- `docs/cron.md` — exact pipeline steps + commands
- `docs/api.md` — endpoint surface
- `docs/deploy.md` — how to ship a change

## Known outstanding work

See `docs/cron.md` "What's not yet done". Highest-priority items:
- Failure pings — cron silently logs 500s; nobody knows until they check the site
- Multi-exchange linking — same race on Kalshi AND Polymarket is captured as two unrelated markets
- Manual override table — fix false matches in a way that survives `pipeline.load` idempotent re-runs
