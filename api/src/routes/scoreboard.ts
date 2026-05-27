import { Router } from "express";
import { db } from "../db.js";

const router = Router();

router.get("/", (_req, res) => {
  const totals = db().prepare(`
    SELECT
      COUNT(*) AS total_calls,
      SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved_calls,
      SUM(CASE WHEN status = 'resolved' AND realized_pct > 0 THEN 1 ELSE 0 END) AS hit_count
    FROM calls
    WHERE conviction IN ('play', 'solid', 'flyer')
  `).get() as any;
  const hit_rate = totals.resolved_calls > 0 ? totals.hit_count / totals.resolved_calls : 0;

  const by_tier = db().prepare(`
    SELECT conviction,
           COUNT(*) AS n,
           SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
           SUM(CASE WHEN status = 'resolved' AND realized_pct > 0 THEN 1 ELSE 0 END) AS hits,
           AVG(CASE WHEN status = 'resolved' THEN realized_pct END) AS avg_return_pct
    FROM calls
    GROUP BY conviction
  `).all();

  const by_category = db().prepare(`
    SELECT COALESCE(m.category, 'unknown') AS category,
           COUNT(*) AS n,
           SUM(CASE WHEN c.status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
           SUM(CASE WHEN c.status = 'resolved' AND c.realized_pct > 0 THEN 1 ELSE 0 END) AS hits
    FROM calls c
    LEFT JOIN markets m ON m.id = c.market_id
    GROUP BY COALESCE(m.category, 'unknown')
  `).all();

  const recent_wins = db().prepare(`
    SELECT c.id, c.market_hint, c.realized_pct, c.stu_claimed_pct, c.conviction,
           e.publish_date,
           COALESCE(e.substack_title, e.megaphone_title) AS episode_title
    FROM calls c
    JOIN episodes e ON e.id = c.episode_id
    WHERE c.status = 'resolved' AND c.realized_pct IS NOT NULL
    ORDER BY c.realized_pct DESC
    LIMIT 10
  `).all();

  const recent_losses = db().prepare(`
    SELECT c.id, c.market_hint, c.realized_pct, c.conviction,
           e.publish_date,
           COALESCE(e.substack_title, e.megaphone_title) AS episode_title
    FROM calls c
    JOIN episodes e ON e.id = c.episode_id
    WHERE c.status = 'resolved' AND c.realized_pct IS NOT NULL
    ORDER BY c.realized_pct
    LIMIT 5
  `).all();

  res.json({
    ...totals,
    hit_rate,
    by_tier,
    by_category,
    recent_wins,
    recent_losses,
  });
});

router.get("/history", (_req, res) => {
  const rows = db().prepare(`
    SELECT snapshot_date, total_calls, resolved_calls, hit_count, hit_rate, bankroll_pct
    FROM scoreboard_snapshots
    ORDER BY snapshot_date
  `).all();
  res.json(rows);
});

export default router;
