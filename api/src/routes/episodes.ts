import { Router } from "express";
import { db } from "../db.js";

const router = Router();

router.get("/", (_req, res) => {
  const rows = db().prepare(`
    SELECT id, publish_date, type,
           -- Megaphone title is canonical (one per episode). Substack titles are
           -- SEO-rewritten and collide when two same-day episodes fuzzy-match the
           -- same post by date, so prefer megaphone first.
           COALESCE(megaphone_title, youtube_title, substack_title) AS title,
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
    FROM calls WHERE episode_id = ? AND COALESCE(hidden, 0) = 0 ORDER BY first_event_ts NULLS LAST
  `).all(req.params.id);
  const mentions = db().prepare(`
    SELECT id, market_hint, timestamp_sec, directional, quote
    FROM mentions WHERE episode_id = ? ORDER BY timestamp_sec
  `).all(req.params.id);
  const comments = db().prepare(`
    SELECT id, author, body, posted_at, is_stu, parent_id
    FROM comments WHERE episode_id = ? ORDER BY posted_at
  `).all(req.params.id);

  // Cross-link articles ↔ podcast episodes that cover the same day. A newsletter
  // article exposes the same-date podcast episode it's writing up; a podcast
  // episode exposes the same-date article. One id each way (nearest by date —
  // here exact same date, lowest id as a stable tiebreak).
  let related_episode_id: string | null = null;
  let related_article_id: string | null = null;
  if (ep.type === "article") {
    const rel = db().prepare(`
      SELECT id FROM episodes
      WHERE publish_date = ? AND type != 'article' AND id != ?
      ORDER BY id LIMIT 1
    `).get(ep.publish_date, ep.id) as { id: string } | undefined;
    related_episode_id = rel?.id ?? null;
  } else {
    const rel = db().prepare(`
      SELECT id FROM episodes
      WHERE publish_date = ? AND type = 'article' AND id != ?
      ORDER BY id LIMIT 1
    `).get(ep.publish_date, ep.id) as { id: string } | undefined;
    related_article_id = rel?.id ?? null;
  }

  // transcript_text is ~50KB — strip it from the payload (the page never
  // renders it) and expose a boolean instead. has_transcript lets the UI tell
  // "analyzed, no calls" apart from "transcribed but not yet analyzed".
  const { transcript_text, ...rest } = ep;
  res.json({
    ...rest,
    has_transcript: !!transcript_text,
    calls,
    mentions,
    comments,
    related_episode_id,
    related_article_id,
  });
});

export default router;
