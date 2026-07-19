import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_RUNTIME_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../data/runtime");

let db: Database.Database | null = null;

/** Allow tests to inject an isolated DB path before first use. */
export function openDb(dbPath?: string): Database.Database {
  if (db && !dbPath) return db;
  if (db && dbPath) {
    db.close();
    db = null;
  }
  const path =
    dbPath ??
    process.env.DOMINION_DB_PATH ??
    join(DEFAULT_RUNTIME_DIR, "dominion.db");
  mkdirSync(dirname(path), { recursive: true });
  db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS house_ownership (
      house_id INTEGER PRIMARY KEY,
      uid TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS party (
      uid TEXT NOT NULL,
      slot INTEGER NOT NULL,
      species_id INTEGER NOT NULL,
      level INTEGER NOT NULL,
      hp INTEGER NOT NULL,
      PRIMARY KEY (uid, slot)
    );
    CREATE TABLE IF NOT EXISTS chat_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      uid TEXT NOT NULL,
      name TEXT NOT NULL,
      channel TEXT NOT NULL,
      text TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inventory (
      uid TEXT NOT NULL,
      item_id TEXT NOT NULL,
      qty INTEGER NOT NULL,
      PRIMARY KEY (uid, item_id)
    );
  `);
  return db;
}

export function getDb(): Database.Database {
  if (!db) return openDb();
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
