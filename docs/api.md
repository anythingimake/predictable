# API reference

Base URL: `https://predictable.anythingimake.com/api` (production) · `http://localhost:3001/api` (dev)

All responses are JSON. All read endpoints are public, no auth. Admin endpoints require `Authorization: Bearer {ADMIN_TOKEN}`.

## Conventions

- `404 {"error":"not_found"}` for unknown resources or unmatched `/api/*` paths
- `500 {"error":"internal","message":"…"}` for unhandled exceptions
- Empty result sets return `[]`, never `null`
- Dates are ISO 8601 (UTC) where datetime, `YYYY-MM-DD` where date-only
- Prices are in dollars (0.00 – 1.00 on Polymarket-style endpoints) or cents (0–100 on `call_events.price_pct`). The naming makes the units obvious.

## Endpoints

### GET `/api/health`

Liveness check.

```json
{ "ok": true, "ts": "2026-05-27T22:54:00.000Z" }
```

### GET `/api/scoreboard`

Headline numbers + recent winners + recent losses + per-tier + per-category.

Totals are filtered to "actionable" tiers (`play`/`solid`/`flyer`). `by_tier` includes ALL tiers but each row carries `is_actionable`.

```json
{
  "total_calls": 37,
  "resolved_calls": 8,
  "hit_count": 7,
  "hit_rate": 0.875,
  "by_tier": [
    { "conviction": "play", "n": 1, "resolved": 1, "hits": 1, "avg_return_pct": 1033.78, "is_actionable": true },
    { "conviction": "solid", "n": 12, "resolved": 7, "hits": 6, "avg_return_pct": 78.21, "is_actionable": true },
    { "conviction": "opinion", "n": 2, "resolved": 1, "hits": 1, "avg_return_pct": 85.18, "is_actionable": false }
  ],
  "by_category": [ … ],
  "recent_wins": [ … ],   // up to 10, status IN (resolved,closed), positive return only
  "recent_losses": [ … ]  // up to 5, negative return only
}
```

### GET `/api/scoreboard/history`

Time series of daily scoreboard snapshots. One row per day.

### GET `/api/episodes`

All episodes, newest first. Compact metadata only — no transcript or comments.

### GET `/api/episodes/:id`

Episode detail. Includes `transcript_text`, `substack_body`, `chapter_json`, plus joined `calls`, `mentions`, and `comments` arrays.

### GET `/api/calls`

Filterable list. Query params (all optional):

| Param | Effect |
|---|---|
| `conviction=play` | filter by single tier (legacy single-value) |
| `status=open` | filter by single status |
| `market=kalshi:KX…` | filter to one specific market_id |
| `category=Elections` | filter by `markets.category` |
| `market_source=kalshi` | filter by `markets.source` |
| `limit=N` | cap rows (default 500, max 2000) |

Multi-select filtering happens client-side (all rows are loaded once).

### GET `/api/calls/:id`

Full call detail: header fields + `events[]` + `media[]` + `clarifications[]` + `price_history[]` (from `market_price_snapshots`).

### GET `/api/markets`

Filterable list. Query params: `source`, `category`, `resolved=true|false`.

### GET `/api/markets/:id`

Single market with all of Stu's calls + mentions + full price history. `:id` is URL-encoded `{source}:{ticker}`.

### GET `/api/principles`

All heuristics extracted from transcripts, sorted by citation count.

### GET `/api/principles/:id`

Principle detail + citations (which episodes, which timestamps).

### GET `/api/strategies`

Multi-call plays (Vivek ladder, Indiana basket, free roll, pair).

### GET `/api/sagas`

Markets that span multiple episodes.

### GET `/api/calendar`

Markets with at least one open call, ordered by resolution date. Powers the visual Calendar page.

### GET `/api/media-vs-markets`

The recurring "NYT says X, market says Y" entries.

### GET `/api/glossary`

Auto-mined trading jargon (term + definition + first-cited episode).

### GET `/api/search?q=...`

Naive `LIKE` search across episode transcripts, episode substack_body, and call market_hints. Min 3 chars. Up to 20 hits.

## Admin endpoints

Require `Authorization: Bearer {ADMIN_TOKEN}`. Token is set as the `PREDICTABLE_ADMIN_TOKEN` env var on the pm2 service.

### POST `/api/admin/reload`

Bounces the better-sqlite3 connection. Called by `refresh.sh` after `pipeline.load` rewrites the DB so the API picks up the new bytes.

### GET `/api/admin/notes`

Noah's private notes. Optional `scope_type=call|episode|market|saga|general` and `scope_id=`.

### POST `/api/admin/notes`

Body: `{ scope_type, scope_id?, body }`. Returns `{ id }`.

### DELETE `/api/admin/notes/:id`

Hard delete.

## CORS

Locked via `CORS_ORIGINS` env var on the pm2 service (set to `https://predictable.anythingimake.com`). Same-origin requests (the deployed SPA) and server-side fetches (no `Origin` header) pass through. Other origins return no `Access-Control-Allow-Origin`.

## Security headers (set by nginx)

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `x-powered-by` stripped by Express

## Rate limits

Currently none. The site isn't getting hammered. If it ever does, the API is read-only and SQLite is fast — slap nginx `limit_req` in front if needed.

## See also

- `docs/data-model.md` — what the response shapes mean
- `api/src/routes/` — the actual implementation
