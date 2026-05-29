import { Router, type Request, type Response, type NextFunction } from "express";
import { db, reload } from "../db.js";
import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const router = Router();

const ADMIN_TOKEN = process.env.PREDICTABLE_ADMIN_TOKEN ?? "";

function resolveDbPath(): string {
  const repoRoot = path.resolve(__dirname, "../..");
  return process.env.PREDICTABLE_DB ?? path.join(repoRoot, "data", "predictable.sqlite");
}

// ---- Admin call overrides / hides / manual calls ----
// These endpoints write the `call_admin` side table (source of truth) AND
// immediately stamp the one call onto `calls` (via applyCallAdmin) so the public
// site reflects it between hourly refreshes. pipeline/enrich/apply_admin.py is
// authoritative and re-asserts every refresh — KEEP the stamping logic + the
// hybrid math below in sync with that module (which reuses scoring.py).
const SIDES = new Set(["yes", "no", "over", "under"]);
const CONVICTIONS = new Set(["play", "solid", "flyer", "watch", "opinion", "pass"]);
const STATUSES = new Set(["open", "closed", "resolved"]);

function mintManualCallId(episodeId: string, hint: string, side: string): number {
  const nonce = `${Date.now()}-${Math.random()}`;
  const key = `manual|${episodeId}|${hint.toLowerCase().trim()}|${side.trim().toLowerCase()}|${nonce}`;
  const hex = crypto.createHash("sha1").update(key, "utf8").digest("hex").slice(0, 13);
  return parseInt(hex, 16); // <= 2^52, inside Number.MAX_SAFE_INTEGER (matches load._stable_call_id)
}

function hardCloseCents(side: string, res: string): number {
  const s = (side || "").trim().toLowerCase(), r = (res || "").trim().toLowerCase();
  const won = (r === "yes" && (s === "yes" || s === "over")) || (r === "no" && (s === "no" || s === "under"));
  return won ? 100 : 0;
}
function realizedPct(entry: number, close: number): number {
  return entry <= 0 ? 0 : ((close - entry) / entry) * 100;
}
function inferWinner(price: number | null): string | null {
  if (price == null) return null;
  const cents = price <= 1.5 ? price * 100 : price;
  return cents >= 50 ? "yes" : "no";
}
function marketResolution(wdb: Database.Database, mid: string): string | null {
  const m = wdb.prepare("SELECT resolved, resolution, current_price, effective_resolution FROM markets WHERE id=?").get(mid) as any;
  if (!m) return null;
  const r = (m.resolution || "").trim().toLowerCase(); if (r === "yes" || r === "no") return r;
  const e = (m.effective_resolution || "").trim().toLowerCase(); if (e === "yes" || e === "no") return e;
  if (m.resolved === 1) return inferWinner(m.current_price);
  return null;
}

