# Cron pipeline — what runs, when, where

Canonical doc. Three independent loops keep the site current. None need attention after
one-time setup; this file is what you read when something looks stale or wrong.

```
┌──────────────────────────────────────┐
│  Loop 1 — Local Whisper (2:05am ET)  │
│  Windows Task Scheduler on Noah's PC │
│  → Megaphone RSS                     │
│  → faster-whisper small (+ optional L-v3) │
│  → git push transcripts              │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│  Loop 2 — Cloud extraction (3:15am ET, daily) │
│  Anthropic Routine `trig_01QbCvat...`        │
│  → calls + principles + strategies + qa      │
│  → deterministic sagas refresh               │
│  → git push extraction JSON                  │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│  Loop 3 — Server refresh (hourly :17)│
│  Hetzner VPS root@5.78.89.136 cron   │
│  → git pull → sync_substack → load   │
│  → market_resolver → yt cross-ref    │
│  → probe_resolutions → price_snapshot│
│  → scoring → pm2 restart             │
└──────────────────────────────────────┘
```

## Loop 1 — Local Whisper transcription

- **Where:** Windows Task Scheduler entry `Predictable_Nightly_Pipeline` on Noah's machine.
- **When:** Daily 2:05am local. `StartWhenAvailable` so a sleeping machine catches up.
- **Script:** `deploy/nightly_local.ps1`
- **Steps:**
  1. `git pull --ff-only origin main`
  2. `python -m pipeline.backfill --skip-pass2` — pulls new Megaphone episodes, downloads MP3, runs `faster-whisper` small model (pass-2 large-v3 opt-in to keep wall time short), saves transcripts to `data/transcripts/{guid}.json`.
  3. `git add data/transcripts/ data/ingest/` + commit + push if anything changed.
- **Log:** `~/predictable-nightly.log`
- **Why local?** Whisper runs on CPU for free. Pass-1 small model is ~2 min/episode.
- **Force-run now:** `python -m pipeline.backfill --skip-pass2`

## Loop 2 — Cloud Claude extraction

