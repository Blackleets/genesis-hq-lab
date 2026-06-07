import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const {
  buildSignalBreakdown, copilotConfidence, winProb, expectedValue, simulate, assertTradeAllowed,
} = await import('../crypto/copilot.mjs');

const PARAMS = {
  targetPct: 0.015, stopPct: 0.0075, emaMarginPct: 0.001, momentumPct: 0.2,
  rsiLongMin: 45, rsiLongMax: 68, rsiShortMin: 32, rsiShortMax: 55,
  minVolume24h: 1_000_000, useHtfFilter: 0, htfMinutes: 15,
};

// A clean bullish context that satisfies LONG confluence.
const BULL_CTX = {
  price: 100, ema9: 100.5, ema21: 100, rsi14: 55, change1h: 0.5, volume24h: 5_000_000, closes: [],
};
// A flat context that satisfies nothing.
const FLAT_CTX = {
  price: 100, ema9: 100, ema21: 100, rsi14: 50, change1h: 0.0, volume24h: 500_000, closes: [],
};

describe('buildSignalBreakdown', () => {
  it('LONG on a bullish ctx yields mostly positive signals', () => {
    const b = buildSignalBreakdown(BULL_CTX, 'LONG', PARAMS);
    assert.ok(b.positive.length >= 4, `expected ≥4 positive, got ${b.positive.length}`);
    assert.equal(b.negative.length, 0);
  });
  it('LONG on a flat ctx yields negative signals', () => {
    const b = buildSignalBreakdown(FLAT_CTX, 'LONG', PARAMS);
    assert.ok(b.negative.length >= 3, `expected ≥3 negative, got ${b.negative.length}`);
  });
  it('SHORT on a bullish ctx flags trend + momentum against it', () => {
    const b = buildSignalBreakdown(BULL_CTX, 'SHORT', PARAMS);
    // EMA trend is bullish and 1h momentum is up — both oppose a SHORT.
    assert.ok(b.negative.length >= 2, `expected ≥2 negative, got ${b.negative.length}`);
    assert.ok(b.negative.some(n => n.includes('EMA')));
    assert.ok(b.negative.some(n => n.toLowerCase().includes('momentum')));
  });
});

describe('copilotConfidence', () => {
  it('engine-endorsed side scores 60–100', () => {
    const engine = { action: 'TRADE', side: 'LONG', score: 0.5 };
    const b = buildSignalBreakdown(BULL_CTX, 'LONG', PARAMS);
    const c = copilotConfidence(engine, 'LONG', b);
    assert.ok(c >= 60 && c <= 100, `got ${c}`);
  });
  it('non-endorsed side scores 0–50', () => {
    const engine = { action: 'SKIP', side: null, score: 0 };
    const b = buildSignalBreakdown(FLAT_CTX, 'LONG', PARAMS);
    const c = copilotConfidence(engine, 'LONG', b);
    assert.ok(c >= 0 && c <= 50, `got ${c}`);
  });
});

describe('winProb', () => {
  it('is bounded to [5, 92]%', () => {
    assert.ok(winProb(100, 1) <= 0.92);
    assert.ok(winProb(0, 0) >= 0.05);
  });
  it('blends confidence with recent win rate', () => {
    const p = winProb(80, 0.5);  // 0.7*0.8 + 0.3*0.5 = 0.71
    assert.ok(Math.abs(p - 0.71) < 0.001, `got ${p}`);
  });
});

describe('expectedValue', () => {
  it('is positive when pWin high enough', () => {
    const { evPct } = expectedValue(0.6, 0.015, 0.0075);
    assert.ok(evPct > 0, `got ${evPct}`);
  });
  it('is negative when pWin too low', () => {
    const { evPct } = expectedValue(0.2, 0.015, 0.0075);
    assert.ok(evPct < 0, `got ${evPct}`);
  });
});

describe('simulate', () => {
  it('probabilities sum to ~1', () => {
    const s = simulate(0.6, 0.3);
    const sum = s.pTP + s.pSL + s.pTimeout;
    assert.ok(Math.abs(sum - 1) < 0.01, `sum=${sum}`);
  });
  it('higher win prob raises pTP above pSL', () => {
    const s = simulate(0.7, 0.3);
    assert.ok(s.pTP > s.pSL);
  });
  it('flat market raises timeout probability', () => {
    const flat   = simulate(0.6, 0.0);
    const moving = simulate(0.6, 1.0);
    assert.ok(flat.pTimeout > moving.pTimeout);
  });
});

describe('assertTradeAllowed', () => {
  it('returns a {blocked, reasons} shape', () => {
    const r = assertTradeAllowed({ pair: 'BTCUSDT' });
    assert.ok(typeof r.blocked === 'boolean');
    assert.ok(Array.isArray(r.reasons));
  });
});
