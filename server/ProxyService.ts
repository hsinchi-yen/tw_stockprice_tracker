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
let sharesFetchPromise: Promise<Map<string, number>> | null = null;

async function loadTotalShares(): Promise<Map<string, number>> {
  const today = new Date().toISOString().split('T')[0];
  if (sharesCacheDate === today && sharesCache.size > 0) return sharesCache;

  // Deduplicate concurrent fetches — only one HTTP call at a time
  if (!sharesFetchPromise) {
    sharesFetchPromise = (async () => {
      try {
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
    })().finally(() => { sharesFetchPromise = null; });
  }
  return sharesFetchPromise;
}

// ── Normalise a ticker to its bare exchange code ──────────────────────────────
function codeFromTicker(ticker: string): string {
  return ticker.replace(/\.(TW|TWO)$/i, '').toUpperCase();
}

// Convert ticker to TWSE MIS key(s).
// Bare codes (no .TW/.TWO suffix) return both tse_ and otc_ so the API returns
// whichever exchange the stock is actually listed on.
function tickerToMisKeys(ticker: string): string[] {
  const code = codeFromTicker(ticker).toLowerCase();
  if (/\.TWO$/i.test(ticker)) return [`otc_${code}.tw`];
  if (/\.TW$/i.test(ticker))  return [`tse_${code}.tw`];
  return [`tse_${code}.tw`, `otc_${code}.tw`];
}

// ── TWSE MIS API (primary) ────────────────────────────────────────────────────
interface TwseQuoteRaw {
  c:  string;   // code
  z:  string;   // current price or "-"
  y:  string;   // prevClose
  v:  string;   // volume in 張
  h:  string;   // dayHigh
  l:  string;   // dayLow
  n:  string;   // name
  ex: string;   // exchange: tse | otc
}

async function fetchTwseMis(symbols: string[]): Promise<Map<string, TwseQuoteRaw>> {
  const result = new Map<string, TwseQuoteRaw>();
  if (symbols.length === 0) return result;

  const exCh = symbols.flatMap(tickerToMisKeys).join('|');
  try {
    const res = await axios.get(
      `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${exCh}&json=1&delay=0`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 }
    );
    const rows: TwseQuoteRaw[] = res.data?.msgArray ?? [];
    rows.forEach(row => {
      if (row.c) result.set(row.c, row);
    });
  } catch (e: any) {
    console.error('[ProxyService] TWSE MIS fetch failed:', e.message);
  }
  return result;
}

function buildFromTwse(
  symbol: string,
  row: TwseQuoteRaw,
  sharesMap: Map<string, number>
): QuoteData | null {
  const price     = parseFloat(row.z);
  const prevClose = parseFloat(row.y);
  if (isNaN(price) || isNaN(prevClose)) return null;

  const code      = row.c;
  const change    = Math.round((price - prevClose) * 100) / 100;
  const changePct = prevClose !== 0
    ? Math.round((change / prevClose) * 10000) / 100
    : 0;

  const volumeZhang  = parseInt(row.v, 10) || 0;
  const volumeShares = volumeZhang * 1000;

  const totalShares  = sharesMap.get(code);
  const totalSharesK = totalShares ? Math.round(totalShares / 1000) : null;
  const volumeRatio  = totalShares
    ? parseFloat(((volumeShares / totalShares) * 100).toFixed(4))
    : null;

  const hVal = parseFloat(row.h);
  const lVal = parseFloat(row.l);

  return {
    symbol,
    name:          row.n || code,
    price,
    prevClose,
    change,
    changePercent: changePct,
    volume:        volumeZhang,
    totalSharesK,
    volumeRatio,
    dayHigh: isNaN(hVal) ? null : hVal,
    dayLow:  isNaN(lVal) ? null : lVal,
  };
}

// ── Yahoo Finance v8/chart (fallback) ─────────────────────────────────────────
interface YahooChartResult {
  price:     number;
  prevClose: number;
  volume:    number;   // in 張
  dayHigh:   number | null;
  dayLow:    number | null;
  name:      string;
}

