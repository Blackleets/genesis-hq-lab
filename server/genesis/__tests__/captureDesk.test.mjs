import { describe, it, expect } from 'vitest';
import { harvestScore, rankHarvest } from '../math/harvest.mjs';
import { vpinFromTrades, markoutAsBps, kyleLambda } from '../math/toxicity.mjs';
import {
  scoreTapeAndBook,
  wouldCross,
  rankQuoteable,
  LIVE_OFF,
} from '../captureDesk.mjs';

function noiseTape({ n = 80, mid = 100, tick = 0.01 } = {}) {
  const trades = [];
  let p = mid;
  for (let i = 0; i < n; i++) {
    const side = i % 2 === 0 ? 'buy' : 'sell';
    p = mid + ((i % 4) - 1.5) * tick;
    trades.push({ price: p, amount: 1, side });
  }
  return trades;
}

function toxicSellTape({ n = 80, start = 100 } = {}) {
  const trades = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    p *= 0.998; // informed selling, price walks down
    trades.push({ price: p, amount: 2, side: 'sell' });
  }
  return trades;
}

describe('harvestScore', () => {
  it('quotes when spread covers fee + AS + minEdge', () => {
    const h = harvestScore({
      spreadBps: 8,
      makerFeePct: 0.0002, // 2 bps RT maker
      asBps: 0.2,
      twoSidedProb: 0.5,
      vpin: 0.1,
      minEdgeBps: 0.5,
    });
    // 8*0.5 - 4 - 0.2 = -0.2 → actually may fail. bump spread.
    const h2 = harvestScore({
      spreadBps: 20,
      makerFeePct: 0.0002,
      asBps: 0.2,
      twoSidedProb: 0.5,
      vpin: 0.1,
      minEdgeBps: 0.5,
    });
    expect(h2.quote).toBe(true);
    expect(h2.reason).toBe('HARVEST');
    expect(h2.harvestBps).toBeGreaterThan(0.5);
    expect(h.feeBps).toBeCloseTo(4, 5);
  });

  it('refuses when H is below minEdge', () => {
    const h = harvestScore({
      spreadBps: 2,
      makerFeePct: 0.0002,
      asBps: 1,
      twoSidedProb: 0.35,
      vpin: 0.1,
      minEdgeBps: 0.5,
    });
    expect(h.quote).toBe(false);
    expect(h.reason).toBe('H_LE_EDGE');
  });

  it('halts on high VPIN even with a fat spread', () => {
    const h = harvestScore({
      spreadBps: 50,
      makerFeePct: 0.00005,
      asBps: 0,
      vpin: 0.85,
      minEdgeBps: 0.1,
    });
    expect(h.quote).toBe(false);
    expect(h.reason).toBe('VPIN_HALT');
    expect(h.harvestBps).toBe(Number.NEGATIVE_INFINITY);
  });

  it('widens AS tax in the VPIN grey zone', () => {
    const low = harvestScore({ spreadBps: 20, asBps: 2, vpin: 0.2, twoSidedProb: 1, makerFeePct: 0 });
    const mid = harvestScore({ spreadBps: 20, asBps: 2, vpin: 0.55, twoSidedProb: 1, makerFeePct: 0 });
    expect(mid.widen).toBe(1.5);
    expect(low.widen).toBe(1);
    expect(mid.asBps).toBeGreaterThan(low.asBps);
    expect(mid.harvestBps).toBeLessThan(low.harvestBps);
  });
});

describe('toxicity', () => {
  it('balanced tape has low VPIN; one-sided tape is high', () => {
    const bal = vpinFromTrades(noiseTape({ n: 100 }));
    const tox = vpinFromTrades(toxicSellTape({ n: 100 }));
    expect(bal.vpin).toBeLessThan(0.35);
    expect(tox.vpin).toBeGreaterThan(0.85);
  });

  it('informed sell tape has positive markout AS', () => {
    const { asBps } = markoutAsBps(toxicSellTape({ n: 60 }), 5);
    expect(asBps).toBeGreaterThan(0);
  });

  it('kyle lambda is defined on a walk', () => {
    const { n } = kyleLambda(toxicSellTape({ n: 40 }));
    expect(n).toBeGreaterThan(5);
  });
});

describe('captureDesk', () => {
  it('keeps live off', () => {
    expect(LIVE_OFF).toBe(true);
  });

  it('refuses a dead book', () => {
    const r = scoreTapeAndBook({ bid: 0, ask: 0, trades: [] });
    expect(r.quote).toBe(false);
    expect(r.reason).toBe('DEAD_BOOK');
    expect(r.liveOff).toBe(true);
  });

  it('refuses toxic flow even with a wide book', () => {
    const r = scoreTapeAndBook({
      symbol: 'TOX/USDT',
      bid: 99,
      ask: 101, // ~200 bps — fat but informed
      trades: toxicSellTape({ n: 90, start: 100 }),
      makerFeePct: 0.0002,
      minEdgeBps: 0.5,
    });
    expect(r.quote).toBe(false);
    expect(['VPIN_HALT', 'H_LE_EDGE', 'WOULD_CROSS']).toContain(r.reason);
    expect(r.vpin).toBeGreaterThan(0.5);
  });

  it('can quote a quiet wide book (synthetic noise, fat spread, tiny maker fee)', () => {
    const r = scoreTapeAndBook({
      symbol: 'QUIET/USDT',
      bid: 99.5,
      ask: 100.5, // ~100 bps
      trades: noiseTape({ n: 80, mid: 100, tick: 0.002 }),
      makerFeePct: 0.00005,
      minEdgeBps: 0.5,
    });
    expect(r.reason).not.toBe('DEAD_BOOK');
    expect(r.liveOff).toBe(true);
    // noise + fat spread should harvest; if AS estimate is jumpy, at least not halt
    if (r.reason === 'VPIN_HALT') {
      throw new Error('noise tape should not halt VPIN, got ' + r.vpin);
    }
    expect(r.quote).toBe(true);
    expect(r.harvestBps).toBeGreaterThan(0);
  });

  it('wouldCross detects a take', () => {
    expect(wouldCross({ bid: 101, ask: 102, postBid: true, postAsk: true }, 99, 100)).toBe(true);
    expect(wouldCross({ bid: 99.9, ask: 100.1, postBid: true, postAsk: true }, 99, 101)).toBe(false);
  });

  it('rankQuoteable drops refusals and sorts by H', () => {
    const ranked = rankQuoteable([
      { quote: false, harvestBps: 9 },
      { quote: true, harvestBps: 1.2, symbol: 'A' },
      { quote: true, harvestBps: 4.5, symbol: 'B' },
    ]);
    expect(ranked.map((r) => r.symbol)).toEqual(['B', 'A']);
    expect(rankHarvest([{ harvestBps: 1 }, { harvestBps: 3 }])[0].harvestBps).toBe(3);
  });
});
