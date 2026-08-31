// Standalone node asserts. No vitest. No ccxt. No invented PnL.
//   node server/genesis/__tests__/kalmanFair.smoke.mjs
// Capture fair = Kalman(microprice)+OFI/tape imbalance. Last-print center is gone.

import assert from 'node:assert/strict';
import { replayCapture, PAPER_CAPITAL } from '../captureEngine.mjs';
import { LIVE_OFF, scoreTapeAndBook } from '../captureCore.mjs';

function quietTape(n = 40, amount = 0.1) {
  const trades = [];
  for (let i = 0; i < n; i++) {
    const side = i % 2 === 0 ? 'buy' : 'sell';
    const p = 100 + ((i % 4) - 1.5) * 0.002;
    trades.push({ price: p, amount, side });
  }
  return trades;
}

function throughTape() {
  // Two-sided through-tape (interleaved so it mean-reverts immediately).
  const trades = quietTape(40, 0.1);
  for (let i = 0; i < 20; i++) {
    trades.push({ price: 99.2, amount: 2, side: 'sell' });
    trades.push({ price: 100.8, amount: 2, side: 'buy' });
  }
  return trades;
}

function toxicSellTape(n = 80, start = 100) {
  const trades = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    p *= 0.998;
    trades.push({ price: p, amount: 2, side: 'sell' });
  }
  return trades;
}

function buyThenDumpTape() {
  const trades = quietTape(40, 0.1);
  trades.push({ price: 99.2, amount: 2, side: 'sell' });
  for (let i = 0; i < 8; i++) {
    trades.push({ price: 98.0 - i * 0.05, amount: 2, side: 'sell' });
  }
  return trades;
}

console.log('LIVE_OFF', LIVE_OFF);
assert.equal(LIVE_OFF, true);
assert.equal(PAPER_CAPITAL, 10000);

// 1. Two-sided through-tape still produces fills (last-in-queue vs PREVIOUS Kalman fair).
const twoSided = replayCapture({
  symbol: 'MAKE/USDT',
  bid: 99.5,
  ask: 100.5,
  trades: throughTape(),
  makerFeePct: 0.0002,
  minEdgeBps: 0.5,
  capital: PAPER_CAPITAL,
});
console.log('1 through-tape', {
  reason: twoSided.reason,
  fills: twoSided.fills.length,
  netPnl: twoSided.netPnl,
  liveOff: twoSided.liveOff,
  quote: twoSided.quote,
  fair: twoSided.fair,
});
assert.equal(twoSided.liveOff, true);
assert.equal(twoSided.quote, true);
assert.ok(twoSided.fills.length > 0, 'through-tape must still fill (Kalman must not chase the print)');
assert.notEqual(twoSided.reason, 'MARKOUT_HALT');

// 2. Toxic dump (80 sells) still VPIN_HALT or 0 fills, pnl 0.
const tox = replayCapture({
  symbol: 'TOX/USDT',
  bid: 99,
  ask: 101,
  trades: toxicSellTape(80, 100),
  makerFeePct: 0.0002,
  minEdgeBps: 0.5,
});
console.log('2 toxic dump', {
  reason: tox.reason,
  fills: tox.fills.length,
  netPnl: tox.netPnl,
  quote: tox.quote,
  liveOff: tox.liveOff,
});
assert.equal(tox.fills.length, 0);
assert.equal(tox.netPnl, 0);
assert.ok(tox.reason === 'VPIN_HALT' || tox.fills.length === 0);
assert.equal(tox.liveOff, true);

// 3. Buy fill then 8 lower prints → MARKOUT_HALT (parent behavior preserved).
const dump = replayCapture({
  symbol: 'DUMP/USDT',
  bid: 99.5,
  ask: 100.5,
  trades: buyThenDumpTape(),
  makerFeePct: 0.0002,
  minEdgeBps: 0.5,
});
console.log('3 buy-then-dump', {
  reason: dump.reason,
  fills: dump.fills.length,
  netPnl: dump.netPnl,
  liveOff: dump.liveOff,
  quote: dump.quote,
});
assert.equal(dump.liveOff, true);
assert.equal(dump.reason, 'MARKOUT_HALT');
assert.ok(dump.fills.length >= 1, 'must have booked the fill before halt');
assert.ok(Number.isFinite(dump.netPnl), 'pnl must be a real number');

// 4. After a noisy two-sided tape, session fair is NOT the last raw print.
const lastPrint = 100.8;
assert.ok(Number.isFinite(twoSided.fair), 'session must return Kalman fair');
assert.notEqual(twoSided.fair, lastPrint, 'Kalman fair must not be last-print center');
assert.equal(twoSided.liveOff, true);

// 5. Microprice geometry on scoreTapeAndBook (pure book sizes, no invented edge).
const quiet = quietTape(20, 0.1);
const askHeavy = scoreTapeAndBook({
  symbol: 'GEO/USDT',
  bid: 99.5,
  ask: 100.5,
  bidSz: 10,
  askSz: 1,
  trades: quiet,
  makerFeePct: 0.0002,
});
const bidHeavy = scoreTapeAndBook({
  symbol: 'GEO/USDT',
  bid: 99.5,
  ask: 100.5,
  bidSz: 1,
  askSz: 10,
  trades: quiet,
  makerFeePct: 0.0002,
});
const mid = 100;
console.log('5 microprice geometry', {
  askHeavy: { microprice: askHeavy.microprice, fair: askHeavy.fair, imbalance: askHeavy.imbalance, liveOff: askHeavy.liveOff },
  bidHeavy: { microprice: bidHeavy.microprice, fair: bidHeavy.fair, imbalance: bidHeavy.imbalance, liveOff: bidHeavy.liveOff },
});
assert.ok(askHeavy.microprice > mid, 'bidSz=10 askSz=1 → microprice closer to ask than mid');
assert.ok(bidHeavy.microprice < mid, 'bidSz=1 askSz=10 → microprice closer to bid than mid');
assert.ok(Math.abs(askHeavy.microprice - 100.5) < Math.abs(askHeavy.microprice - mid));
assert.ok(Math.abs(bidHeavy.microprice - 99.5) < Math.abs(bidHeavy.microprice - mid));
assert.equal(askHeavy.liveOff, true);
assert.equal(bidHeavy.liveOff, true);

console.log('SMOKE OK');
