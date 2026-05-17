import { fetchQuotes } from './ProxyService';
import axios from 'axios';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);

// OpenAPI t187ap03_L format: array of objects
const sharesResponse = {
  data: [
    { '公司代號': '2330', '已發行普通股數或TDR原股發行股數': '25930380000' },
    { '公司代號': '2317', '已發行普通股數或TDR原股發行股數': '13862640000' },
  ]
};

const quoteResponse = {
  data: {
    msgArray: [
      { c: '2330', n: '台積電', z: '1000', y: '980', v: '5000', h: '1010', l: '975' },
      { c: '2317', n: '鴻海',   z: '200',  y: '195', v: '3000', h: '205',  l: '190' },
    ]
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  // Route by URL so tests are independent of the module-level shares cache state.
  mockedAxios.get.mockImplementation((url: string) => {
    if (typeof url === 'string' && url.includes('t187ap03_L'))
      return Promise.resolve(sharesResponse);
    return Promise.resolve(quoteResponse);
  });
});

describe('ProxyService.fetchQuotes', () => {
  it('fetches and maps quotes including dayHigh/dayLow (S3)', async () => {
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
    expect(tsmc.volumeRatio).not.toBeNull();
    // totalSharesK: 25,930,380,000 shares ÷ 1000 = 25,930,380 張
    expect(tsmc.totalSharesK).toBe(25930380);
  });

  it('uses exact code match — no substring collision (2330 ≠ 23309)', async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url.includes('MI_QFIIS')) return Promise.resolve({ data: { data: [] } });
      return Promise.resolve({
        data: { msgArray: [{ c: '2330', n: '台積電', z: '1000', y: '980', v: '5000', h: '1010', l: '975' }] }
      });
    });

    const quotes = await fetchQuotes(['2330.TW', '23309.TW']);
    expect(quotes[0].symbol).toBe('2330.TW');  // exact match, not '23309.TW'
  });

  it('returns empty array for empty symbol list without calling API', async () => {
    const quotes = await fetchQuotes([]);
    expect(quotes).toEqual([]);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('returns empty array when TWSE quote call fails', async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url.includes('MI_QFIIS')) return Promise.resolve({ data: { data: [] } });
      return Promise.reject(new Error('network error'));
    });

    const quotes = await fetchQuotes(['2330.TW']);
    expect(quotes).toEqual([]);
  });

  it('falls back to prevClose when last trade price is dash (market closed)', async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url.includes('MI_QFIIS')) return Promise.resolve({ data: { data: [] } });
      return Promise.resolve({
        data: { msgArray: [{ c: '2330', n: '台積電', z: '-', y: '980', v: '0', h: '980', l: '980' }] }
      });
    });

    const quotes = await fetchQuotes(['2330.TW']);
    expect(quotes[0].price).toBe(980);
  });

  it('builds query URL with tse_ and otc_ prefixes for each symbol', async () => {
    await fetchQuotes(['2330.TW', '2317.TW']);

    const calls = mockedAxios.get.mock.calls.map(c => c[0] as string);
    const quoteUrl = calls.find(u => u.includes('getStockInfo'))!;
    expect(quoteUrl).toContain('tse_2330.tw|otc_2330.tw');
    expect(quoteUrl).toContain('tse_2317.tw|otc_2317.tw');
  });
});
