import express from 'express';
import cors from 'cors';
import { fetchQuotes } from './ProxyService';
import stocksRouter from './StocksRouter';

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// Stock CRUD
app.use('/api/stocks', stocksRouter);

// Quote proxy
app.get('/api/quotes', async (req, res) => {
  const symbolsQuery = req.query.symbols as string;
  if (!symbolsQuery) return res.json([]);
  const symbols = symbolsQuery.split(',');
  const quotes = await fetchQuotes(symbols);
  res.json(quotes);
});

app.listen(PORT, () => {
  console.log(`Proxy server running on http://localhost:${PORT}`);
});
