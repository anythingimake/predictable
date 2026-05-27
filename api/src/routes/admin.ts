import { Router, type Request, type Response, type NextFunction } from "express";
import { db, reload } from "../db.js";
import Database from "better-sqlite3";
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

export default router;
