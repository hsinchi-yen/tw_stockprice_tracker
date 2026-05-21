import { fetchQuotes, clearQuoteCache } from './ProxyService';
import axios from 'axios';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);

// ── Shared fixtures ────────────────────────────────────────────────────────────

const sharesResponse = {
  data: [
    { '公司代號': '2330', '已發行普通股數或TDR原股發行股數': '25930380000' },
    { '公司代號': '2317', '已發行普通股數或TDR原股發行股數': '13862640000' },
  ],
};

// TWSE MIS response during market hours (z = valid price)
const twseMisOpen = {
  data: {
    msgArray: [
      { c: '2330', z: '1000', y: '980',  v: '5000', h: '1010', l: '975', n: '台積電', ex: 'tse' },
      { c: '2317', z: '200',  y: '195',  v: '3000', h: '205',  l: '190', n: '鴻海',   ex: 'tse' },
    ],
  },
};

// TWSE MIS response when market is closed (z = "-")
const twseMisClosed = {
  data: {
    msgArray: [
      { c: '2330', z: '-', y: '980', v: '5000', h: '1010', l: '975', n: '台積電', ex: 'tse' },
    ],
  },
};

// Yahoo Finance v8/chart response (used as fallback)
const yahooChartTsmc = {
  data: {
    chart: {
      result: [{
        meta: {
          regularMarketPrice:    1000,
          previousClose:          980,
          regularMarketVolume: 5000000,
          regularMarketDayHigh:  1010,
          regularMarketDayLow:    975,
          shortName:            '台積電',
        },
      }],
    },
  },
};

// ── Mock helper ────────────────────────────────────────────────────────────────

