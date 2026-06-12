import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePolymarketMarket, normalizeKalshiMarket, validateSnapshot } from '../predictionMarkets/normalizer.mjs';

describe('normalizePolymarketMarket', () => {
  test('normalizes a full polymarket market object', () => {
    const raw = {
      id: 'pm-1',
      slug: 'will-x-win',
      question: 'Will X win?',
      endDate: '2024-12-31',
      active: true,
      closed: false,
      liquidity: 50000,
      volume24hr: 12000,
      spread: '0.04',
      outcomes: [{ label: 'Yes', price: '0.65' }, { label: 'No', price: '0.35' }],
    };
    const snap = normalizePolymarketMarket(raw, 'politics');

    assert.equal(snap.source, 'polymarket');
    assert.equal(snap.marketId, 'pm-1');
    assert.equal(snap.title, 'Will X win?');
    assert.equal(snap.category, 'politics');
    assert.equal(snap.status, 'active');
    assert.ok(snap.yesPrice >= 0 && snap.yesPrice <= 1, 'yesPrice in range');
    assert.ok(snap.noPrice >= 0 && snap.noPrice <= 1, 'noPrice in range');
    assert.ok(snap.spread != null, 'spread computed');
    assert.equal(snap.liquidity, 50000);
    assert.equal(snap.volume24h, 12000);
  });

  test('handles missing optional fields gracefully', () => {
    const raw = { id: 'pm-2', question: 'Minimal market?' };
    const snap = normalizePolymarketMarket(raw);
    assert.equal(snap.source, 'polymarket');
    assert.equal(snap.marketId, 'pm-2');
    assert.equal(snap.status, 'unknown');
    assert.equal(snap.yesPrice, null);
    assert.equal(snap.volume24h, null);
  });

  test('clamps prices to [0, 1]', () => {
    const raw = {
      id: 'pm-3',
      question: 'Clamp test',
      outcomes: [{ label: 'Yes', price: '1.5' }, { label: 'No', price: '-0.1' }],
    };
    const snap = normalizePolymarketMarket(raw);
    assert.ok(snap.yesPrice != null && snap.yesPrice <= 1);
    assert.ok(snap.noPrice != null && snap.noPrice >= 0);
  });
});

describe('normalizeKalshiMarket', () => {
  test('normalizes a kalshi market_update event', () => {
    const raw = {
      marketId: 'KFED-23NOV22-T4.50',
      ticker: 'KFED-23NOV22-T4.50',
      yesPrice: 0.72,
      noPrice: 0.28,
      volume24h: 5000,
      liquidity: 25000,
      daysToClose: 14,
      marketCategory: 'economics',
    };
    const snap = normalizeKalshiMarket(raw);

    assert.equal(snap.source, 'kalshi');
    assert.equal(snap.marketId, 'KFED-23NOV22-T4.50');
    assert.equal(snap.category, 'economics');
    assert.ok(snap.yesPrice != null);
    assert.ok(snap.noPrice != null);
    assert.ok(snap.endDate != null, 'endDate computed from daysToClose');
  });

  test('derives noPrice from yesPrice if missing', () => {
    const raw = { marketId: 'K1', ticker: 'K1', yesPrice: 0.6 };
    const snap = normalizeKalshiMarket(raw);
    assert.ok(Math.abs((snap.noPrice ?? 0) - 0.4) < 0.001, 'noPrice = 1 - yesPrice');
  });
});

describe('validateSnapshot', () => {
  test('passes valid snapshot', () => {
    const snap = {
      source: 'polymarket',
      marketId: 'abc',
      title: 'Test market',
      slug: '',
      outcome: 'YES',
      yesPrice: 0.5,
      noPrice: 0.5,
      spread: 0,
      volume24h: null,
      liquidity: null,
      endDate: null,
      status: 'active',
      category: 'general',
      updatedAt: new Date().toISOString(),
    };
    const result = validateSnapshot(snap);
    assert.equal(result.ok, true);
    assert.equal(result.errors.length, 0);
  });

  test('fails snapshot missing required fields', () => {
    const result = validateSnapshot({ title: 'Only title' });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('source')));
    assert.ok(result.errors.some((e) => e.includes('marketId')));
  });
});
