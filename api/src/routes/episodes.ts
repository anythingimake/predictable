import { Router } from "express";
import { db } from "../db.js";

const router = Router();

router.get("/", (_req, res) => {
  const rows = db().prepare(`
    SELECT id, publish_date, type,
           COALESCE(substack_title, megaphone_title, youtube_title) AS title,
           megaphone_title, youtube_title, substack_title,
           youtube_id, substack_slug, audio_url,
           duration_sec, view_count, like_count, comment_count,
           cover_image_url
    FROM episodes
    ORDER BY publish_date DESC
  `).all();
  res.json(rows);
});

router.get("/:id", (req, res) => {
  const ep = db().prepare(`SELECT * FROM episodes WHERE id = ?`).get(req.params.id) as any;
  if (!ep) return res.status(404).json({ error: "not_found" });
  const calls = db().prepare(`
    SELECT id, market_hint, side, conviction, speaker, status, realized_pct, first_event_ts
    FROM calls WHERE episode_id = ? ORDER BY first_event_ts NULLS LAST
  `).all(req.params.id);
  const mentions = db().prepare(`
    SELECT id, market_hint, timestamp_sec, directional, quote
    FROM mentions WHERE episode_id = ? ORDER BY timestamp_sec
  `).all(req.params.id);
  const comments = db().prepare(`
    SELECT id, author, body, posted_at, is_stu, parent_id
    FROM comments WHERE episode_id = ? ORDER BY posted_at
  `).all(req.params.id);
  res.json({ ...ep, calls, mentions, comments });
});

export default router;
