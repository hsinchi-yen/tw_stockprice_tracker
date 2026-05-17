import { Router, Request, Response } from 'express';
import db from './db';

const router = Router();

// Allowed format: 1–10 alphanumeric chars, optional .TW or .TWO suffix
const TICKER_RE = /^[A-Z0-9]{1,10}(\.(TW|TWO))?$/;

router.get('/', (_req: Request, res: Response) => {
  const stocks = db.prepare(
    'SELECT ticker, buy_target AS buyTarget, sell_target AS sellTarget FROM stocks ORDER BY created_at ASC'
  ).all();
  res.json(stocks);
});

router.post('/', (req: Request, res: Response) => {
  const { tickers } = req.body as { tickers: string[] };
  if (!Array.isArray(tickers) || tickers.length === 0) {
    return res.status(400).json({ error: 'tickers array is required' });
  }
  const valid = tickers
    .map(t => t.trim().toUpperCase())
    .filter(t => TICKER_RE.test(t));
  if (valid.length === 0) {
    return res.status(400).json({ error: 'no valid tickers' });
  }
  const insert = db.prepare('INSERT OR IGNORE INTO stocks (ticker) VALUES (?)');
  const insertMany = db.transaction((items: string[]) => {
    for (const t of items) insert.run(t);
  });
  insertMany(valid);
  res.json({ ok: true });
});

// PATCH-style PUT: only updates fields that are present in the request body.
// Sending { buyTarget: 950 } will NOT touch sellTarget in the DB.
router.put('/:ticker', (req: Request, res: Response) => {
  const { ticker } = req.params;
  const { buyTarget, sellTarget } = req.body;

  const fields: Array<[string, number | null]> = [];
  if (buyTarget  !== undefined) fields.push(['buy_target',  buyTarget  ?? null]);
  if (sellTarget !== undefined) fields.push(['sell_target', sellTarget ?? null]);

  if (fields.length === 0) return res.json({ ok: true });

  const setClauses = fields.map(([col]) => `${col} = ?`).join(', ');
  const values     = [...fields.map(([, v]) => v), ticker];
  const info = db.prepare(`UPDATE stocks SET ${setClauses} WHERE ticker = ?`).run(...values);
  if (info.changes === 0) return res.status(404).json({ error: 'ticker not found' });
  res.json({ ok: true });
});

router.delete('/:ticker', (req: Request, res: Response) => {
  db.prepare('DELETE FROM stocks WHERE ticker = ?').run(req.params.ticker);
  res.json({ ok: true });
});

export default router;