- **Where:** Anthropic Routine `trig_01QbCvat28v7JNWYCKcAUPyv` — runs on Anthropic infra, uses Noah's Claude subscription (not API credits).
- **When:** Daily 7:15 UTC = 3:15am ET.
- **Source:** Clones https://github.com/anythingimake/predictable
- **Tools:** Bash, Read, Write, Edit, Glob, Grep (no MCP).
- **Steps:**
  1. `python -m pipeline.extract.run --list-pending` — prints the exact backlog, checking each output **type** (calls/principles/strategies/qa) independently. Deterministic; needs no API key.
  2. For each pending `(episode, extractor)` pair, produce the output **in-thread** (your own tool-use against `pipeline/prompts/extract_{kind}.md` + the transcript; qa runs against the episode's Substack comments) and write `data/ingest/extract/{guid}-{kind}.json`. Extraction stays on the subscription — do **not** call the Python `extract_*` functions, which would spend API credits.
  3. **Commit + push after each episode**, not once at the end, so a mid-run API error never discards completed work.
  4. If one extraction errors (overload/429/529), **log it and continue** to the next — never abort the whole run. Whatever stays pending is picked up next run.
  5. Run `python -m pipeline.extract.sagas` (deterministic — no LLM needed) to refresh `_sagas.json`; commit.
- **Manage at:** https://claude.ai/code/routines/trig_01QbCvat28v7JNWYCKcAUPyv
- **Force-run now:** visit the routine URL → "Run now"

> **Resume-safety — why the steps above changed.** The routine used to treat a
> transcript as "done" if **any** `{stem}-*.json` existed. After a run wrote every
> episode's `-calls.json` but died on an API error before principles/strategies,
> every transcript looked "done" → a plain re-run skipped all of them and the
> missing types were never produced (the site silently lost all principles/
> strategies/qa). `pipeline/extract/run.py --list-pending` replaces that heuristic
> with a per-type check; commit-per-episode + continue-on-error make a mid-run
> failure recoverable. **Paste the block below as the routine's prompt:**

```text
You maintain the Predictable extraction step. The repo is already cloned.

1. Run:  python -m pipeline.extract.run --list-pending
   It prints, per episode, which TRANSCRIPT-based outputs are missing (calls,
   principles, strategies) — checked per TYPE, so a transcript that already has
   -calls.json but is missing -principles.json still shows as pending. (qa is
   comment-based and needs the SQLite slug map, which isn't in this clone, so
   --list-pending won't list it here — handle qa in step 2b.)
2. For each pending (episode, extractor), produce the JSON yourself via in-thread
   tool-use: read pipeline/prompts/extract_{kind}.md and the transcript at
   data/transcripts/{guid}.json, then Write
   data/ingest/extract/{guid}-{kind}.json matching that extractor's schema.
   Do NOT run the Python extract_* functions — they use API credits; your
   in-thread extraction uses the subscription.
2b. qa: for any episode with a data/ingest/substack/comments/{slug}.json file but
   no {guid}-qa.json, run extract_qa in-thread against those comments. Map slug to
   episode the way pipeline/load.py does (same-date Substack 'podcast' post whose
   title best matches the Megaphone episode in data/ingest/megaphone/).
3. git add the file(s) and commit + push AFTER EACH EPISODE (as anythingimake).
   Never batch the commit to the end — a mid-run failure must not lose work.
4. If any single extraction errors (overload/429/529/etc.), log it and CONTINUE
   to the next episode. Never abort the whole run.
5. When the per-type backlog is empty, run:  python -m pipeline.extract.sagas
   and commit the refreshed data/ingest/extract/_sagas.json.
```

## Loop 2b — Event resolution research (cited)

Same routine as Loop 2 (subscription, in-thread), but resolves Stu's calls from the
REAL-WORLD outcome when the exchange is slow or wrong to settle — Polymarket parks
decided markets at ~99¢ with `closed:false`; Kalshi leaves margin-of-victory markets
`active` with a bogus +1-year close date. **Requires web search added to the routine's
tool list.**

- `python -m pipeline.enrich.resolve_events --list-pending` — deterministic worklist
  (no web/LLM/key): called markets that aren't a hard exchange settlement and have no
  resolution file yet.
- Research each in-thread per `pipeline/prompts/resolve_event.md` (web search → winner
  + **exact margin** → bracket math → cited source URL). Resolve only events that have
  ACTUALLY happened; leave genuinely-future ones. If the result/margin can't be verified,
  leave it pending (an honest unknown beats a fabricated win).
- Write `data/ingest/resolutions/{market_id}.json` (source + confidence), commit + push.
  `pipeline.load` folds it into `markets.effective_*`; scoring credits the call as
  `closed` (effective), never faking `resolved` (reserved for a real exchange settlement).
  `event_date` overrides the exchange's bogus close date for calendar display.
- **Resolve-once:** a market with a resolution file is skipped next run; only re-check
  ones genuinely still pending (e.g. an ongoing recount). Not "re-decide every run."

## Loop 3 — Server refresh

- **Where:** Hetzner VPS `5.78.89.136` cron table.
- **When:** Hourly at `:17`.
- **Script:** `/opt/predictable-repo/deploy/refresh.sh`
- **Steps (in order):**
  1. `git fetch && git pull --ff-only` if HEAD changed (else continue with the data-refresh subset).
  2. `python3 -m pipeline.sync_substack` — pull Substack bodies + comments for every episode with a `substack_slug`. Skips slugs whose snapshot exists on disk.
  3. `python3 -m pipeline.sync.repull_recent_comments` — force re-fetch comments for episodes < 14 days old so newly-posted Stu replies flow into the DB.
  4. `python3 -m pipeline.load` — load every extracted JSON file into SQLite at `/var/lib/predictable/predictable.sqlite`. Idempotent per episode (wipes prior rows for the episode, re-inserts from JSON).
  5. `python3 -m pipeline.enrich.market_resolver` — match every call with `market_id IS NULL` to a Kalshi or Polymarket market. Conservative gating (state/office/team/year/party buckets) means rejected candidates land in `data/logs/unresolved_markets-{date}.json` for human review. Also performs **multi-exchange sibling detection**: after matching, scans the other exchange for a sibling and stores its id in `markets.meta_json.sibling_market_id`.
  6. `python3 -m pipeline.enrich.cross_reference_youtube` — match Megaphone episodes to YouTube videos by publish-date proximity (±2 days) + duration sanity check (±5 min, or ±90s when dates are unavailable). Populates `episodes.youtube_id` + `youtube_title` + `view_count` + `like_count`. Idempotent — claimed YouTube videos are not reassigned.
  7. `python3 -m pipeline.enrich.probe_resolutions` — refresh `markets.resolved`, `markets.resolution`, `markets.current_price` from Kalshi/Polymarket for every market in the DB.
  8. `python3 -m pipeline.enrich.price_snapshot` — daily candles for live markets (pass 1) and full-history backfill for newly-matched resolved markets that have no snapshots yet (pass 2). Idempotent — same-day rows get UPSERT'd with the latest price.
  9. `python3 -m pipeline.enrich.scoring` — recompute `calls.realized_pct` (hard + soft resolve) and refresh today's `scoreboard_snapshots` row.
  10. `pm2 restart predictable-api --update-env` — bounce the API so better-sqlite3 reopens the file.
- **Log:** `/var/log/predictable-refresh.log`
- **Force-run now:** `ssh root@5.78.89.136 '/opt/predictable-repo/deploy/refresh.sh'`

Each pipeline step is wrapped in `|| echo "X failed"` so one bad source (YouTube IP-banned, Polymarket 5xx) doesn't kill the chain.

## What the cron does NOT yet do

Prioritized backlog. Each item lists priority, effort estimate, and why-it-matters
so the next person can pick up cleanly.

### Must (P0)

- ✅ **DONE 2026-05-27** — `market_resolver` in refresh.sh
- ✅ **DONE 2026-05-27** — `sync_substack` in refresh.sh
- ✅ **DONE 2026-05-27** — `cross_reference_youtube` in refresh.sh
- ✅ **DONE 2026-05-27** — `price_snapshot` in refresh.sh
- ✅ **DONE 2026-05-27** — daily comment re-pull (`repull_recent_comments`)
- ✅ **DONE 2026-05-27** — multi-exchange sibling detection in `market_resolver`
- ✅ **DONE 2026-05-27** — false-match audit: matcher tightened with state/office/team/year/party conflict buckets

### Should (P1)

- [ ] **Cron failure pings.** *(Effort: 30 min.)* If `refresh.sh` exits non-zero 3 consecutive times, no notification fires. Telegram bot creds are user-managed — check `~/.virtuous_creds.env` or the user's memory notes (`feedback_vrt_contactnote_fastfetch.md` mentions creds locations). Quickest path: write a tiny `notify.sh` wrapper that checks `/var/log/predictable-refresh.log` for the most-recent N-line failure streak and POSTs to a Telegram bot token. Block until Telegram creds are confirmed available on the server.

- [ ] **YouTube transcript fallback for shorts/livestreams.** *(Effort: 1-2 hours.)* `pipeline/ingest/youtube.py` has `get_transcript()`. Local Loop 1 backfill should pull transcripts for any YouTube videos NOT in the Megaphone feed (shorts < ~10 min, livestreams). New module: `pipeline/ingest/youtube_transcripts.py` that walks `pull_channel_videos()` results, skips ones whose duration matches an existing episode, and pulls transcripts for the rest. Bypassed because IP-banning is a real risk (YT has rate-limited us before — see CLAUDE.md note). Recommend a per-day cap (e.g., 5 transcripts/day) and a 30-day in-disk cache.

- [ ] **Audit unresolved markets weekly.** *(Effort: 15 min.)* `/api/admin/unresolved-markets` now surfaces the daily logs as a deduped list. A human (Noah) should glance at it weekly and either edit the call's `market_hint` to be more specific, or manually link it via the admin notes flow. Nothing to automate here — it's a workflow note.

### Nice (P2)

- [ ] **MP3 cleanup.** *(Effort: 15 min.)* Backfill currently keeps MP3s (`--keep-audio`). After extraction is verified, MP3s older than 7 days should be deleted to save disk. Add a `find data/audio/ -mtime +7 -name '*.mp3' -delete` step to the local `nightly_local.ps1`. Skipped this round — low disk pressure on Noah's machine and zero risk if extraction is good.

- [ ] **Historical Polymarket candles for resolved-only markets.** *(Effort: 30 min.)* `price_snapshot.py` already has a pass-2 for resolved markets with no history, but if the matcher links a call to an already-resolved market mid-life, only one snapshot lands. The pass-2 query needs to trigger any time the snapshot count is < N (where N = days since first event) — not just when count = 0.

- [ ] **Refresh YouTube view/like counts daily.** *(Effort: 5 min.)* `cross_reference_youtube` has a `--refresh-meta` flag that re-pulls per-video stats. Not wired into the hourly cron because it's expensive (~3-5s per video × 18 episodes). Add as a separate daily step in `refresh.sh` (e.g., a check `if [[ "$(date +%H)" == "06" ]]`).

- [ ] **`pipeline_runs` housekeeping table is unused.** *(Effort: 1 hour.)* Schema has it; nothing writes to it. Worth wiring so the `/admin` page can show "last successful run", "rows added", etc.

### Data quality: known gaps (always worth a quick eyeball before complaining)

- **Calls still unlinked.** Some calls genuinely have no matching market because Stu mentions a market that doesn't exist on Kalshi/Polymarket (e.g., a prop bet, a Twitter poll, a custom platform). These will accumulate in `unresolved_markets-*.json` — Noah's call whether to add a market manually.
- **YouTube view/like counts age.** Captured at link-time. Run `python3 -m pipeline.enrich.cross_reference_youtube --refresh-meta` to refresh, or wait for the daily wiring above to land.
- **One episode has no YouTube match (`2026-05-18 — We Made a GREAT Investment on Cassidy`).** This may genuinely not be on the channel, or the duration may be way off. Check `data/ingest/youtube/channel-*.json` for the snapshot.
- **Substack bodies > comments delta.** If `episodes.substack_body IS NOT NULL` count differs from comments count, that's expected — some posts have no comments yet.

## Operational

### What to do if a loop fails

**Loop 1 (local Whisper):**
- Check `~/predictable-nightly.log` for the last run.
- Most common failure: out-of-disk on `data/audio/`. Free it or run with `--no-keep-audio`.
- Second-most-common: a single bad MP3 chokes `faster-whisper`. Skip with `python -m pipeline.backfill --skip-pass2 --skip-guid {bad_guid}`.

**Loop 2 (cloud Claude routine):**
- Visit https://claude.ai/code/routines/trig_01QbCvat28v7JNWYCKcAUPyv → look at the most recent run.
- **First, see what's actually missing:** `python -m pipeline.extract.run --list-pending` (no API key needed) prints the per-type backlog and flags any present-but-empty `-calls.json`. A clean re-run ("Run now") resumes exactly that backlog — per-type, so a partially-extracted episode is finished, not skipped.
- If a single extraction fails, the routine logs it and moves on (commit-per-episode), so completed episodes are safe; the next run retries whatever stayed pending.
- If the routine itself is gated/disabled, no JSON gets pushed → Loop 3 sees nothing new → site appears frozen.

**Loop 3 (server refresh):**
- `ssh root@5.78.89.136 'tail -200 /var/log/predictable-refresh.log'`
- Common failures:
  - `market_resolver failed` — usually Kalshi/Polymarket rate-limit or 5xx. Safe to ignore for one cycle; next cycle picks up new calls.
  - `cross_reference_youtube failed` — yt-dlp IP-ban. Wait 30 min and re-run. If persistent, disable temporarily by commenting the line in `refresh.sh`.
  - `pipeline.load` failures are serious — they mean a JSON file is malformed. Check the most recent extract `*.json` for invalid JSON.
- After a hard failure, re-run manually: `ssh root@5.78.89.136 '/opt/predictable-repo/deploy/refresh.sh'`

### How to force-run any loop now

```bash
# Loop 1 (local Whisper)
python -m pipeline.backfill --skip-pass2

# Loop 2 (cloud Claude routine) — manually trigger via web UI
# Visit https://claude.ai/code/routines/trig_01QbCvat28v7JNWYCKcAUPyv → "Run now"

# Loop 3 (server refresh)
ssh root@5.78.89.136 '/opt/predictable-repo/deploy/refresh.sh'

# Individual server steps (when you only want to redo one)
ssh root@5.78.89.136 'cd /opt/predictable-repo && \
  PREDICTABLE_DB=/var/lib/predictable/predictable.sqlite \
  python3 -m pipeline.enrich.market_resolver'
ssh root@5.78.89.136 'cd /opt/predictable-repo && \
  PREDICTABLE_DB=/var/lib/predictable/predictable.sqlite \
  python3 -m pipeline.enrich.cross_reference_youtube'
```

### How to check on health

```bash
# Counts
ssh root@5.78.89.136 'sqlite3 /var/lib/predictable/predictable.sqlite \
  "SELECT COUNT(*) AS calls, SUM(market_id IS NOT NULL) AS linked, \
   SUM(market_id IS NULL) AS unlinked FROM calls;"'

# Episodes with YouTube linked
ssh root@5.78.89.136 'sqlite3 /var/lib/predictable/predictable.sqlite \
  "SELECT COUNT(*) AS ep_total, SUM(youtube_id IS NOT NULL) AS ep_yt, \
   SUM(substack_body IS NOT NULL) AS ep_sub FROM episodes;"'

# Today's scoreboard snapshot
ssh root@5.78.89.136 'sqlite3 /var/lib/predictable/predictable.sqlite \
  "SELECT * FROM scoreboard_snapshots ORDER BY snapshot_date DESC LIMIT 1;"'
```

### Where things live on the server

| Thing | Path |
|---|---|
| Repo clone | `/opt/predictable-repo` |
| SQLite DB (prod) | `/var/lib/predictable/predictable.sqlite` |
| Static frontend | `/var/www/predictable/` |
| API code | `/opt/predictable-api/` |
| pm2 service | `predictable-api` |
| nginx vhost | `/etc/nginx/sites-enabled/predictable.anythingimake.com` |
| Refresh log | `/var/log/predictable-refresh.log` |
| Unresolved-markets logs | `/opt/predictable-repo/data/logs/unresolved_markets-{date}.json` |
| Cron table | `sudo crontab -l` (the `17 * * * * /opt/predictable-repo/deploy/refresh.sh ...` line) |

### Deploy paths (when you change code)

```bash
# Frontend
cd app && npm run build
scp -r dist/* root@5.78.89.136:/var/www/predictable/

# API
cd api && npm run build
rsync -avz dist/ root@5.78.89.136:/opt/predictable-api/
ssh root@5.78.89.136 "pm2 restart predictable-api"

# refresh.sh / pipeline modules — already on the server via git pull
# in refresh.sh. But the first time after a change, force a refresh:
scp deploy/refresh.sh root@5.78.89.136:/opt/predictable-repo/deploy/
ssh root@5.78.89.136 'chmod +x /opt/predictable-repo/deploy/refresh.sh'
```
