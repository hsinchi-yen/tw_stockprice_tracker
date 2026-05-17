import { Router, Request, Response } from 'express';
import db from './db';

const router = Router();

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
  const insert = db.prepare('INSERT OR IGNORE INTO stocks (ticker) VALUES (?)');
  const insertMany = db.transaction((items: string[]) => {
    for (const t of items) insert.run(t.trim().toUpperCase());
  });
  insertMany(tickers);
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
  db.prepare(`UPDATE stocks SET ${setClauses} WHERE ticker = ?`).run(...values);
  res.json({ ok: true });
});

router.delete('/:ticker', (req: Request, res: Response) => {
  db.prepare('DELETE FROM stocks WHERE ticker = ?').run(req.params.ticker);
  res.json({ ok: true });
});

export default router;
