import { Router } from "express";
import { db } from "../db.js";

const router = Router();

// /api/principles — list all heuristics + citation counts
router.get("/principles", (_req, res) => {
  const rows = db().prepare(`
    SELECT p.id, p.rule, p.rationale, p.first_episode_id,
           (SELECT COUNT(*) FROM principle_citations WHERE principle_id = p.id) AS citation_count
    FROM principles p
    ORDER BY citation_count DESC, p.id
  `).all();
  res.json(rows);
});

router.get("/principles/:id", (req, res) => {
  const principle = db().prepare(`SELECT * FROM principles WHERE id = ?`).get(req.params.id) as any;
  if (!principle) return res.status(404).json({ error: "not_found" });
  const citations = db().prepare(`
    SELECT pc.episode_id, pc.timestamp_sec, pc.quote,
           COALESCE(e.substack_title, e.megaphone_title) AS episode_title, e.publish_date
    FROM principle_citations pc
    JOIN episodes e ON e.id = pc.episode_id
    WHERE pc.principle_id = ?
    ORDER BY e.publish_date
  `).all(req.params.id);
  res.json({ ...principle, citations });
});

// /api/strategies — list multi-call plays
router.get("/strategies", (_req, res) => {
  const rows = db().prepare(`
    SELECT s.id, s.name, s.episode_id, s.pattern_type, s.description,
           e.publish_date, COALESCE(e.substack_title, e.megaphone_title) AS episode_title,
           (SELECT COUNT(*) FROM strategy_calls WHERE strategy_id = s.id) AS call_count
    FROM strategies s JOIN episodes e ON e.id = s.episode_id
    ORDER BY e.publish_date DESC
  `).all();
  res.json(rows);
});

// /api/sagas — multi-episode market arcs
router.get("/sagas", (_req, res) => {
  const rows = db().prepare(`
    SELECT s.id, s.name, s.market_id, s.status,
           m.question AS market_question, m.source AS market_source,
           (SELECT COUNT(*) FROM saga_episodes WHERE saga_id = s.id) AS episode_count
    FROM sagas s LEFT JOIN markets m ON m.id = s.market_id
    ORDER BY s.status, s.name
  `).all();
  res.json(rows);
});

// /api/sagas/:id — saga detail with episodes
router.get("/sagas/:id", (req, res) => {
  const saga = db().prepare(`
    SELECT s.id, s.name, s.market_id, s.status,
           m.question AS market_question, m.source AS market_source,
           m.current_price, m.resolved, m.resolution
      FROM sagas s LEFT JOIN markets m ON m.id = s.market_id
     WHERE s.id = ?
  `).get(req.params.id) as any;
  if (!saga) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const episodes = db().prepare(`
    SELECT e.id, e.publish_date,
           COALESCE(e.substack_title, e.megaphone_title) AS episode_title,
           e.youtube_id, e.substack_slug
      FROM saga_episodes se
      JOIN episodes e ON e.id = se.episode_id
     WHERE se.saga_id = ?
     ORDER BY e.publish_date
  `).all(req.params.id);
  res.json({ ...saga, episodes });
});

// /api/calendar — market resolutions for any market Stu has a call on.
// status: 'upcoming' (future date, unresolved), 'aged_out' (the date passed but
// the market never reported a clean resolution — the clock ran out), or
// 'resolved' (settled). Returning resolved markets too keeps the calendar from
// looking dead in the stretch before the next election.
router.get("/calendar", (_req, res) => {
  const rows = db().prepare(`
    SELECT m.id AS market_id, m.question, m.resolution_date, m.source,
           m.resolved, m.resolution,
           (SELECT COUNT(*) FROM calls WHERE market_id = m.id AND status = 'open') AS open_call_count,
           (SELECT COUNT(*) FROM calls WHERE market_id = m.id) AS call_count,
           CASE
             WHEN m.resolved = 1 THEN 'resolved'
             WHEN m.resolution_date < date('now') THEN 'aged_out'
             ELSE 'upcoming'
           END AS status
    FROM markets m
    WHERE m.resolution_date IS NOT NULL
      AND EXISTS (SELECT 1 FROM calls WHERE market_id = m.id AND market_id IS NOT NULL)
    ORDER BY m.resolution_date
  `).all();
  res.json(rows);
});

// /api/media-vs-markets
router.get("/media-vs-markets", (_req, res) => {
  const rows = db().prepare(`
    SELECT mvm.*, COALESCE(e.substack_title, e.megaphone_title) AS episode_title,
           e.publish_date
    FROM media_vs_markets mvm JOIN episodes e ON e.id = mvm.episode_id
    ORDER BY e.publish_date DESC
  `).all();
  res.json(rows);
});

// /api/glossary
router.get("/glossary", (_req, res) => {
  const rows = db().prepare(`SELECT term, definition, first_episode_id FROM glossary ORDER BY term`).all();
  res.json(rows);
});

// /api/search — naive transcript LIKE search
router.get("/search", (req, res) => {
  const q = (req.query.q as string | undefined)?.trim();
  if (!q || q.length < 3) return res.json({ results: [] });
  const pat = `%${q}%`;
  const episodes = db().prepare(`
    SELECT id, publish_date, COALESCE(substack_title, megaphone_title) AS title
    FROM episodes
    WHERE transcript_text LIKE ? OR substack_body LIKE ?
    ORDER BY publish_date DESC LIMIT 20
  `).all(pat, pat);
  const calls = db().prepare(`
    SELECT c.id, c.market_hint, c.episode_id,
           COALESCE(e.substack_title, e.megaphone_title) AS episode_title
    FROM calls c JOIN episodes e ON e.id = c.episode_id
    WHERE c.market_hint LIKE ? OR c.notes LIKE ?
    LIMIT 20
  `).all(pat, pat);
  res.json({ episodes, calls });
});

export default router;
