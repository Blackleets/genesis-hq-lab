// server/genesis/__tests__/protections.test.mjs
// Protection guards: StoplossGuard, MaxDrawdown, LowProfitPairs (+ healthy pass-through).

import { describe, it, expect } from 'vitest';
import { evaluateProtections } from '../protections.mjs';

const H = 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

describe('evaluateProtections', () => {
  it('3 consecutive stop-losses block with reason STOPLOSS', () => {
    const now = Date.now();
    const res = evaluateProtections({
      trades: [
        { pnlUsd: -12, reason: 'SL', closedAt: iso(now - 3 * H) },
        { pnlUsd: -11, reason: 'SL', closedAt: iso(now - 2 * H) },
        { pnlUsd: -13, reason: 'SL', closedAt: iso(now - 0.5 * H) },
      ],
      equityNow: 964,
      initialEquity: 1000,
      pair: 'COTIUSDT',
    });
    expect(res.blocked).toBe(true);
    expect(res.reason).toBe('STOPLOSS');
    expect(res.activeProtections.some(p => p.name === 'StoplossGuard')).toBe(true);
  });

  it('drawdown > 15% blocks with reason MAX_DD', () => {
    const now = Date.now();
    // Two big (non-consecutive-x3) losses well outside the 5-candle window:
    // equity 1000 -> 800 = 20% drawdown > 15% limit.
    const res = evaluateProtections({
      trades: [
        { pnlUsd: -90, reason: 'SL', closedAt: iso(now - 40 * H) },
        { pnlUsd: 5, reason: 'TP', closedAt: iso(now - 39 * H) },
        { pnlUsd: -115, reason: 'SL', closedAt: iso(now - 38 * H) },
      ],
      equityNow: 800,
      initialEquity: 1000,
      pair: 'COTIUSDT',
    });
    expect(res.blocked).toBe(true);
    expect(res.reason).toBe('MAX_DD');
    expect(res.activeProtections.some(p => p.name === 'MaxDrawdown')).toBe(true);
  });

  it('pair with >= 20 trades and profit factor < 0.8 blocks with reason LOW_PF', () => {
    const now = Date.now();
    // 24 alternating wins/losses (never 2 losses in a row), all old enough to
    // stay outside every recency window: gp = 13*30, gl = 11*49.95 -> PF ~ 0.70.
    const trades = [];
    for (let k = 0; k < 24; k++) {
      const win = k % 2 === 0;
      trades.push({
        pnlUsd: win ? 30 : -49.95,
        reason: win ? 'TP' : 'SL',
        closedAt: iso(now - (200 - k) * H),
        pair: 'COTIUSDT',
      });
    }
    const res = evaluateProtections({
      trades,
      equityNow: 1875, // DD vs initial 2000 ~ 6.25%, under the 15% limit
      initialEquity: 2000,
      pair: 'COTIUSDT',
    });
    expect(res.blocked).toBe(true);
    expect(res.reason).toBe('LOW_PF');
    expect(res.activeProtections.some(p => p.name === 'LowProfitPairs')).toBe(true);
  });

  it('healthy trades do not block anything', () => {
    const now = Date.now();
    const res = evaluateProtections({
      trades: [
        { pnlUsd: 40, reason: 'TP', closedAt: iso(now - 10 * H) },
        { pnlUsd: -18, reason: 'SL', closedAt: iso(now - 9 * H) },
        { pnlUsd: 55, reason: 'TP', closedAt: iso(now - 8 * H) },
        { pnlUsd: 32, reason: 'TP', closedAt: iso(now - 7 * H) },
        { pnlUsd: -14, reason: 'SL', closedAt: iso(now - 6 * H) },
        { pnlUsd: 61, reason: 'TP', closedAt: iso(now - 4 * H) },
      ],
      equityNow: 1156,
      initialEquity: 1000,
      pair: 'COTIUSDT',
    });
    expect(res.blocked).toBe(false);
    expect(res.reason).toBeNull();
    expect(res.activeProtections.length).toBe(0);
  });
});
