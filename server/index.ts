import express from 'express';
import cors from 'cors';
import { fetchQuotes } from './ProxyService';
import stocksRouter from './StocksRouter';

const app = express();
const PORT = 3000;

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
  const symbols = symbolsQuery.split(',').filter(Boolean);
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
});
