import express from 'express';
import cors from 'cors';
import { fetchQuotes, warmupShares } from './ProxyService';
import stocksRouter from './StocksRouter';
import { scheduleMaintenance } from './db';

const app = express();
const PORT = 3000;
const MAX_SYMBOLS = 50;

// In production (Yocto), nginx proxies /api/ so the browser never hits :3000 directly.
// ALLOWED_ORIGIN is only relevant for local dev (Vite at :5173).
app.use(cors({ origin: process.env.ALLOWED_ORIGIN ?? 'http://localhost:5173' }));
app.use(express.json({ limit: '16kb' }));

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// Stock CRUD
app.use('/api/stocks', stocksRouter);

// Quote proxy
app.get('/api/quotes', async (req, res) => {
  const symbolsQuery = req.query.symbols as string;
  if (!symbolsQuery) return res.json([]);
  const symbols = symbolsQuery.split(',').map(s => s.trim()).filter(Boolean);

  if (symbols.length > MAX_SYMBOLS) {
    return res.status(400).json({ error: `Too many symbols; max is ${MAX_SYMBOLS} per request` });
  }

  try {
    const quotes = await fetchQuotes(symbols);
    res.json(quotes);
  } catch (e: any) {
    console.error('[/api/quotes]', e?.message ?? e);
    res.status(502).json([]);
  }
});

app.listen(PORT, () => {
  console.log(`Proxy server running on http://localhost:${PORT}`);
  // Pre-load total-shares data so the first quote request is fast.
  warmupShares().catch(e => console.error('[warmup] shares failed:', e));
  // Schedule daily SQLite incremental vacuum to keep DB size stable on embedded storage.
  scheduleMaintenance();
});
