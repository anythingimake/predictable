# Predictable — Unofficial Tracker

> Fan-built tracker for Stu Burguiere's [*Predictable*](https://predictable.substack.com/) show — documents Stu's prediction-market positions, recommendations, lifecycle events (entries / adds / trims / exits), and results across Kalshi, Polymarket, and PredictIt.

**Live:** [predictable.anythingimake.com](https://predictable.anythingimake.com)

## What it does

Every day, an automated pipeline:

1. Pulls the latest Predictable episode from the Megaphone podcast feed
2. Transcribes the audio with local two-pass Whisper (free, no API)
3. Uses Claude to extract Stu's calls — markets discussed, side taken, conviction tier, entry price, cleaned quotes, episode timestamps
4. Pulls the matching Substack post body + reader comments (Q&A often clarifies positions)
5. Snapshots Kalshi / Polymarket / PredictIt prices for every market with an active call
6. Scores resolved positions, recomputes the scoreboard
7. Deploys to the website

After the one-time setup, it runs forever, unattended.

## Architecture

| Layer | Stack |
|---|---|
| **Frontend** | React 19 + Vite 7 + TypeScript + Tailwind CSS v4 + Zustand + react-router 7 + Recharts |
| **API** | Node 22 + Express + better-sqlite3 |
| **Pipeline** | Python 3.14 + faster-whisper + Anthropic SDK + feedparser + requests + yt-dlp |
| **Database** | SQLite (single file, ~5MB) |
| **Hosting** | Hetzner VPS · nginx · Cloudflare DNS+SSL · pm2 |
| **Cron** | Windows Task Scheduler (local) → scp results to VPS nightly |

## Data sources (all public, no API keys)

- **Megaphone podcast RSS** — canonical episode list + MP3 audio
- **Substack JSON API** — post bodies + comments
- **YouTube transcript API** — only for shorts + livestreams (rare)
- **Kalshi REST v2** — markets + historical candlesticks
- **Polymarket Gamma + CLOB** — markets + price history
- **PredictIt** — tertiary cross-reference

## Repo layout

```
app/         React frontend
api/         Express server (read-only SQLite)
pipeline/    Python ingest + transcription + extraction + scoring
deploy/      nginx config, deploy scripts
data/        gitignored — local working copies (SQLite, transcripts, audio)
```

## Quick start

```bash
# Frontend
cd app && npm install && npm run dev

# API
cd api && npm install && npm run dev

# Pipeline (one-time backfill of 18 episodes)
cd pipeline && pip install -r requirements.txt
python main.py --backfill
```

## Disclaimer

This is an **unofficial fan project**. It is not affiliated with, endorsed by, or sponsored by Stu Burguiere, Predictable, or any prediction-market platform. All show content (transcripts, quotes, episode references) is used for documentation and commentary purposes. Market data is sourced from public APIs.

Nothing on this site is investment advice. Prediction markets carry real financial risk.

## License

MIT