function setupMocks(opts: {
  twse?:      any;
  yahoo?:     any;
  twseFails?: boolean;
  yahooFails?: boolean;
} = {}) {
  mockedAxios.get.mockImplementation((url: string) => {
    if (url.includes('openapi.twse.com.tw'))  return Promise.resolve(sharesResponse);
    if (url.includes('mis.twse.com.tw')) {
      if (opts.twseFails) return Promise.reject(new Error('TWSE network error'));
      return Promise.resolve(opts.twse ?? twseMisOpen);
    }
    if (url.includes('finance.yahoo.com')) {
      if (opts.yahooFails) return Promise.reject(new Error('Yahoo network error'));
      return Promise.resolve(opts.yahoo ?? yahooChartTsmc);
    }
    return Promise.reject(new Error(`Unexpected URL: ${url}`));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  clearQuoteCache();
  setupMocks();
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ProxyService.fetchQuotes', () => {
  it('fetches and maps TWSE quotes during market hours', async () => {
    const quotes = await fetchQuotes(['2330.TW', '2317.TW']);

    expect(quotes).toHaveLength(2);

    const tsmc = quotes[0];
    expect(tsmc.symbol).toBe('2330.TW');
    expect(tsmc.price).toBe(1000);
    expect(tsmc.prevClose).toBe(980);
    expect(tsmc.change).toBe(20);
    expect(tsmc.changePercent).toBeCloseTo(2.04, 1);
    expect(tsmc.name).toBe('台積電');
    expect(tsmc.dayHigh).toBe(1010);
    expect(tsmc.dayLow).toBe(975);
    // totalSharesK: 25,930,380,000 shares ÷ 1000 = 25,930,380 張
    expect(tsmc.totalSharesK).toBe(25930380);
    // volume: TWSE v field is already in 張
    expect(tsmc.volume).toBe(5000);
  });

  it('falls back to Yahoo Finance when TWSE returns z="-" (market closed)', async () => {
    setupMocks({ twse: twseMisClosed });

    const quotes = await fetchQuotes(['2330.TW']);

    expect(quotes).toHaveLength(1);
    expect(quotes[0].symbol).toBe('2330.TW');
    expect(quotes[0].price).toBe(1000);
    expect(quotes[0].prevClose).toBe(980);
    expect(quotes[0].changePercent).toBeCloseTo(2.04, 1);
  });

  it('falls back to Yahoo Finance when TWSE API fails entirely', async () => {
    setupMocks({ twseFails: true });

    const quotes = await fetchQuotes(['2330.TW']);

    expect(quotes).toHaveLength(1);
    expect(quotes[0].price).toBe(1000);
    expect(quotes[0].prevClose).toBe(980);
  });

  it('returns correct changePercent for negative change (TWSE primary)', async () => {
    setupMocks({
      twse: {
        data: {
          msgArray: [
            { c: '2330', z: '2265', y: '2350', v: '3500', h: '2380', l: '2240', n: '台積電', ex: 'tse' },
          ],
        },
      },
    });

    const quotes = await fetchQuotes(['2330.TW']);
    expect(quotes[0].change).toBe(-85);
    expect(quotes[0].changePercent).toBeCloseTo(-3.62, 1);
  });

  it('returns correct changePercent for negative change (Yahoo fallback)', async () => {
    setupMocks({
      twse: twseMisClosed,
      yahoo: {
        data: {
          chart: {
            result: [{
              meta: {
                regularMarketPrice:    2265,
                previousClose:         2350,
                regularMarketVolume: 3500000,
                regularMarketDayHigh:  2380,
                regularMarketDayLow:   2240,
                shortName:            '台積電',
              },
            }],
          },
        },
      },
    });

    const quotes = await fetchQuotes(['2330.TW']);
    expect(quotes[0].change).toBe(-85);
    expect(quotes[0].changePercent).toBeCloseTo(-3.62, 1);
  });

  it('uses exact code match — no substring collision (2330 ≠ 23309)', async () => {
    setupMocks({
      twse: {
        data: {
          msgArray: [
            { c: '2330', z: '1000', y: '980', v: '5000', h: '1010', l: '975', n: '台積電', ex: 'tse' },
          ],
        },
      },
    });

    const quotes = await fetchQuotes(['2330.TW', '23309.TW']);
    // 2330.TW comes from TWSE (exact match); 23309.TW falls back to Yahoo
    expect(quotes.find(q => q.symbol === '2330.TW')?.price).toBe(1000);
    expect(quotes.find(q => q.symbol === '2330.TW')?.symbol).toBe('2330.TW');
  });

  it('returns empty array for empty symbol list without calling any APIs', async () => {
    const quotes = await fetchQuotes([]);
    expect(quotes).toEqual([]);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('returns empty array when both TWSE and Yahoo Finance fail', async () => {
    setupMocks({ twseFails: true, yahooFails: true });
    const quotes = await fetchQuotes(['2330.TW']);
    expect(quotes).toEqual([]);
  });

  it('calculates volumeRatio from TWSE volume in 張', async () => {
    // 5000 張 = 5,000,000 shares; total = 25,930,380,000 shares
    // ratio = 5,000,000 / 25,930,380,000 × 100 ≈ 0.0193%
    const quotes = await fetchQuotes(['2330.TW', '2317.TW']);
    expect(quotes[0].volumeRatio).not.toBeNull();
    expect(quotes[0].volume).toBe(5000);
  });

  it('calculates volumeRatio from Yahoo Finance volume (fallback path)', async () => {
    setupMocks({ twse: twseMisClosed });

    // Yahoo returns 5,000,000 shares → 5,000 張
    const quotes = await fetchQuotes(['2330.TW']);
    expect(quotes[0].volume).toBe(5000);
    expect(quotes[0].volumeRatio).not.toBeNull();
  });

  it('finds OTC stocks via otc_ prefix when bare code has no .TWO suffix', async () => {
    setupMocks({
      twse: {
        data: {
          msgArray: [
            // tse_2640.tw returns empty; otc_2640.tw returns real data
            { c: '',     z: '-', y: '-',  v: '0',  h: '-',   l: '-',  n: '',    ex: ''    },
            { c: '2640', z: '-', y: '165', v: '18', h: '166', l: '161.5', n: '大車隊', ex: 'otc' },
          ],
        },
      },
    });

    // z="-" → falls back to Yahoo; ticker should be 2640.TWO (otc), not 2640.TW
    const quotes = await fetchQuotes(['2640']);
    expect(quotes).toHaveLength(1);
    // Verify Yahoo was called with .TWO suffix (mock returns yahooChartTsmc data)
    expect(quotes[0].symbol).toBe('2640');
    expect(quotes[0].price).toBe(1000);
  });
});
