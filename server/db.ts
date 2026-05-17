import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Resolve relative to this file so the DB path is stable regardless of cwd.
// DB_DIR env var overrides (useful for testing or custom mounts).
const dataDir = process.env.DB_DIR ?? path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'stocks.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS stocks (
    ticker     TEXT PRIMARY KEY,
    buy_target REAL DEFAULT NULL,
    sell_target REAL DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

export default db;
