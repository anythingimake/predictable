# Predictable — Project Memory

> Fan tracker for Stu Burguiere's [Predictable](https://predictable.substack.com/) show. Live at [predictable.anythingimake.com](https://predictable.anythingimake.com). Plan: `~/.claude/plans/i-think-so-v1-0-graceful-lerdorf.md`.

## Stack

- **Frontend:** React 19.2 + Vite 7.3 + TS 5.9 + Tailwind v4 (`@tailwindcss/vite`) + Zustand 5 + react-router 7 + Recharts (clone of `anythingimake/spoons/app/` minus PWA bits)
- **API:** Node 22 + Express + better-sqlite3 on port 3001 (read-only over SQLite)
- **Pipeline:** Python 3.14 (`python` command — NOT `conda`) + faster-whisper + Anthropic SDK
- **DB:** SQLite (`data/predictable.sqlite`), schema in `api/src/schema.sql`
- **Hosting:** Hetzner VPS 5.78.89.136 (shared with spoons + lineitem) · nginx · Cloudflare proxied A record · pm2

## Quick commands

```bash
# Frontend dev
cd app && npm run dev                # http://localhost:5173

# API dev
cd api && npm run dev                # http://localhost:3001

# Pipeline (full nightly)
python pipeline/main.py

# Pipeline (one-off backfill)
python pipeline/main.py --backfill

# Pipeline (dry-run, no writes)
python pipeline/main.py --dry-run

# Build + deploy
cd app && npm run build && scp -r dist/* root@5.78.89.136:/var/www/predictable/
cd api && npm run build && rsync -avz dist/ root@5.78.89.136:/opt/predictable-api/ \
  && ssh root@5.78.89.136 "pm2 restart predictable-api"
```

## Data sources (all public, no auth)

| Source | URL | Notes |
|---|---|---|
| Megaphone RSS | `https://feeds.megaphone.fm/BMDC7674164347` | Canonical episode list + MP3. Filter `pubDate >= 2026-04-01`. 1,293 total (inherits from "Stu Does America"). |
| Substack archive JSON | `https://predictable.substack.com/api/v1/archive?limit=12&offset=N` | **Paginated, limit capped at 12.** RSS gives only 20 of 28 total. |
| Substack comments JSON | `https://predictable.substack.com/api/v1/posts/{slug}/comments` | |
| YouTube transcript | `youtube-transcript-api` Python lib | **Shorts + livestreams only** — IP-banned us once during probing. |
| YouTube channel | `yt-dlp https://www.youtube.com/@PredictableShow/videos` | Weekly refresh, low touch. |
| Kalshi v2 | `https://api.elections.kalshi.com/trade-api/v2/markets` | + `/events`, `/historical/markets/{ticker}/candlesticks` |
| Polymarket Gamma | `https://gamma-api.polymarket.com/markets` | + `/events` |
| Polymarket CLOB | `https://clob.polymarket.com/prices-history?market={token}&interval=1d` | |
| PredictIt | `https://www.predictit.org/api/marketdata/all/` | Tertiary, ~281 markets |

## Two-pass Whisper (NON-NEGOTIABLE pattern)

1. **Pass 1:** `faster-whisper` `small` model on full audio → segments with `avg_logprob`, `compression_ratio`, `no_speech_prob`
2. **Confidence gate:** flag segments where `avg_logprob < -0.6` OR `no_speech_prob > 0.4` OR `compression_ratio > 2.4`
3. **Pass 2:** `large-v3` re-transcribes ONLY flagged `[start-1s, end+1s]` windows; merge back
4. **Glossary substitution:** canonicalize known terms (Kalshi, Polymarket, candidates) after stitching

This is the user's established pattern — see `~/.claude/projects/C--Users-NoahYaffe/memory/feedback_two_pass_whisper.md`.

## Secrets

The pipeline needs an Anthropic API key for Claude extraction. Set ONE of:
- `export ANTHROPIC_API_KEY=sk-ant-...` in your shell
- `~/.secrets/anthropic.env` containing `ANTHROPIC_API_KEY=sk-ant-...`

Everything else (Megaphone, Substack, YouTube, Kalshi, Polymarket, PredictIt) is public and needs no auth.

## Critical conventions

- **Every Call links to its raw quote + episode timestamp.** Click any call → jumps to the exact second on YouTube/Megaphone player. Source-of-truth verifiability is the app's reason for existing.
- **Capture Stu's claimed return AND the computed return separately.** The 999.79% vs 1000% gap (rounded for the stream) is exactly the discrepancy fans care about.
- **Conviction tiers come from Stu's own vocabulary**: `play` ("in love"), `solid` ("I'm in"), `flyer` ("few shares"), `watch` ("might"), `opinion` (directional only), `pass` (mentioned but skipping).
- **Position size is OPTIONAL** — only captured when Stu names a number. Don't infer.
- **Comments enrich calls.** Substack Q&A where Stu replies often clarifies entry prices, trims, etc. — store as `call_clarifications`.
- **Multi-call strategies are first-class.** The "Vivek ladder" (50/60/70/80% markets used together) and "free ticket" pattern (sure-thing gains fund longshots) are explicit Stu moves — group them.

## Disclaimer

Unofficial fan project. Not affiliated with Stu Burguiere or Predictable. Nothing here is investment advice.

## When in doubt

The plan file at `~/.claude/plans/i-think-so-v1-0-graceful-lerdorf.md` is the source of truth. The `19 locked features`, the schema, the build order, the deploy mechanics — all there.
