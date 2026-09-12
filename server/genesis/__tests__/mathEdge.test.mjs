// server/genesis/__tests__/mathEdge.test.mjs
// Paper-safe math overlay. No network. Synthetic Gaussian vs fat tails.

import { describe, it, expect } from 'vitest';
import { createKalman, fairValue } from '../math/kalman.mjs';
import { barPressure, microprice } from '../math/ofi.mjs';
import { glftQuotes } from '../math/glft.mjs';
import { extraNoGos, applyExtraNoGos } from '../math/extraNoGos.mjs';
import { jarqueBera, mean } from '../math/stats.mjs';
import { singleAssetKelly } from '../math/kelly.mjs';
import { ledoitWolf } from '../math/cov.mjs';
import { simulateMarketMaker } from '../marketMaker.mjs';
import { evaluateGates } from '../backtestCore.mjs';

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng) {
  const u = Math.max(1e-12, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

describe('kalman', () => {
  it('converges on a constant mid', () => {
    const k = createKalman({ q: 1e-8, r: 1e-3, x0: 100 });
    let x = 100;
    for (let i = 0; i < 40; i++) x = k.update(100);
    expect(x).toBeCloseTo(100, 6);
  });
  it('fairValue stays finite with imbalance clamp', () => {
    const k = createKalman();
    const fv = fairValue(k, 50, 99, 0.01);
    expect(Number.isFinite(fv)).toBe(true);
  });
});

describe('ofi', () => {
  it('microprice leans toward the larger size', () => {
    const mp = microprice({ bid: 100, ask: 101, bidSz: 10, askSz: 1 });
    expect(mp).toBeGreaterThan(100.5);
  });
  it('barPressure is +1 on a close at the high', () => {
    expect(barPressure(10, 12, 9, 12)).toBeCloseTo(1, 9);
  });
});

describe('glft', () => {
  it('long inventory pushes the bid further and the ask closer', () => {
    const flat = glftQuotes({ fair: 100, sigma: 0.01, q: 0 });
    const long = glftQuotes({ fair: 100, sigma: 0.01, q: 0.8 });
    expect(long.bid).toBeLessThan(flat.bid);
    expect(long.ask).toBeLessThan(flat.ask);
    expect(long.spread).toBeGreaterThan(0);
  });
  it('quotes one side only at inventory cap', () => {
    const q = glftQuotes({ fair: 100, sigma: 0.01, q: 1, qMax: 1 });
    expect(q.postBid).toBe(false);
    expect(q.postAsk).toBe(true);
  });
  it('spread is at least the maker-fee floor', () => {
    const q = glftQuotes({ fair: 100, sigma: 0, q: 0, makerFee: 0.0002, minEdgeBps: 0 });
    expect(q.spreadBps).toBeGreaterThanOrEqual(3.9);
  });
});

describe('kelly', () => {
  it('size is 0 when mean <= 0', () => {
    const r = singleAssetKelly([-0.01, -0.02, 0, -0.005]);
    expect(r.f).toBe(0);
    expect(r.reason).toBe('NONPOSITIVE_MEAN');
  });
  it('caps below 0.25 of capital', () => {
    const rng = mulberry32(7);
    const pnls = Array.from({ length: 80 }, () => 0.02 + 0.001 * gaussian(rng));
    const r = singleAssetKelly(pnls, { fraction: 0.5 });
    expect(r.f).toBeLessThanOrEqual(0.25);
    expect(r.f).toBeGreaterThan(0);
  });
});

describe('cov', () => {
  it('Ledoit-Wolf stays SPD-shaped (positive diagonal)', () => {
    const rng = mulberry32(3);
    const rows = Array.from({ length: 30 }, () => [gaussian(rng), gaussian(rng)]);
    const S = ledoitWolf(rows);
    expect(S[0][0]).toBeGreaterThan(0);
    expect(S[1][1]).toBeGreaterThan(0);
  });
});

describe('extra NO-GOs', () => {
  it('Jarque-Bera is diagnostic only (not in extra gates)', () => {
    const rng = mulberry32(1);
    const xs = Array.from({ length: 80 }, () => gaussian(rng));
    const jb = jarqueBera(xs);
    expect(jb.diagnostic).toBe(true);
    const extra = extraNoGos(xs.map(pnl => ({ pnl })));
    expect(extra.gates.some(g => /Jarque/i.test(g.name))).toBe(false);
  });

  it('iid Gaussian with positive mean can pass extra NO-GOs', () => {
    const rng = mulberry32(11);
    const pnls = Array.from({ length: 80 }, () => 0.01 + 0.004 * gaussian(rng));
    const extra = extraNoGos(pnls);
    expect(extra.skipped).toBeUndefined();
    expect(extra.kill).toBe(false);
    expect(mean(pnls)).toBeGreaterThan(0);
  });

  it('fat left tail fails CVaR even if the mean is positive', () => {
    const rng = mulberry32(99);
    const pnls = Array.from({ length: 80 }, (_, i) => (i < 6 ? -0.40 : 0.02 + 0.002 * gaussian(rng)));
    const extra = extraNoGos(pnls);
    expect(extra.kill).toBe(true);
    const cvarGate = extra.gates.find(g => /CVaR/.test(g.name));
    expect(cvarGate.pass).toBe(false);
  });

  it('never flips a 6-gate fail into a pass', () => {
    const rng = mulberry32(5);
    const pnls = Array.from({ length: 80 }, () => 0.01 + 0.003 * gaussian(rng));
    const fail = evaluateGates({
      trades: 80,
      winRate: 0.20,
      profitFactor: 0.5,
      expectancyPctPerTrade: -0.1,
      tstat: 0.1,
      maxDrawdown: 0.5,
    });
    expect(fail.go).toBe(false);
    const merged = applyExtraNoGos(fail, pnls);
    expect(merged.go).toBe(false);
  });

  it('skips extra gates when n < 50', () => {
    const extra = extraNoGos([0.1, 0.1, 0.1]);
    expect(extra.skipped).toBe('n<50');
    expect(extra.kill).toBe(false);
  });
});

describe('simulateMarketMaker API', () => {
  it('keeps default capital 1000 and the same return shape', () => {
    const candles = [];
    let px = 100;
    for (let i = 0; i < 120; i++) {
      const o = px;
      const h = px * 1.004;
      const l = px * 0.996;
      const c = px * (i % 2 === 0 ? 1.001 : 0.999);
      candles.push([i * 60_000, o, h, l, c, 10]);
      px = c;
    }
    const r = simulateMarketMaker(candles);
    expect(r.initialCapital).toBe(1000);
    expect(Array.isArray(r.trades)).toBe(true);
    expect(r.equityCurve.length).toBe(candles.length);
    expect(Number.isFinite(r.finalCapital)).toBe(true);
  });

  it('does not invent fills on a one-tick flat tape', () => {
    const candles = Array.from({ length: 40 }, (_, i) => [i, 100, 100, 100, 100, 1]);
    const r = simulateMarketMaker(candles, 1000, 2);
    expect(r.trades.length).toBe(0);
    expect(r.finalCapital).toBeCloseTo(1000, 8);
  });
});
