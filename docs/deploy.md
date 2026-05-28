# Deploy

Three things to ship: the React SPA, the Express API, and (occasionally) the SQLite DB file. Plus the cron scripts on the server.

All commands assume you're at the repo root.

## Prerequisites (one-time)

- `gh` CLI authed as `anythingimake` (`gh auth switch -u anythingimake`)
- SSH key authorized for `root@5.78.89.136`
- Node 22 + Python 3.14 locally
- For routine pushes: see `docs/cron.md` for the routine management URL

## SPA (frontend)

```bash
cd app
npm install            # one-time
npm run build          # produces app/dist/
scp -r dist/* root@5.78.89.136:/var/www/predictable/
```

nginx serves `/var/www/predictable/` directly. Hashed Vite assets cache 30d via the nginx config; `index.html` is no-cache so SPA route changes land immediately.

## API

```bash
cd api
npm install            # one-time
npm run build          # produces api/dist/
scp -r dist/* root@5.78.89.136:/opt/predictable-api/dist/
ssh root@5.78.89.136 "pm2 restart predictable-api --update-env"
```

pm2 keeps it alive. `pm2 save` was run once so the process restarts on reboot.

To set env vars (e.g., `PREDICTABLE_ADMIN_TOKEN` or `CORS_ORIGINS`):

```bash
ssh root@5.78.89.136 \
  "PREDICTABLE_ADMIN_TOKEN='…' CORS_ORIGINS='https://predictable.anythingimake.com' \
   pm2 restart predictable-api --update-env && pm2 save"
```

## SQLite DB

You usually DON'T deploy the DB — the server's hourly refresh.sh writes it from JSON in the repo. But if you do hand-edit the DB locally (e.g., to repair a false match) and need to ship that state:

```bash
# Force WAL flush so the .sqlite file has the full state
python -c "import sqlite3; c=sqlite3.connect('data/predictable.sqlite'); c.execute('PRAGMA wal_checkpoint(TRUNCATE)'); c.close()"

# Stop the API so it releases the file
ssh root@5.78.89.136 "pm2 stop predictable-api && rm -f /var/lib/predictable/predictable.sqlite*"

scp data/predictable.sqlite root@5.78.89.136:/var/lib/predictable/predictable.sqlite

ssh root@5.78.89.136 "pm2 start predictable-api --update-env"
```

The `rm -f` step matters — old `-shm` / `-wal` files left behind will confuse the freshly-copied main DB and you'll see stale rows.

## Cron scripts

Cron entries are in `crontab -l` on the server. The scripts themselves live in `/opt/predictable-repo/deploy/` and update via `git pull` (which the cron itself runs).

To change a cron schedule:

```bash
ssh root@5.78.89.136 "crontab -e"
```

## nginx

```bash
scp deploy/nginx.predictable.anythingimake.com.conf \
  root@5.78.89.136:/etc/nginx/sites-available/predictable.anythingimake.com
ssh root@5.78.89.136 "nginx -t && systemctl reload nginx"
```

`nginx -t` validates before reload; if it fails, nginx stays on the old config.

## DNS

`predictable.anythingimake.com` is a Cloudflare-proxied A record → `5.78.89.136`. Edits via the Cloudflare dashboard. Origin SSL cert at `/etc/ssl/anythingimake.pem` + `.key` (shared with other `anythingimake.com` subdomains).

## git

The repo is at `https://github.com/anythingimake/predictable`. Pushing requires `gh auth switch -u anythingimake` first (`nby578` is your default but only has pull access).

```bash
git add … && git commit -m "…" && git push
```

If push fails with `Permission denied to nby578`, run the auth switch and retry.

## Verification after deploy

```bash
# Frontend
curl -s -o /dev/null -w "%{http_code}\n" https://predictable.anythingimake.com/

# API
curl -s https://predictable.anythingimake.com/api/health
curl -s https://predictable.anythingimake.com/api/scoreboard | python -m json.tool | head -20

# Cron (force-run instead of waiting)
ssh root@5.78.89.136 "/opt/predictable-repo/deploy/refresh.sh 2>&1 | tail -10"
ssh root@5.78.89.136 "/opt/predictable-repo/deploy/poll_prices.sh 2>&1 | tail -3"
```

## Rollback

```bash
# Frontend
ssh root@5.78.89.136 "cd /var/www/predictable && ls -t | head"  # find prior build
# (or just rebuild from an earlier commit and scp again)

# API
ssh root@5.78.89.136 "pm2 list && pm2 logs predictable-api --lines 20"
# pm2 keeps no rolling history; rebuild from the prior commit and scp

# DB
ssh root@5.78.89.136 "ls -la /var/lib/predictable/"
# no automatic backups yet — consider a daily sqlite3 .backup snapshot
```

See `docs/operations.md` for failure modes + on-call playbook.
