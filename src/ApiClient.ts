const BASE = '';

export interface StockConfig {
  ticker: string;
  buyTarget: number | null;
  sellTarget: number | null;
}

export async function getStocks(): Promise<StockConfig[]> {
  const res = await fetch(`${BASE}/api/stocks`);
  return res.json();
}

export async function addStocks(tickers: string[]): Promise<void> {
  await fetch(`${BASE}/api/stocks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tickers }),
  });
}

export async function updateStock(ticker: string, updates: Partial<StockConfig>): Promise<void> {
  await fetch(`${BASE}/api/stocks/${encodeURIComponent(ticker)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
}

export async function removeStock(ticker: string): Promise<void> {
  await fetch(`${BASE}/api/stocks/${encodeURIComponent(ticker)}`, {
    method: 'DELETE',
  });
}

export async function fetchQuotes(symbols: string[]): Promise<any[]> {
  if (symbols.length === 0) return [];
  const res = await fetch(`${BASE}/api/quotes?symbols=${symbols.join(',')}`);
  return res.json();
}
