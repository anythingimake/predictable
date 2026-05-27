import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve DB path: env override → repo data dir
const REPO_ROOT = path.resolve(__dirname, "../..");
const DEFAULT_DB = path.join(REPO_ROOT, "data", "predictable.sqlite");
const DB_PATH = process.env.PREDICTABLE_DB ?? DEFAULT_DB;

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;
  if (!fs.existsSync(DB_PATH)) {
    // Initialize empty DB from schema for first boot
    const schemaPath = path.join(__dirname, "schema.sql");
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const fresh = new Database(DB_PATH);
    fresh.exec(fs.readFileSync(schemaPath, "utf-8"));
    fresh.close();
  }
  _db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  return _db;
}

/** Bounce the connection — used by /api/admin/reload after the cron syncs a new DB. */
export function reload(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
  db();
}
