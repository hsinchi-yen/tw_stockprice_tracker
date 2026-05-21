import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Resolve relative to this file so the DB path is stable regardless of cwd.
// DB_DIR env var overrides (useful for testing or custom mounts).
const dataDir = process.env.DB_DIR ?? path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'stocks.db'));

// ── Embedded-friendly pragmas ─────────────────────────────────────────────────
// WAL mode: better concurrency, smaller footprint than DELETE journal.
// Checkpoint every 100 pages so -wal file stays small on flash storage.
db.pragma('journal_mode = WAL');
db.pragma('wal_autocheckpoint = 100');
// INCREMENTAL auto-vacuum reclaims freed pages immediately on DELETE.
db.pragma('auto_vacuum = INCREMENTAL');
// NORMAL is safe for this app (read-heavy, no critical transactions).
db.pragma('synchronous = NORMAL');
// Hard cap the WAL auxiliary file at 10 MB.
db.pragma('journal_size_limit = 10485760');

// ── Schema ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS stocks (
    ticker     TEXT PRIMARY KEY,
    buy_target REAL DEFAULT NULL,
    sell_target REAL DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ── Schema migrations (version-gated) ────────────────────────────────────────
const currentVersion = (db.pragma('user_version') as { user_version: number }[])[0].user_version;
// Add future ALTER TABLE statements here as version increments.
if (currentVersion < 1) {
  db.pragma('user_version = 1');
}

// ── Scheduled maintenance ─────────────────────────────────────────────────────
// Call at server startup; runs incremental vacuum daily to reclaim freed space.
export function scheduleMaintenance(): void {
  const run = () => {
    try {
      db.pragma('incremental_vacuum');
      console.log('[db] incremental_vacuum completed');
    } catch (e: any) {
      console.error('[db] incremental_vacuum failed:', e.message);
    }
  };
  // First run after 1 hour, then every 24 hours.
  setTimeout(() => { run(); setInterval(run, 24 * 3600 * 1000); }, 3600 * 1000);
}

export default db;
