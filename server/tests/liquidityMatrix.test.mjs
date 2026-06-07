import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// ── Pure-logic helpers (replicated here to test without hitting Binance) ────────

const WALL_MULTIPLIER = 4;
const THIN_THRESHOLD  = 5;

function computeImbalance(totalBid, totalAsk) {
  const total = totalBid + totalAsk;
  return total === 0 ? 0 : (totalBid - totalAsk) / total;
}

function genesisReading(imbalance, signals, totalBid, totalAsk) {
  if (totalBid + totalAsk < THIN_THRESHOLD)      return 'THIN LIQUIDITY';
  if (signals.sellWall)                          return 'SELL WALL DETECTED';
  if (signals.bidWall && imbalance > 0)          return 'BID WALL DETECTED';
  if (imbalance > 0.30)                          return 'BUY PRESSURE HIGH';
  if (imbalance < -0.30)                         return 'SELL PRESSURE HIGH';
  if (signals.absorptionZone)                    return 'ABSORPTION ZONE';
  if (imbalance > 0.15)                          return 'MOMENTUM BUILDING';
  return 'BALANCED BOOK';
}

function buildSignals(imbalance, bids, asks, midPrice) {
  const maxAsk  = asks.length ? Math.max(...asks.map(a => a.size)) : 0;
  const maxBid  = bids.length ? Math.max(...bids.map(b => b.size)) : 0;
  const avgAsk  = asks.length ? asks.reduce((s, a) => s + a.size, 0) / asks.length : 0;
  const avgBid  = bids.length ? bids.reduce((s, b) => s + b.size, 0) / bids.length : 0;
  const top3Bid = bids.slice(0, 3).reduce((s, b) => s + b.size, 0);
  return {
    buyPressure:      imbalance > 0.20,
    sellPressure:     imbalance < -0.20,
    sellWall:         avgAsk > 0 && maxAsk >= avgAsk * WALL_MULTIPLIER,
    bidWall:          avgBid > 0 && maxBid >= avgBid * WALL_MULTIPLIER,
    thinLiquidity:    (bids.reduce((s, b) => s + b.size, 0) + asks.reduce((s, a) => s + a.size, 0)) < THIN_THRESHOLD,
    absorptionZone:   midPrice > 0 && (top3Bid / midPrice) > 0.003,
    momentumBuilding: imbalance > 0.15 && imbalance <= 0.30,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('computeImbalance', () => {
  it('returns 0 for equal bid and ask', () => {
    assert.equal(computeImbalance(10, 10), 0);
  });
  it('returns positive for bid-heavy book', () => {
    assert.equal(computeImbalance(30, 10), 0.5);
  });
  it('returns negative for ask-heavy book', () => {
    assert.equal(computeImbalance(5, 15), -0.5);
  });
  it('returns 0 when both are zero', () => {
    assert.equal(computeImbalance(0, 0), 0);
  });
});

describe('genesisReading', () => {
  const noSignals = { sellWall: false, bidWall: false, absorptionZone: false };

  it('returns THIN LIQUIDITY for low total size', () => {
    assert.equal(genesisReading(0, noSignals, 2, 2), 'THIN LIQUIDITY');
  });
  it('returns SELL WALL DETECTED when sell wall present', () => {
    assert.equal(genesisReading(-0.1, { ...noSignals, sellWall: true }, 10, 10), 'SELL WALL DETECTED');
  });
  it('returns BID WALL DETECTED when bid wall + positive imbalance', () => {
    assert.equal(genesisReading(0.1, { ...noSignals, bidWall: true }, 10, 10), 'BID WALL DETECTED');
  });
  it('returns BUY PRESSURE HIGH for imbalance > 0.30', () => {
    assert.equal(genesisReading(0.35, noSignals, 20, 8), 'BUY PRESSURE HIGH');
  });
  it('returns SELL PRESSURE HIGH for imbalance < -0.30', () => {
    assert.equal(genesisReading(-0.40, noSignals, 8, 20), 'SELL PRESSURE HIGH');
  });
  it('returns MOMENTUM BUILDING for imbalance 0.15–0.30', () => {
    assert.equal(genesisReading(0.22, noSignals, 15, 10), 'MOMENTUM BUILDING');
  });
  it('returns BALANCED BOOK for neutral imbalance', () => {
    assert.equal(genesisReading(0.05, noSignals, 10, 9), 'BALANCED BOOK');
  });
  it('BID WALL with negative imbalance returns SELL PRESSURE not BID WALL', () => {
    assert.equal(genesisReading(-0.35, { ...noSignals, bidWall: true }, 8, 20), 'SELL PRESSURE HIGH');
  });
});

describe('buildSignals', () => {
  it('detects buyPressure when imbalance > 0.20', () => {
    const s = buildSignals(0.25, [], [], 0);
    assert.equal(s.buyPressure, true);
    assert.equal(s.sellPressure, false);
  });
  it('detects sellPressure when imbalance < -0.20', () => {
    const s = buildSignals(-0.25, [], [], 0);
    assert.equal(s.sellPressure, true);
    assert.equal(s.buyPressure, false);
  });
  it('detects sellWall when max ask >= 4x avg ask', () => {
    const asks = [
      { size: 0.1 }, { size: 0.1 }, { size: 0.1 },
      { size: 0.1 }, { size: 0.1 }, { size: 2.5 },
    ];
    const s = buildSignals(0, [], asks, 0);
    assert.equal(s.sellWall, true);
  });
  it('does not flag sellWall when sizes are uniform', () => {
    const asks = [{ size: 1 }, { size: 1.1 }, { size: 0.9 }, { size: 1.0 }];
    const s = buildSignals(0, [], asks, 0);
    assert.equal(s.sellWall, false);
  });
  it('detects thinLiquidity when total size < 5', () => {
    const bids = [{ size: 1 }, { size: 1 }];
    const asks = [{ size: 1 }, { size: 1 }];
    const s = buildSignals(0, bids, asks, 0);
    assert.equal(s.thinLiquidity, true);
  });
  it('detects momentumBuilding for imbalance 0.15–0.30', () => {
    const s = buildSignals(0.20, [], [], 0);
    assert.equal(s.momentumBuilding, true);
    assert.equal(s.buyPressure, false); // 0.20 is NOT > 0.20
  });
});

describe('getOrderFlowState (exported from liquidityMatrix)', () => {
  it('returns null before any depth fetch', async () => {
    const { getOrderFlowState } = await import('../crypto/liquidityMatrix.mjs');
    const state = getOrderFlowState();
    assert.equal(state, null);
  });
});
