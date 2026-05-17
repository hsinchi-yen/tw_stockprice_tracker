import axios from 'axios';
import YahooFinance from 'yahoo-finance2';

// Singleton instance — yahoo-finance2 v3 requires instantiation (static calls are deprecated)
const yahooFinance = new YahooFinance();

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
// Uses Yahoo Finance so changePercent is correct both during and outside market hours.
// TWSE MIS API returned z="-" on weekends/holidays, making price===prevClose (change=0).
export async function fetchQuotes(symbols: string[]): Promise<QuoteData[]> {
  if (symbols.length === 0) return [];

  const sharesMap = await loadTotalShares();

  try {
    const raw       = await yahooFinance.quote(symbols);
    const quotesArr = Array.isArray(raw) ? raw : [raw];

    return quotesArr
      .filter(q => q != null && q.regularMarketPrice != null)
      .map(q => {
        const code      = codeFromTicker(q.symbol);
        const price     = q.regularMarketPrice!;
        const prevClose = q.regularMarketPreviousClose ?? price;
        const change    = parseFloat((price - prevClose).toFixed(2));
        const changePct = prevClose !== 0
          ? parseFloat(((change / prevClose) * 100).toFixed(2))
          : 0;

        // Yahoo Finance volume is in shares; convert to 張 (lots of 1000 shares)
        const volumeShares = q.regularMarketVolume ?? 0;
        const volume       = Math.round(volumeShares / 1000);

        const totalShares  = sharesMap.get(code);
        const totalSharesK = totalShares ? Math.round(totalShares / 1000) : null;
        const volumeRatio  = totalShares
          ? parseFloat(((volumeShares / totalShares) * 100).toFixed(4))
          : null;

        // Exact code match prevents substring collisions (e.g. 2330 vs 23309)
        const originalSymbol =
          symbols.find(s => codeFromTicker(s) === code) ?? q.symbol;

        return {
          symbol:        originalSymbol,
          name:          q.shortName ?? q.longName ?? code,
          price,
          prevClose,
          change,
          changePercent: changePct,
          volume,
          totalSharesK,
          volumeRatio,
          dayHigh: q.regularMarketDayHigh ?? null,
          dayLow:  q.regularMarketDayLow  ?? null,
        };
      });
  } catch (error: any) {
    console.error('[ProxyService] Failed to fetch from Yahoo Finance:', error.message);
    return [];
  }
}
