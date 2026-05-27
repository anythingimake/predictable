import { Router } from "express";
import { db } from "../db.js";

const router = Router();

// Safety cap so /api/calls never streams the entire table back as the show grows.
// Clients can override with ?limit=, but never above the hard ceiling.
const DEFAULT_CALLS_LIMIT = 500;
const MAX_CALLS_LIMIT = 2000;

router.get("/", (req, res) => {
  const { conviction, status, market, category, market_source } = req.query as Record<string, string | undefined>;
  const clauses: string[] = [];
  const params: any[] = [];
  if (conviction)    { clauses.push("c.conviction = ?");    params.push(conviction); }
  if (status)        { clauses.push("c.status = ?");        params.push(status); }
  if (market)        { clauses.push("c.market_id = ?");     params.push(market); }
  if (category)      { clauses.push("m.category = ?");      params.push(category); }
  if (market_source) { clauses.push("m.source = ?");        params.push(market_source); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const rawLimit = Number(req.query.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.floor(rawLimit), MAX_CALLS_LIMIT)
    : DEFAULT_CALLS_LIMIT;

  const rows = db().prepare(`
    SELECT c.id, c.market_id, c.market_hint, c.episode_id, c.side, c.conviction,
           c.size_disclosed, c.speaker, c.status, c.realized_pct, c.stu_claimed_pct,
           c.first_event_ts,
           e.publish_date, e.megaphone_title AS episode_title,
           m.source AS market_source, m.ticker AS market_ticker, m.question AS market_question
    FROM calls c
    JOIN episodes e ON e.id = c.episode_id
    LEFT JOIN markets m ON m.id = c.market_id
    ${where}
    ORDER BY e.publish_date DESC, c.first_event_ts
    LIMIT ?
  `).all(...params, limit);
  res.json(rows);
});

router.get("/:id", (req, res) => {
  const call = db().prepare(`
    SELECT c.*, e.publish_date, e.megaphone_title AS episode_title,
           e.youtube_id, e.substack_slug, e.audio_url, e.duration_sec,
           m.source AS market_source, m.ticker AS market_ticker, m.question AS market_question
    FROM calls c
    JOIN episodes e ON e.id = c.episode_id
    LEFT JOIN markets m ON m.id = c.market_id
    WHERE c.id = ?
  `).get(req.params.id) as any;
  if (!call) return res.status(404).json({ error: "not_found" });

  const events = db().prepare(`
    SELECT id, timestamp_sec, event_type, price_pct, size_pct_of_pos, quote, raw_quote
    FROM call_events WHERE call_id = ? ORDER BY timestamp_sec
  `).all(req.params.id);

  const media = db().prepare(`
    SELECT id, url, source_type, outlet, title
    FROM source_media WHERE call_id = ?
  `).all(req.params.id);

  const clarifications = db().prepare(`
    SELECT cc.id, cc.clarification, cc.extracted_value,
           c.author, c.body AS comment_body, c.posted_at
    FROM call_clarifications cc
    JOIN comments c ON c.id = cc.comment_id
    WHERE cc.call_id = ?
  `).all(req.params.id);

  let price_history: any[] = [];
  if (call.market_id) {
    price_history = db().prepare(`
      SELECT snapshot_date, price, volume
      FROM market_price_snapshots
      WHERE market_id = ? ORDER BY snapshot_date
    `).all(call.market_id);
  }

  res.json({ ...call, events, media, clarifications, price_history });
});

export default router;
