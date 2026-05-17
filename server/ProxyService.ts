import axios from 'axios';

export interface QuoteData {
  symbol:        string;
  name:          string;
  price:         number;
  prevClose:     number;
  change:        number;
  changePercent: number;
  volume:        number;          // today's volume in 張
  totalSharesK:  number | null;   // total outstanding shares in 張 (shares ÷ 1000)
  volumeRatio:   number | null;   // % of total outstanding shares traded today
  dayHigh:       number | null;
  dayLow:        number | null;
}

// ── Daily cache for total outstanding shares ───────────────────────────────────
let sharesCache: Map<string, number> = new Map();
let sharesCacheDate = '';

async function loadTotalShares(): Promise<Map<string, number>> {
  const today = new Date().toISOString().split('T')[0];
  if (sharesCacheDate === today && sharesCache.size > 0) return sharesCache;

  try {
    // TWSE OpenAPI — returns JSON without WAF restrictions
    const res = await axios.get(
      'https://openapi.twse.com.tw/v1/opendata/t187ap03_L',
      { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 }
    );
    const rows: any[] = Array.isArray(res.data) ? res.data : [];
    sharesCache = new Map();
    rows.forEach(row => {
      const code   = row['公司代號'];
      const shares = parseInt((row['已發行普通股數或TDR原股發行股數'] ?? '').replace(/,/g, ''), 10);
      if (code && !isNaN(shares) && shares > 0) sharesCache.set(code, shares);
    });
    sharesCacheDate = today;
    console.log(`[ProxyService] Loaded shares for ${sharesCache.size} stocks`);
  } catch (e: any) {
    console.error('[ProxyService] Failed to load total shares:', e.message);
  }
  return sharesCache;
}

// ── Normalise a ticker to its bare exchange code ──────────────────────────────
function codeFromTicker(ticker: string): string {
  return ticker.replace(/\.(TW|TWO)$/i, '').toUpperCase();
}

// ── Quote fetcher ─────────────────────────────────────────────────────────────
export async function fetchQuotes(symbols: string[]): Promise<QuoteData[]> {
  if (symbols.length === 0) return [];

  const sharesMap = await loadTotalShares();

  try {
    const queries = symbols.map(s => {
      const id = codeFromTicker(s);
      return `tse_${id}.tw|otc_${id}.tw`;
    }).join('|');

    const url      = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${queries}`;
    const response = await axios.get(url, { timeout: 8000 });
    const results: any[] = response.data?.msgArray || [];

    return results
      .filter(item => item.c)
      .map(item => {
        const price     = parseFloat(item.z !== '-' ? item.z : item.y);
        const prevClose = parseFloat(item.y);
        const change    = isNaN(price) || isNaN(prevClose) ? 0 : price - prevClose;
        const changePct = prevClose !== 0 ? (change / prevClose) * 100 : 0;
        const volume    = parseInt(item.v, 10) || 0;

        const totalShares = sharesMap.get(item.c);
        const totalSharesK = totalShares ? Math.round(totalShares / 1000) : null;
        const volumeRatio = totalShares
          ? parseFloat(((volume * 1000 / totalShares) * 100).toFixed(4))
          : null;

        // Exact code match prevents substring collisions (e.g. 2330 vs 23309)
        const originalSymbol =
          symbols.find(s => codeFromTicker(s) === item.c.toUpperCase()) ??
          `${item.c}.TW`;

        return {
          symbol:        originalSymbol,
          name:          item.n || item.c,
          price:         isNaN(price)     ? 0 : price,
          prevClose:     isNaN(prevClose) ? 0 : prevClose,
          change:        parseFloat(change.toFixed(2)),
          changePercent: parseFloat(changePct.toFixed(2)),
          volume,
          totalSharesK,
          volumeRatio,
          dayHigh: parseFloat(item.h) || null,
          dayLow:  parseFloat(item.l) || null,
        };
      });
  } catch (error: any) {
    console.error('[ProxyService] Failed to fetch from TWSE:', error.message);
    return [];
  }
}
