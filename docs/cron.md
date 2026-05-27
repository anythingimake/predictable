# Cron pipeline — what runs, when, where

Three independent loops keep the site current. None need attention after
one-time setup.

```
┌──────────────────────────────────┐
│  Local Windows Task (2:05am)     │
│  → Megaphone RSS                 │
│  → faster-whisper (small + L-v3) │
│  → git push transcripts          │
└─────────────┬────────────────────┘
              │
              ▼
┌──────────────────────────────────┐
│  Anthropic scheduled routine     │
│  (3:15am ET / 7:15 UTC, daily)   │
│  → calls + principles + strategy │
│    + qa + sagas extraction       │
│  → git push extracted JSON       │
└─────────────┬────────────────────┘
              │
              ▼
┌──────────────────────────────────┐
│  Server cron (every hour at :17) │
│  → git pull                      │
│  → pipeline.load                 │
│  → pipeline.enrich.probe         │
│  → pipeline.enrich.scoring       │
│  → pm2 restart predictable-api   │
└──────────────────────────────────┘
```

## Loop 1: local Whisper transcription

- **Where:** Windows Task Scheduler entry `Predictable_Nightly_Pipeline` on Noah's machine
- **When:** Daily 2:05am local; uses `StartWhenAvailable` so a sleeping machine catches up
- **Script:** `deploy/nightly_local.ps1`
- **Steps:**
  1. `git pull --ff-only origin main`
  2. `python -m pipeline.backfill --skip-pass2` — pulls new Megaphone episodes, downloads MP3, two-pass Whisper (small first pass only by default to keep wall time short), saves transcripts to `data/transcripts/`
  3. `git add data/transcripts/ data/ingest/`
  4. Commit + push if anything changed
- **Log:** `~/predictable-nightly.log`
- **Why local?** Whisper runs on CPU here for free. Pass-1 small model is ~2 min/episode. Pass-2 large-v3 is opt-in.

## Loop 2: cloud Claude extraction

- **Where:** Anthropic Routine `trig_01QbCvat28v7JNWYCKcAUPyv` — runs on Anthropic infra, uses Noah's Claude subscription (not API credits)
- **When:** Daily 7:15 UTC = 3:15am ET
- **Source:** Clones https://github.com/anythingimake/predictable
- **Tools:** Bash, Read, Write, Edit, Glob, Grep (no MCP)
- **Steps:**
  1. List `data/transcripts/*.json`; identify those without matching `data/ingest/extract/{stem}-*.json` files
  2. For each pending transcript, run all four extractors (calls, principles, strategies, qa) via in-thread tool-use against the prompts in `pipeline/prompts/`
  3. Run `python -m pipeline.extract.sagas` (deterministic — no LLM needed) to refresh `_sagas.json`
  4. Commit JSON outputs as `anythingimake`, push
- **Manage at:** https://claude.ai/code/routines/trig_01QbCvat28v7JNWYCKcAUPyv

## Loop 3: server-side refresh

- **Where:** Hetzner VPS `5.78.89.136` cron table
- **When:** Hourly at `:17`
- **Script:** `/opt/predictable-repo/deploy/refresh.sh`
- **Steps (in order):**
  1. `git fetch && git pull --ff-only` if HEAD changed
  2. `python3 -m pipeline.load` — loads new JSON into SQLite at `/var/lib/predictable/predictable.sqlite`. Idempotent per episode (wipes prior rows for the episode, re-inserts from JSON).
  3. `python3 -m pipeline.enrich.probe_resolutions` — refreshes `markets.resolved`, `markets.resolution`, `markets.current_price` from Kalshi/Polymarket
  4. `python3 -m pipeline.enrich.scoring` — recomputes `calls.realized_pct` (hard + soft resolve) and refreshes today's `scoreboard_snapshots` row
  5. `pm2 restart predictable-api --update-env`
- **Log:** `/var/log/predictable-refresh.log`

## What the cron does NOT yet do

(Add these as needed.)

- [ ] **Market resolver for new calls.** `pipeline.enrich.market_resolver` exists but isn't called from `refresh.sh`. Reason: matching is slower (~minutes) and the heuristic still produces occasional false matches (Roy Cooper → Jon Cooper). Add as a manual run for now, or wire with a confidence threshold + "needs review" output to `/admin`.
- [ ] **Price history backfill.** `pipeline.enrich.price_snapshot` exists but for newly-matched markets we only get today's price snapshot. Historical candlesticks need a separate one-shot run per new market.
- [ ] **YouTube transcript fallback.** For livestreams + shorts that don't reach Megaphone, the local script doesn't yet pull from YouTube. The `youtube-transcript-api` wrapper exists in `pipeline/ingest/youtube.py` — needs wiring into `backfill.py`.
- [ ] **Cross-referencing.** `episodes.youtube_id` is null for everything. The yt-dlp channel listing exists; needs a join-by-date step that populates `youtube_id` + `youtube_title` + `view_count`.
- [ ] **Comment polling.** Substack comments are pulled once at episode-snapshot time. New comments posted later don't re-flow. Add a daily re-pull of comments for episodes < 14 days old.
- [ ] **Failure pings.** On hard failure (3 consecutive nights), the plan called for a Telegram push to Noah. Not wired yet — pm2 + cron just log.
- [ ] **Dedupe market_resolver false matches.** The Roy Cooper → Jon Cooper match exists in current data; needs either a manual override entry or a better matcher (e.g., LLM second-pass when fuzzy score is between 0.2 and 0.4).

## Force-run any loop now

```bash
# Loop 1 (local)
python -m pipeline.backfill --skip-pass2

# Loop 2 (cloud) — run the routine ad-hoc
# Visit https://claude.ai/code/routines/trig_01QbCvat28v7JNWYCKcAUPyv → "Run now"

# Loop 3 (server)
ssh root@5.78.89.136 '/opt/predictable-repo/deploy/refresh.sh'
```
