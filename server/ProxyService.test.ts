import { fetchQuotes } from './ProxyService';
import axios from 'axios';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock axios (used by loadTotalShares for TWSE OpenAPI)
vi.mock('axios');
const mockedAxios = vi.mocked(axios);

// vi.mock is hoisted, so use vi.hoisted() to initialise mockQuote before the factory runs
const mockQuote = vi.hoisted(() => vi.fn());
vi.mock('yahoo-finance2', () => ({
  default: class YahooFinance {
    quote = mockQuote;
  },
}));

// ── Shared fixtures ────────────────────────────────────────────────────────────

const sharesResponse = {
  data: [
    { '公司代號': '2330', '已發行普通股數或TDR原股發行股數': '25930380000' },
    { '公司代號': '2317', '已發行普通股數或TDR原股發行股數': '13862640000' },
  ],
};

// Yahoo Finance volumes are in shares; 5,000,000 shares = 5,000 張
const yahooQuotes = [
  {
    symbol: '2330.TW',
    shortName: '台積電',
    regularMarketPrice:         1000,
    regularMarketPreviousClose:  980,
    regularMarketVolume:     5000000,
    regularMarketDayHigh:       1010,
    regularMarketDayLow:         975,
  },
  {
    symbol: '2317.TW',
    shortName: '鴻海',
    regularMarketPrice:          200,
    regularMarketPreviousClose:  195,
    regularMarketVolume:     3000000,
    regularMarketDayHigh:        205,
    regularMarketDayLow:         190,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockedAxios.get.mockResolvedValue(sharesResponse);
  mockQuote.mockResolvedValue(yahooQuotes);
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ProxyService.fetchQuotes', () => {
  it('fetches and maps quotes including dayHigh/dayLow', async () => {
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
  });

  it('returns correct changePercent outside market hours (no z="-" fallback issue)', async () => {
    mockQuote.mockResolvedValue([{
      symbol: '2330.TW',
      shortName: '台積電',
      regularMarketPrice:         2265,
      regularMarketPreviousClose: 2350,
      regularMarketVolume:        3500000,
      regularMarketDayHigh:       2380,
      regularMarketDayLow:        2240,
    }]);

    const quotes = await fetchQuotes(['2330.TW']);
    expect(quotes[0].change).toBe(-85);
    expect(quotes[0].changePercent).toBeCloseTo(-3.62, 1);
  });

  it('uses exact code match — no substring collision (2330 ≠ 23309)', async () => {
    mockQuote.mockResolvedValue([{
      symbol: '2330.TW',
      shortName: '台積電',
      regularMarketPrice:         1000,
      regularMarketPreviousClose:  980,
      regularMarketVolume:        5000000,
      regularMarketDayHigh:       1010,
      regularMarketDayLow:         975,
    }]);

    const quotes = await fetchQuotes(['2330.TW', '23309.TW']);
    expect(quotes[0].symbol).toBe('2330.TW');
  });

  it('returns empty array for empty symbol list without calling Yahoo Finance', async () => {
    const quotes = await fetchQuotes([]);
    expect(quotes).toEqual([]);
    expect(mockQuote).not.toHaveBeenCalled();
  });

  it('returns empty array when Yahoo Finance call fails', async () => {
    mockQuote.mockRejectedValue(new Error('network error'));
    const quotes = await fetchQuotes(['2330.TW']);
    expect(quotes).toEqual([]);
  });

  it('calculates volumeRatio from Yahoo Finance shares volume', async () => {
    // 5,000,000 shares ÷ 25,930,380,000 total shares × 100 = 0.0193%
    const quotes = await fetchQuotes(['2330.TW', '2317.TW']);
    expect(quotes[0].volumeRatio).not.toBeNull();
    expect(quotes[0].volume).toBe(5000); // 5,000,000 shares ÷ 1000 = 5,000 張
  });
});
