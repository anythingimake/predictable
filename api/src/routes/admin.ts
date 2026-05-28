import { Router, type Request, type Response, type NextFunction } from "express";
import { db, reload } from "../db.js";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const router = Router();

const ADMIN_TOKEN = process.env.PREDICTABLE_ADMIN_TOKEN ?? "";

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const auth = req.header("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

router.post("/reload", requireAdmin, (_req, res) => {
  reload();
  res.json({ ok: true });
});

router.get("/notes", requireAdmin, (req, res) => {
  const { scope_type, scope_id } = req.query as Record<string, string | undefined>;
  let sql = "SELECT * FROM admin_notes";
  const params: any[] = [];
  if (scope_type) {
    sql += " WHERE scope_type = ?";
    params.push(scope_type);
    if (scope_id) {
      sql += " AND scope_id = ?";
      params.push(scope_id);
    }
  }
  sql += " ORDER BY updated_at DESC";
  const rows = db().prepare(sql).all(...params);
  res.json(rows);
});

router.post("/notes", requireAdmin, (req, res) => {
  // Admin writes need a separate non-readonly connection
  const repoRoot = path.resolve(__dirname, "../..");
  const dbPath = process.env.PREDICTABLE_DB ?? path.join(repoRoot, "data", "predictable.sqlite");
  const writeDb = new Database(dbPath);
  try {
    const { scope_type, scope_id, body } = req.body as {
      scope_type: string;
      scope_id?: string;
      body: string;
    };
    if (!scope_type || !body) {
      res.status(400).json({ error: "scope_type and body required" });
      return;
    }
    const result = writeDb
      .prepare(
        `INSERT INTO admin_notes (scope_type, scope_id, body) VALUES (?, ?, ?)`
      )
      .run(scope_type, scope_id ?? null, body);
    res.json({ id: result.lastInsertRowid });
  } finally {
    writeDb.close();
  }
});

router.delete("/notes/:id", requireAdmin, (req, res) => {
  const repoRoot = path.resolve(__dirname, "../..");
  const dbPath = process.env.PREDICTABLE_DB ?? path.join(repoRoot, "data", "predictable.sqlite");
  const writeDb = new Database(dbPath);
  try {
    writeDb.prepare("DELETE FROM admin_notes WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  } finally {
    writeDb.close();
  }
});

// /api/admin/unresolved-markets — aggregates every unresolved-markets-*.json
// log file into one rolling "needs human review" list, deduped by
// (call_id, market_hint). Returned newest-first.
router.get("/unresolved-markets", requireAdmin, (_req, res) => {
  const repoRoot = path.resolve(__dirname, "../..");
  // Logs are written by the pipeline runner — check both the repo's data/
  // dir (dev) and /var/lib/predictable/logs (prod symlink) so the page works
  // in either environment.
  const candidates = [
    process.env.PREDICTABLE_LOGS_DIR,
    "/var/lib/predictable/logs",
    path.join(repoRoot, "..", "data", "logs"),
    path.join(repoRoot, "data", "logs"),
    "/opt/predictable-repo/data/logs",
  ].filter((p): p is string => typeof p === "string");
  type Entry = { call_id: number | null; episode_id: string | null; market_hint: string; reason: string; logged_on: string };
  const seen = new Map<string, Entry>();
  for (const dir of candidates) {
    let files: string[] = [];
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!f.startsWith("unresolved_markets-") || !f.endsWith(".json")) continue;
      const date = f.replace("unresolved_markets-", "").replace(".json", "");
      try {
        const arr = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as unknown;
        if (!Array.isArray(arr)) continue;
        for (const raw of arr) {
          if (!raw || typeof raw !== "object") continue;
          const e = raw as Record<string, unknown>;
          const key = `${e.call_id ?? ""}|${e.market_hint ?? ""}`;
          const newest = seen.get(key);
          if (newest && newest.logged_on >= date) continue;
          seen.set(key, {
            call_id: typeof e.call_id === "number" ? e.call_id : null,
            episode_id: typeof e.episode_id === "string" ? e.episode_id : null,
            market_hint: typeof e.market_hint === "string" ? e.market_hint : "",
            reason: typeof e.reason === "string" ? e.reason : "",
            logged_on: date,
          });
        }
      } catch {
        /* unreadable log — skip */
      }
    }
  }
  // Filter to entries whose call_id still has NULL market_id — anything that
  // got resolved out of band is no longer "needs review".
  const stillUnresolved = db().prepare(
    `SELECT id FROM calls WHERE market_id IS NULL`
  ).all() as Array<{ id: number }>;
  const openCallIds = new Set(stillUnresolved.map((r) => r.id));
  const rows = Array.from(seen.values())
    .filter((e) => e.call_id === null || openCallIds.has(e.call_id))
    .sort((a, b) => b.logged_on.localeCompare(a.logged_on));
  res.json(rows);
});

export default router;