async function fetchYahooChart(ticker: string): Promise<YahooChartResult | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`;
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      timeout: 10000,
    });
    const result = res.data?.chart?.result?.[0];
    if (!result) return null;

    const meta      = result.meta;
    const price     = meta.regularMarketPrice;
    const prevClose = meta.previousClose ?? meta.chartPreviousClose;
    if (price == null || prevClose == null) return null;

    return {
      price,
      prevClose,
      volume:  Math.round((meta.regularMarketVolume ?? 0) / 1000),
      dayHigh: meta.regularMarketDayHigh ?? null,
      dayLow:  meta.regularMarketDayLow  ?? null,
      name:    meta.shortName ?? meta.longName ?? codeFromTicker(ticker),
    };
  } catch (e: any) {
    console.error(`[ProxyService] Yahoo Finance fallback failed for ${ticker}:`, e?.message || e?.code || String(e));
    return null;
  }
}

function buildFromYahoo(
  symbol: string,
  chart: YahooChartResult,
  sharesMap: Map<string, number>,
  preferredName?: string
): QuoteData {
  const code      = codeFromTicker(symbol);
  const { price, prevClose, volume, dayHigh, dayLow, name } = chart;
  const change    = Math.round((price - prevClose) * 100) / 100;
  const changePct = prevClose !== 0
    ? Math.round((change / prevClose) * 10000) / 100
    : 0;

  const volumeShares = volume * 1000;
  const totalShares  = sharesMap.get(code);
  const totalSharesK = totalShares ? Math.round(totalShares / 1000) : null;
  const volumeRatio  = totalShares
    ? parseFloat(((volumeShares / totalShares) * 100).toFixed(4))
    : null;

  return {
    symbol,
    name: preferredName || name,
    price,
    prevClose,
    change,
    changePercent: changePct,
    volume,
    totalSharesK,
    volumeRatio,
    dayHigh,
    dayLow,
  };
}

// ── Quote fetcher ─────────────────────────────────────────────────────────────
// Primary: TWSE MIS API — real-time batch quotes, no auth, works on ARM
// Fallback: Yahoo Finance v8/chart — used when TWSE returns z="-" (market closed) or fails
export async function fetchQuotes(symbols: string[]): Promise<QuoteData[]> {
  if (symbols.length === 0) return [];

  const [sharesMap, twseMap] = await Promise.all([
    loadTotalShares(),
    fetchTwseMis(symbols),
  ]);

  const results: QuoteData[] = [];
  const fallbackItems: {
    symbol:     string;
    yahooTicker: string;
    twseName?:  string;
    twseYPrice?: string;   // TWSE prevClose (y field) — last-resort price when Yahoo fails
  }[] = [];

  for (const symbol of symbols) {
    const code = codeFromTicker(symbol);
    const row  = twseMap.get(code);

    if (row && row.z !== '-' && row.z !== '') {
      const q = buildFromTwse(symbol, row, sharesMap);
      if (q) { results.push(q); continue; }
    }
    // Determine correct Yahoo Finance ticker (needs exchange suffix)
    let yahooTicker = symbol;
    if (!/\.(TW|TWO)$/i.test(symbol)) {
      yahooTicker = row?.ex === 'otc' ? `${code}.TWO` : `${code}.TW`;
    }
    fallbackItems.push({
      symbol,
      yahooTicker,
      twseName:   row?.n  || undefined,
      twseYPrice: row?.y  || undefined,
    });
  }

  if (fallbackItems.length > 0) {
    console.log(`[ProxyService] Falling back to Yahoo Finance for: ${fallbackItems.map(f => f.symbol).join(', ')}`);
    const yahooResults = await Promise.all(
      fallbackItems.map(async ({ symbol, yahooTicker, twseName, twseYPrice }) => {
        const chart = await fetchYahooChart(yahooTicker);
        if (chart) return buildFromYahoo(symbol, chart, sharesMap, twseName);

        // Yahoo unavailable: render card using TWSE prevClose so it doesn't stay "讀取中"
        const yPrice = parseFloat(twseYPrice ?? '');
        if (!isNaN(yPrice) && yPrice > 0) {
          const code        = codeFromTicker(symbol);
          const totalShares = sharesMap.get(code);
          return {
            symbol,
            name:          twseName || code,
            price:         yPrice,
            prevClose:     yPrice,
            change:        0,
            changePercent: 0,
            volume:        0,
            totalSharesK:  totalShares ? Math.round(totalShares / 1000) : null,
            volumeRatio:   null,
            dayHigh:       null,
            dayLow:        null,
          } as QuoteData;
        }
        return null;
      })
    );
    yahooResults.forEach(q => { if (q) results.push(q); });
  }

  return results;
}
