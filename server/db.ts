import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dataDir = path.join(process.cwd(), 'data');
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
