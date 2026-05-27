import { Router } from "express";
import { db } from "../db.js";

const router = Router();

router.get("/", (req, res) => {
  const { source, category, resolved } = req.query as Record<string, string | undefined>;
  const clauses: string[] = [];
  const params: any[] = [];
  if (source)   { clauses.push("source = ?");   params.push(source); }
  if (category) { clauses.push("category = ?"); params.push(category); }
  if (resolved !== undefined) {
    clauses.push("resolved = ?");
    params.push(resolved === "true" ? 1 : 0);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db().prepare(`
    SELECT id, source, ticker, question, category, resolution_date,
           resolved, resolution, current_price
    FROM markets ${where}
    ORDER BY COALESCE(resolution_date, '9999-12-31')
  `).all(...params);
  res.json(rows);
});

router.get("/:id", (req, res) => {
  const market = db().prepare(`SELECT * FROM markets WHERE id = ?`).get(req.params.id) as any;
  if (!market) return res.status(404).json({ error: "not_found" });
  const calls = db().prepare(`
    SELECT c.id, c.episode_id, c.side, c.conviction, c.status, c.realized_pct,
           c.first_event_ts, e.publish_date,
           COALESCE(e.substack_title, e.megaphone_title) AS episode_title
    FROM calls c
    JOIN episodes e ON e.id = c.episode_id
    WHERE c.market_id = ? ORDER BY e.publish_date
  `).all(req.params.id);
  const mentions = db().prepare(`
    SELECT m.id, m.episode_id, m.timestamp_sec, m.directional, m.quote,
           e.publish_date, COALESCE(e.substack_title, e.megaphone_title) AS episode_title
    FROM mentions m
    JOIN episodes e ON e.id = m.episode_id
    WHERE m.market_id = ? ORDER BY e.publish_date
  `).all(req.params.id);
  const price_history = db().prepare(`
    SELECT snapshot_date, price, volume
    FROM market_price_snapshots WHERE market_id = ? ORDER BY snapshot_date
  `).all(req.params.id);
  res.json({ ...market, calls, mentions, price_history });
});

export default router;
