# Architecture

> How the pieces fit together. Read this once; then `docs/cron.md` for what runs when, `docs/data-model.md` for the schema, `docs/api.md` for the endpoint surface, `docs/deploy.md` for shipping, `docs/operations.md` for the runbook.

## One-screen overview

```
   ┌──────────────────────────────────────────────────────────────────┐
   │  USER's local Windows machine                                    │
   │                                                                  │
   │  ┌──────────────┐    ┌───────────────────┐    ┌──────────────┐   │
   │  │ Megaphone    │ →  │ faster-whisper    │ →  │ git push     │   │
   │  │ RSS poll     │    │ (small + large-v3 │    │ transcripts  │   │
   │  │ + MP3 dl     │    │  two-pass)        │    │ to GitHub    │   │
   │  └──────────────┘    └───────────────────┘    └──────┬───────┘   │
   │  Task Scheduler · daily 2:05am                       │           │
   └──────────────────────────────────────────────────────┼───────────┘
                                                          │
                                                          ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │  ANTHROPIC cloud (Claude Code routine, subscription-priced)      │
   │                                                                  │
   │  Clone repo → for each new transcript:                           │
   │    • extract_calls.md   → data/ingest/extract/{guid}-calls.json  │
   │    • extract_principles.md → -principles.json                    │
   │    • extract_strategies.md → -strategies.json                    │
   │    • extract_qa.md (against Substack comments) → -qa.json        │
   │  Run deterministic sagas detection → _sagas.json                 │
   │  Commit + push                                                   │
   │                                                                  │
   │  Routine trig_01QbCvat28v7JNWYCKcAUPyv · daily 7:15 UTC          │
   └──────────────────────────────────────────────────────┬───────────┘
                                                          │
                                                          ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │  PRODUCTION server (Hetzner VPS · 5.78.89.136)                   │
   │                                                                  │
   │  ┌──────────────────────────────┐   ┌──────────────────────────┐ │
   │  │ Fast cron · every 2 min      │   │ Full cron · every 30 min │ │
   │  │ deploy/poll_prices.sh        │   │ deploy/refresh.sh        │ │
   │  │   price_poll for open-call   │   │   git pull               │ │
   │  │   markets only               │   │   pipeline.load          │ │
   │  │                              │   │   probe_resolutions      │ │
   │  │   ~5s per run                │   │   market_resolver        │ │
   │  │                              │   │   sync_substack          │ │
   │  │                              │   │   price_snapshot (full)  │ │
   │  │                              │   │   scoring                │ │
   │  │                              │   │   pm2 restart            │ │
   │  └──────────┬───────────────────┘   └────────┬─────────────────┘ │
   │             │                                │                   │
   │             ▼                                ▼                   │
   │  ┌──────────────────────────────────────────────────────────┐    │
   │  │  SQLite  /var/lib/predictable/predictable.sqlite         │    │
   │  └──────────────────────────────┬───────────────────────────┘    │
   │                                 │                                │
   │                                 ▼                                │
   │  ┌──────────────────────────────────────────────────────────┐    │
   │  │  Express API (pm2 service · port 3801)                   │    │
   │  │  read-only better-sqlite3, JSON only, CORS-locked        │    │
   │  └──────────────────────────────┬───────────────────────────┘    │
   │                                 │                                │
   │                                 ▼                                │
   │  ┌──────────────────────────────────────────────────────────┐    │
   │  │  nginx + Cloudflare → predictable.anythingimake.com      │    │
   │  │   /         → /var/www/predictable/ (React SPA)          │    │
   │  │   /api/*    → http://127.0.0.1:3801                      │    │
   │  └──────────────────────────────────────────────────────────┘    │
   └──────────────────────────────────────────────────────────────────┘
```

## Where things live

| Layer | Stack | Path |
|---|---|---|
| Frontend SPA | React 19 + Vite 7 + TS + Tailwind v4 + Zustand + react-router 7 + Recharts (lazy) | `app/` |
| API | Node 22 + Express + better-sqlite3 (read-only) | `api/` |
| Pipeline | Python 3.14 + faster-whisper + Anthropic SDK + feedparser + yt-dlp + requests | `pipeline/` |
| Deploy | shell scripts + nginx conf + Task Scheduler PS1 | `deploy/` |
| Local working data | gitignored except `data/transcripts/` and `data/ingest/` | `data/` |
| Docs | this directory | `docs/` |

## Why the three-tier cron

- **Local Whisper** runs at home because (a) it's free at scale (CPU only, no cloud STT bill), (b) transcripts are large and we don't want to ship raw audio to a third party, (c) cadence is once-a-day so latency doesn't matter.
- **Cloud Claude** runs on Anthropic infra because (a) it uses Noah's Claude Code subscription instead of paying for API tokens, (b) it has clean GitHub access via the routine, (c) extraction is the only step that genuinely needs LLM reasoning.
- **Server fast/full cron** runs because (a) prices change minute-by-minute and the rest doesn't, (b) keeping them in separate scripts means the cheap one stays cheap.

## Data flow contract

The pipeline is layered so each step has a clear input/output:

1. **Audio in → transcript out** (Whisper) — `data/audio/*.mp3` → `data/transcripts/{guid}.json`
2. **Transcript in → extraction out** (Claude) — `data/transcripts/{guid}.json` → `data/ingest/extract/{guid}-{calls|principles|strategies|qa}.json`
3. **JSON files in → SQLite out** (loader) — `pipeline.load` walks `data/ingest/` and `data/transcripts/`, upserts into the DB
4. **SQLite in → market_id stamped** (resolver) — `pipeline.enrich.market_resolver` matches `calls.market_hint` to Kalshi/Polymarket
5. **Market in → prices out** (snapshot/poll) — periodic refresh of `markets.current_price` + `market_price_snapshots`
6. **Prices + events in → realized_pct out** (scoring) — `pipeline.enrich.scoring` (hard + soft resolve)
7. **SQLite in → API JSON out** (Express) — read-only queries to serve the frontend

Each step is idempotent, runnable independently, and has a single CLI entry. See `docs/cron.md` for the exact commands.

## What the API exposes

See `docs/api.md`. Briefly: episodes, calls, markets, scoreboard, calendar, principles, sagas, glossary, search, plus admin notes.

## What the frontend renders

See routes in `app/src/App.tsx`. Briefly: Scoreboard (home), Calls (filterable list), CallDetail, Episodes, EpisodeDetail, Calendar, Calculator, Guide, About, Admin.

## Why SQLite

- Single file, easy to scp to the server
- Better-sqlite3 is synchronous + fast for our read workload (no connection pool, no async dance)
- Schema fits in `api/src/schema.sql` — 20 tables, fully indexed
- Total size for v1: < 5 MB

When it stops fitting we'll move to Postgres. Not yet.

## Identity

The public repo is owned by GitHub user `anythingimake` (Noah's persona "Benjamin"). All commits in the public history use the email `288127182+anythingimake@users.noreply.github.com` so the personal handle stays scrubbed. See `docs/deploy.md` for the `gh auth switch` dance when pushing.
