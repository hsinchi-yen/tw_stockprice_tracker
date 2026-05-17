import { evaluateAlertStatus } from './AlertEvaluator';
import { describe, it, expect } from 'vitest';

// Helper: call with only the core 4 args (new optional params default to null/0.5)
const eval4 = (price: number, buy: number | null, sell: number | null, pct: number) =>
  evaluateAlertStatus(price, buy, sell, pct);

describe('evaluateAlertStatus — baseline (price targets only)', () => {
  it('normal when price is far from both targets', () => {
    expect(eval4(100, 90, 110, 0.05)).toBe('normal');
  });

  it('nearing-buy when price is within threshold above buy target', () => {
    // buy=100, 5% band → nearing when price ≤ 105
    expect(eval4(104, 100, 200, 0.05)).toBe('nearing-buy');
    expect(eval4(105, 100, 200, 0.05)).toBe('nearing-buy'); // boundary
  });

  it('breached-buy when price is at or below buy target', () => {
    expect(eval4(99,  100, 200, 0.05)).toBe('breached-buy');
    expect(eval4(100, 100, 200, 0.05)).toBe('breached-buy'); // exact match
  });

  it('nearing-sell when price is within threshold below sell target', () => {
    // sell=200, 5% band → nearing when price ≥ 190
    expect(eval4(195, 100, 200, 0.05)).toBe('nearing-sell');
    expect(eval4(190, 100, 200, 0.05)).toBe('nearing-sell'); // boundary
  });

  it('breached-sell when price is at or above sell target', () => {
    expect(eval4(201, 100, 200, 0.05)).toBe('breached-sell');
    expect(eval4(200, 100, 200, 0.05)).toBe('breached-sell'); // exact match
  });

  it('works with null buy target (only sell target set)', () => {
    expect(eval4(205, null, 200, 0.05)).toBe('breached-sell');
    expect(eval4(195, null, 200, 0.05)).toBe('nearing-sell');
    expect(eval4(150, null, 200, 0.05)).toBe('normal');
  });

  it('works with null sell target (only buy target set)', () => {
    expect(eval4(99,  100, null, 0.05)).toBe('breached-buy');
    expect(eval4(104, 100, null, 0.05)).toBe('nearing-buy');
    expect(eval4(120, 100, null, 0.05)).toBe('normal');
  });

  it('returns normal when both targets are null', () => {
    expect(eval4(100, null, null, 0.05)).toBe('normal');
  });
});

describe('evaluateAlertStatus — priority: breach > volume > nearing', () => {
  it('breached-buy takes priority over volume spike', () => {
    // price ≤ buy AND high volumeRatio — breach wins
    expect(evaluateAlertStatus(90, 100, 200, 0.05, 2.0, 0.5)).toBe('breached-buy');
  });

  it('breached-sell takes priority over volume spike', () => {
    expect(evaluateAlertStatus(210, 50, 200, 0.05, 2.0, 0.5)).toBe('breached-sell');
  });

  it('volume-spike is returned when no breach but volumeRatio ≥ threshold', () => {
    expect(evaluateAlertStatus(150, 100, 200, 0.05, 0.5, 0.5)).toBe('volume-spike');
    expect(evaluateAlertStatus(150, 100, 200, 0.05, 1.2, 0.5)).toBe('volume-spike');
  });

  it('volume-spike takes priority over nearing targets', () => {
    // price is in nearing-buy zone AND volume spike — spike wins
    expect(evaluateAlertStatus(104, 100, 200, 0.05, 0.8, 0.5)).toBe('volume-spike');
  });

  it('nearing-buy when volume is below threshold', () => {
    expect(evaluateAlertStatus(104, 100, 200, 0.05, 0.3, 0.5)).toBe('nearing-buy');
  });

  it('nearing-sell when no higher-priority condition fires', () => {
    expect(evaluateAlertStatus(195, 50, 200, 0.05, 0.1, 0.5)).toBe('nearing-sell');
  });

  it('volume-spike ignored when volumeRatio is null', () => {
    expect(evaluateAlertStatus(150, 100, 200, 0.05, null, 0.5)).toBe('normal');
  });
});

describe('evaluateAlertStatus — bug fix: sell not shadowed by buy check', () => {
  it('detects breached-sell even when buy target is also set', () => {
    // Both targets set. Price well above buy, at sell threshold.
    expect(eval4(200, 50, 200, 0.05)).toBe('breached-sell');
  });

  it('detects nearing-sell even when buy target is also set and price is far from buy', () => {
    expect(eval4(192, 50, 200, 0.05)).toBe('nearing-sell');
  });

  it('breached-buy takes priority when price ≤ buy regardless of sell target', () => {
    // Inverted targets (user error), price at buy — breached-buy wins
    expect(eval4(50, 50, 200, 0.05)).toBe('breached-buy');
  });
});

