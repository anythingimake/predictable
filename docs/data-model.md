# Data model

> SQLite at `data/predictable.sqlite` (local) / `/var/lib/predictable/predictable.sqlite` (prod). Schema lives in `api/src/schema.sql`. The schema is the single source of truth — this doc explains *why* it's shaped this way.

## Core entities

```
episodes ───< calls >─── markets ───< market_price_snapshots
   │            │
   │            └──< call_events
   │            └──< source_media
   │
   ├──< mentions ──> markets
   ├──< comments ───< call_clarifications >── calls
   └──< saga_episodes >── sagas ──> markets

   principles >── principle_citations ──> episodes
   strategies ──> strategy_calls ──> calls
   media_vs_markets ──> episodes/markets
   glossary
   admin_notes
   scoreboard_snapshots
   pipeline_runs
```

## The conviction vocabulary (Stu's, not ours)

`calls.conviction` is a string enum that mirrors Stu's own on-air language:

| Value | Stu's words | Counts on scoreboard? |
|---|---|---|
| `play` | "in love" / "★★★ The Play" | Yes |
| `solid` | "I'm in" / "real position" | Yes |
| `flyer` | "few shares" / "longshot" | Yes |
| `watch` | "might dabble" / "keeping an eye" | No (directional) |
| `opinion` | "I think X is more likely" | No (no position) |
| `pass` | "not for me" | No (skipping) |

`/api/scoreboard` filters totals to `play/solid/flyer` (the "actionable" tiers — Stu actually took the position). The other three are broken out in the `by_tier` array but never roll into the headline number. Frontend marks them with `is_actionable=false`.

## Two distinct end-of-life events

There are two genuinely different things that can close a call:

- **Stu exited** (`calls.status = 'closed'`) — Stu noted on air that he sold / trimmed. We have his exit price in a `call_events` row of type `exit` / `trim` / `resolve`. We can compute his realized return without waiting for the market.
- **Market settled** (`calls.status = 'resolved'`) — the underlying market paid out. We use the market's resolution direction + the call's entry price to compute return.

A call can hit both states (Stu exits, then market resolves later). The frontend labels them clearly: "Stu exited" vs "Market settled".

## Why so many tables

Each table answers a specific question:

| Table | Question it answers |
|---|---|
| `episodes` | When did the show air, what's it titled across each platform, where can I find it |
| `calls` | What positions did Stu take, with what conviction, in which episode |
| `call_events` | What happened to each position over time — entry, add, trim, exit, market resolve |
| `mentions` | What markets were discussed without taking a position (context, not a bet) |
| `source_media` | What outside content was cited in support of a call (NYT article, poll, court ruling) |
| `markets` | What real market on Kalshi / Polymarket / PredictIt does each call point at |
| `market_price_snapshots` | Daily price history so we can draw a chart with Stu's events overlaid |
| `comments` | Substack threads on each episode (filtered to "useful" on the frontend) |
| `call_clarifications` | When a Substack Q&A surfaced new info about a call (entry price, sizing) |
| `principles` | Heuristics Stu repeats across episodes ("find what won't happen") |
| `strategies` | Multi-call plays (Vivek ladder, Indiana basket, free roll) |
| `sagas` | Markets that span multiple episodes — recurring threads |
| `media_vs_markets` | A recurring show pattern: "NYT says X, market says Y" |
| `glossary` | Auto-mined trading jargon |
| `admin_notes` | Noah's private layer |
| `scoreboard_snapshots` | Time series for hit rate / call count — feeds a future sparkline |
| `pipeline_runs` | Bookkeeping for the cron — when did what run, what did it produce |

## Idempotency

Every loader / enrich step is idempotent — safe to re-run:

- `pipeline.load.load_calls` wipes the episode's prior `calls` + `call_events` + `mentions` rows before re-inserting from JSON. The JSON file is the source of truth.
- `pipeline.enrich.market_resolver` only touches calls where `market_id IS NULL`.
- `pipeline.enrich.price_snapshot` + `price_poll` use `INSERT … ON CONFLICT(market_id, snapshot_date) DO UPDATE`.
- `pipeline.enrich.scoring` recomputes `realized_pct` and the scoreboard snapshot every run.

That means you can re-run any step anytime without worrying about double-inserts or stale state.

## What's enforced

- Foreign keys ON via `PRAGMA foreign_keys = ON` (in schema + db.py)
- `journal_mode = WAL` for concurrent reader (API) + writer (cron)
- All indexes in `schema.sql` — see the bottom of that file

## What's NOT in the schema yet

These are real things we'd want eventually but the v1 cut doesn't have:

- Per-call **manual override** rows (so Noah can correct a misclassified call without breaking re-load idempotency)
- Per-market **cross-reference** (same race on Kalshi AND Polymarket → linked siblings)
- Per-episode **YouTube** cross-reference (yt-dlp metadata) — currently nullable, never filled
- **chapter_json** is in the episodes schema but not populated yet (would come from yt-dlp's `chapters` field for shows that have chapter markers)
- `view_count`, `like_count`, `comment_count` on episodes — also pending the YouTube cross-reference

See `docs/cron.md` "What's not yet done" for the running list.