// Mirror of pipeline/enrich/apply_admin.apply_call_admin — stamp one call_admin
// row onto `calls`. Keep in sync with that Python.
function applyCallAdmin(wdb: Database.Database, callId: number): void {
  const row = wdb.prepare("SELECT * FROM call_admin WHERE call_id=?").get(callId) as any;
  if (!row) return;
  if (row.is_manual) {
    const ep = row.episode_id;
    if (!ep || !wdb.prepare("SELECT 1 FROM episodes WHERE id=?").get(ep)) return;
    const side = (row.side || "yes").trim().toLowerCase();
    const conviction = (row.conviction || "opinion").trim().toLowerCase();
    if (!SIDES.has(side) || !CONVICTIONS.has(conviction)) return;
    wdb.prepare(
      `INSERT INTO calls (id,market_id,market_hint,episode_id,first_event_ts,side,conviction,size_disclosed,speaker,status,notes,tags,hidden)
       VALUES (?,?,?,?,?,?,?,NULL,'stu','open',NULL,?,0)
       ON CONFLICT(id) DO UPDATE SET market_id=excluded.market_id, market_hint=excluded.market_hint,
         episode_id=excluded.episode_id, first_event_ts=excluded.first_event_ts, side=excluded.side,
         conviction=excluded.conviction, tags=excluded.tags`
    ).run(callId, row.market_id, row.market_hint || "(manual call)", ep, row.first_event_ts || 0, side, conviction, row.tags || "[]");
    let status = (row.status || "open").trim().toLowerCase(); if (!STATUSES.has(status)) status = "open";
    let realized = row.realized_pct;
    const entry = row.entry_price, mid = row.market_id;
    wdb.prepare("DELETE FROM call_events WHERE call_id=? AND event_type='entry'").run(callId);
    if (entry != null) {
      wdb.prepare("INSERT INTO call_events (call_id,episode_id,timestamp_sec,event_type,price_pct,size_pct_of_pos,quote,raw_quote) VALUES (?,?,?,'entry',?,NULL,NULL,NULL)")
        .run(callId, ep, row.first_event_ts || 0, entry);
      if (mid) {
        const res = marketResolution(wdb, mid);
        if (res === "yes" || res === "no") {
          realized = realizedPct(entry, hardCloseCents(side, res));
          const settled = wdb.prepare("SELECT resolved FROM markets WHERE id=?").get(mid) as any;
          status = settled && settled.resolved === 1 ? "resolved" : "closed";
        }
      }
    }
    wdb.prepare("UPDATE calls SET status=?, realized_pct=? WHERE id=?").run(status, realized, callId);
  } else {
    for (const col of ["market_hint", "side", "conviction", "status", "realized_pct", "tags"]) {
      const val = row[col]; if (val == null) continue;
      const v = String(val).trim().toLowerCase();
      if (col === "side" && !SIDES.has(v)) continue;
      if (col === "conviction" && !CONVICTIONS.has(v)) continue;
      if (col === "status" && !STATUSES.has(v)) continue;
      wdb.prepare(`UPDATE calls SET ${col}=? WHERE id=?`).run(val, callId);
    }
  }
  if (row.market_id && wdb.prepare("SELECT 1 FROM markets WHERE id=?").get(row.market_id)) {
    wdb.prepare("UPDATE calls SET market_id=?, notes=? WHERE id=?")
      .run(row.market_id, `pin:no-auto-link (admin-forced ${row.market_id})`, callId);
  }
  wdb.prepare("UPDATE calls SET hidden=? WHERE id=?").run(row.hidden ? 1 : 0, callId);
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  // Primary gate: the SSO proxy (oauth2-proxy + nginx) signs the visitor in with
  // Google and vouches the email via X-Auth-Request-Email — set ONLY by nginx on
  // the gated /api/admin/ location after a successful auth (nginx overwrites any
  // client value, and this API listens on 127.0.0.1 so it's unreachable except
  // through nginx). A non-empty value is proof of an allow-listed admin.
  const gateEmail = (req.header("x-auth-request-email") ?? "").trim();
  // Fallback: the shared bearer token (break-glass / non-gated access).
  const token = (req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (gateEmail || (ADMIN_TOKEN && token === ADMIN_TOKEN)) {
    next();
    return;
  }
  res.status(401).json({ error: "unauthorized" });
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

// GET /api/admin/calls — base call + admin overlay (the ONLY calls-read that
// shows hidden calls). Readonly connection.
router.get("/calls", requireAdmin, (_req, res) => {
  const rows = db().prepare(`
    SELECT c.id, c.market_id, c.market_hint, c.episode_id, c.side, c.conviction,
           c.status, c.realized_pct, c.stu_claimed_pct, c.tags, c.first_event_ts,
           c.hidden, c.notes, e.publish_date,
           COALESCE(e.substack_title, e.megaphone_title) AS episode_title,
           ca.is_manual,
           ca.market_hint  AS ov_market_hint, ca.side AS ov_side, ca.conviction AS ov_conviction,
           ca.status AS ov_status, ca.realized_pct AS ov_realized_pct, ca.market_id AS ov_market_id,
           ca.tags AS ov_tags, ca.hidden AS ov_hidden, ca.entry_price AS ov_entry_price
    FROM calls c
    JOIN episodes e ON e.id = c.episode_id
    LEFT JOIN call_admin ca ON ca.call_id = c.id
    ORDER BY e.publish_date DESC, c.first_event_ts
  `).all();
  res.json(rows);
});

// POST /api/admin/calls — create a manual call.
router.post("/calls", requireAdmin, (req, res) => {
  const b = req.body as Record<string, any>;
  const { episode_id, market_hint, side, conviction } = b;
  if (!episode_id || !market_hint || !SIDES.has(side) || !CONVICTIONS.has(conviction)) {
    res.status(400).json({ error: "episode_id, market_hint, valid side + conviction required" });
    return;
  }
  if (b.status != null && !STATUSES.has(b.status)) { res.status(400).json({ error: "bad status" }); return; }
  const wdb = new Database(resolveDbPath());
  try {
    if (!wdb.prepare("SELECT 1 FROM episodes WHERE id=?").get(episode_id)) { res.status(400).json({ error: "unknown episode_id" }); return; }
    if (b.market_id && !wdb.prepare("SELECT 1 FROM markets WHERE id=?").get(b.market_id)) { res.status(400).json({ error: "unknown market_id" }); return; }
    let id = mintManualCallId(episode_id, market_hint, side);
    for (let i = 0; i < 5 && wdb.prepare("SELECT 1 FROM call_admin WHERE call_id=?").get(id); i++) id = mintManualCallId(episode_id, market_hint, side);
    wdb.prepare(
      `INSERT INTO call_admin (call_id,is_manual,market_hint,side,conviction,status,realized_pct,market_id,tags,episode_id,entry_price,first_event_ts)
       VALUES (?,1,?,?,?,?,?,?,?,?,?,?)`
    ).run(id, market_hint, side, conviction, b.status ?? null, b.realized_pct ?? null, b.market_id ?? null, b.tags ?? null, episode_id, b.entry_price ?? null, b.first_event_ts ?? null);
    applyCallAdmin(wdb, id);
    res.json({ id });
  } finally { wdb.close(); }
  reload();
});

// PATCH /api/admin/calls/:id — set overrides / hide / unhide. Body keys present
// are applied (null clears that override; absent leaves it).
router.patch("/calls/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const b = req.body as Record<string, unknown>;
  for (const [k, set] of [["side", SIDES], ["conviction", CONVICTIONS], ["status", STATUSES]] as const) {
    if (b[k] != null && !set.has(String(b[k]))) { res.status(400).json({ error: `bad ${k}` }); return; }
  }
  const wdb = new Database(resolveDbPath());
  try {
    wdb.prepare("INSERT INTO call_admin (call_id) VALUES (?) ON CONFLICT(call_id) DO NOTHING").run(id);
    const cols = ["hidden", "market_hint", "side", "conviction", "status", "realized_pct", "market_id", "tags", "entry_price", "first_event_ts"];
    for (const col of cols) {
      if (!(col in b)) continue;
      const raw = b[col];
      const val = raw === null ? null : typeof raw === "boolean" ? (raw ? 1 : 0) : raw;
      wdb.prepare(`UPDATE call_admin SET ${col}=?, updated_at=CURRENT_TIMESTAMP WHERE call_id=?`).run(val as any, id);
    }
    const ca = wdb.prepare("SELECT market_id FROM call_admin WHERE call_id=?").get(id) as any;
    if (ca?.market_id && !wdb.prepare("SELECT 1 FROM markets WHERE id=?").get(ca.market_id)) { res.status(400).json({ error: "unknown market_id" }); return; }
    applyCallAdmin(wdb, id);
    res.json({ ok: true });
  } finally { wdb.close(); }
  reload();
});

// DELETE /api/admin/calls/:id — manual: remove entirely. override: drop the
// overlay; instantly undo cheap effects (hidden, admin-forced market+pin);
// pristine extracted field values restore on the next pipeline refresh.
router.delete("/calls/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const wdb = new Database(resolveDbPath());
  try {
    const ca = wdb.prepare("SELECT is_manual FROM call_admin WHERE call_id=?").get(id) as any;
    if (ca?.is_manual) {
      wdb.prepare("DELETE FROM call_events WHERE call_id=?").run(id);
      wdb.prepare("DELETE FROM call_admin WHERE call_id=?").run(id);
      wdb.prepare("DELETE FROM calls WHERE id=?").run(id);
    } else {
      wdb.prepare("DELETE FROM call_admin WHERE call_id=?").run(id);
      wdb.prepare("UPDATE calls SET hidden=0 WHERE id=?").run(id);
      // If admin forced a market, null it + the pin so the resolver re-links it
      // from scratch on the next refresh (restoring the pipeline's own choice).
      wdb.prepare("UPDATE calls SET market_id=NULL, notes=NULL WHERE id=? AND notes LIKE 'pin:no-auto-link (admin-forced%'").run(id);
    }
    res.json({ ok: true });
  } finally { wdb.close(); }
  reload();
});

export default router;
