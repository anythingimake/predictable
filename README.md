# Predictable

> A fan-built tracker for Stu Burguiere's [Predictable](https://predictable.substack.com) show.
> Every position. Every entry, add, trim, and exit. Every market across Kalshi, Polymarket, and PredictIt.
> Verifiable. Searchable. Free.

**Live:** [predictable.anythingimake.com](https://predictable.anythingimake.com)
**Source:** this repo · MIT license

---

## What this is

*Predictable* is a daily prediction-markets show. The host calls positions on air — "I'd be no at these prices," "took 50% off at 22¢," "free roll from here" — with conviction tiers and explicit returns. Listeners have no good way to see his full track record, verify the math, or browse what he's said about a given market over weeks of episodes.

This site does that. Every call links back to the exact quote, exact second of the episode, and the source media (NYT article, poll, court ruling) that informed it.

## What you'll find here

| Section | Purpose |
|---|---|
| **Scoreboard** | Aggregate hit rate, broken down by conviction tier (★★★ The Play / ★★ Solid / ★ Flyer / ◐ Watch / ◇ Opinion / — Pass), by category, and over time |
| **Calls** | Every individual position, filterable. Click any call → full lifecycle: entries, adds, trims, exits, resolution, with cleaned quotes and timestamps |
| **Episodes** | All episodes with chapters, transcripts, calls made, and embedded comment discussion |
| **Markets** | Per-market history of how Stu's view evolved, with price chart from Kalshi / Polymarket / PredictIt overlaid with his event markers |
| **Calendar** | Resolution dates for every active call — fans can see what's coming |
| **Calculator** | EV, Kelly sizing, half-Kelly, break-even — the math behind any single position |
| **Guide** | Getting started with prediction markets · the framework Stu uses · portfolio theory · glossary |
| **Principles** | Heuristics he repeats ("find what won't happen", "Trump revenge tour ≠ endorsement", "boring is the alpha") with citations to the episodes where he stated them |

## How it stays up to date

After one-time setup, a cron job runs nightly and never needs attention:

1. Pulls the [Megaphone podcast RSS](https://feeds.megaphone.fm/BMDC7674164347) for new episodes
2. Downloads the MP3
3. Transcribes locally with two-pass Whisper (`faster-whisper small` first, then `large-v3` on low-confidence segments only — ~95% of audio handled fast, ~5% rescued at high accuracy)
4. Pulls the matching Substack post body + reader comments (often clarifies positions)
5. Uses Claude to extract positions, conviction tiers, lifecycle events, and references
6. Snapshots Kalshi / Polymarket / PredictIt prices for every market with an active call
7. Scores resolved positions, recomputes the scoreboard
8. Syncs the SQLite database to the production server

Daily ongoing cost: $0 (local Whisper, public APIs, hosted on existing infrastructure).

## Architecture

```
┌─────────────────┐   ┌──────────────┐   ┌─────────────┐
│  Megaphone RSS  │   │   Substack   │   │  YouTube    │
│  (MP3 audio)    │   │  (post body  │   │  (channel   │
│                 │   │   + comments)│   │   + shorts) │
└────────┬────────┘   └──────┬───────┘   └──────┬──────┘
         │                   │                   │
         ▼                   │                   │
┌─────────────────┐          │                   │
│ faster-whisper  │          │                   │
│ two-pass        │          │                   │
│ (small + large) │          │                   │
└────────┬────────┘          │                   │
         │                   │                   │
         ▼                   ▼                   ▼
┌──────────────────────────────────────────────────────┐
│                    Claude extraction                  │
│  calls · events · principles · strategies · sagas    │
└────────────────────────┬─────────────────────────────┘
                         │
                         ▼
            ┌────────────────────────┐       ┌────────────────────┐
            │   SQLite database      │◄──────│  Market APIs        │
            │   (20 tables, indexed) │       │  Kalshi · Polymarket│
            └───────────┬────────────┘       │  · PredictIt        │
                        │                    └────────────────────┘
                        ▼
            ┌────────────────────────┐
            │   Express API (Node)   │
            │   read-only over SQLite│
            └───────────┬────────────┘
                        │
                        ▼
            ┌────────────────────────┐
            │   React frontend       │
            │   (Vite · TS · Tailwind)│
            │   predictable.anythingimake.com │
            └────────────────────────┘
```

### Stack

| Layer | Tech |
|---|---|
| Frontend | React 19 · Vite 7 · TypeScript · Tailwind CSS v4 · Zustand · react-router 7 · Recharts |
| API | Node 22 · Express · better-sqlite3 (read-only) |
| Pipeline | Python 3.14 · faster-whisper · feedparser · yt-dlp · Anthropic SDK |
| Storage | SQLite (single file, ~5MB) |
| Hosting | Linux VPS · nginx · Cloudflare DNS+SSL · pm2 |

## Quick start (local development)

```bash
# Frontend (port 5173)
cd app && npm install && npm run dev

# API (port 3001)
cd api && npm install && npm run dev

# Pipeline (one-time backfill of all episodes)
cd pipeline && pip install -r requirements.txt
python -m pipeline.backfill                     # full two-pass
python -m pipeline.backfill --skip-pass2        # fast: pass 1 only
python -m pipeline.backfill --dry-run           # show what would happen
```

The frontend dev server proxies `/api/*` to the API at `:3001`, so you can develop both in parallel.

## Repository layout

```
app/         React frontend
api/         Express server (read-only over SQLite)
pipeline/    Python: ingest · transcribe · extract · enrich · sync
deploy/      nginx config + deploy scripts
data/        gitignored — local working copies (SQLite, transcripts, audio)
```

## Data sources

Every source is public. No paid API. No scraping that requires login.

| Source | Endpoint | Auth |
|---|---|---|
| Megaphone | `feeds.megaphone.fm/BMDC7674164347` | none |
| Substack | `predictable.substack.com/api/v1/archive` | none |
| Substack comments | `predictable.substack.com/api/v1/posts/{slug}/comments` | none |
| YouTube transcripts | `youtube-transcript-api` (Python) | none |
| YouTube metadata | `yt-dlp` | none |
| Kalshi | `api.elections.kalshi.com/trade-api/v2` | none for read |
| Polymarket | `gamma-api.polymarket.com` + `clob.polymarket.com` | none for read |
| PredictIt | `predictit.org/api/marketdata/all/` | none |

## What this is *not*

- **Not affiliated with Stu Burguiere or Predictable.** Independent fan project.
- **Not investment advice.** Prediction markets carry real financial risk.
- **Not a betting tool.** No trade execution. Pure documentation and analysis.
- **Not paywall-evading.** Only public Substack content is ingested.
- **Not a leaderboard for fans.** No accounts. No trade submissions. Just the show, faithfully tracked.

## License

MIT. Use it, fork it, deploy your own. Attribution appreciated, not required.

## Contributing

Issues and pull requests welcome — bugs, missing markets, wrong tier classifications, prompt improvements, UI polish. If you want to add a new feature, open an issue first to chat about it.
