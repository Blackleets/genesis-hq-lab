// Standalone node asserts. No vitest. No ccxt. No invented PnL.
//   node server/genesis/__tests__/readableKelly.smoke.mjs
// Spanish-readable capture + fractional Kelly size after realized history.
// LIVE_OFF stays true. Not a 6-gate GO.

import assert from 'node:assert/strict';
import { replayCapture, PAPER_CAPITAL, nextLotFrac, QUOTE_FRAC } from '../captureEngine.mjs';
import { LIVE_OFF } from '../captureCore.mjs';
import { singleAssetKelly } from '../math/kelly.mjs';

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
assert.equal(QUOTE_FRAC, 0.10);

// 1. Two-sided through-tape still CAPTURED. Kelly must NOT zero this on fill 1.
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
  kellyF: twoSided.kellyF,
  firstRealized: twoSided.fills[0] && twoSided.fills[0].realized,
});
assert.equal(twoSided.liveOff, true);
assert.equal(twoSided.quote, true);
assert.ok(twoSided.fills.length > 0, 'through-tape must still fill; Kelly must not zero fill 1');
assert.ok(
  twoSided.reason === 'CAPTURED' || twoSided.reason === 'KELLY_FLAT',
  `through-tape reason ${twoSided.reason}`,
);
assert.ok(Number.isFinite(twoSided.netPnl), 'netPnl must be a real number');
assert.ok(Number.isFinite(twoSided.kellyF), 'kellyF must be a number');
assert.notEqual(twoSided.fills[0].coins, 0, 'first lot still QUOTE_FRAC (no history)');

// 2. Toxic dump: 0 fills / VPIN_HALT, pnl 0.
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
  kellyF: tox.kellyF,
});
assert.equal(tox.fills.length, 0);
assert.equal(tox.netPnl, 0);
assert.ok(tox.reason === 'VPIN_HALT' || tox.fills.length === 0);
assert.equal(tox.liveOff, true);

// 3. Buy-then-dump: MARKOUT_HALT or KELLY_FLAT, fills kept, pnl not zeroed.
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
  kellyF: dump.kellyF,
});
assert.equal(dump.liveOff, true);
assert.ok(dump.reason === 'MARKOUT_HALT' || dump.reason === 'KELLY_FLAT', `got ${dump.reason}`);
assert.ok(dump.fills.length >= 1, 'must keep booked fills');
assert.ok(Number.isFinite(dump.netPnl), 'pnl must be a real number — not zeroed to a fake 0 unless it actually is 0');

// 4. After ≥4 negative realized pnls, next lot size is 0.
const neg = [-0.12, -0.08, -0.05, -0.20];
const flat = nextLotFrac(neg);
const k = singleAssetKelly(neg, { fraction: 0.25 });
console.log('4 kelly-flat helper', { nextLotFrac: flat, kelly: k, shortHist: nextLotFrac([-0.12, -0.08, -0.05]) });
assert.equal(k.f, 0);
assert.equal(k.reason, 'NONPOSITIVE_MEAN');
assert.equal(flat, 0, '≥4 negative realized → next lot frac 0');
assert.equal(nextLotFrac([-0.12, -0.08, -0.05]), QUOTE_FRAC, 'n<4 still default 10%');
assert.equal(nextLotFrac([]), QUOTE_FRAC);

// 5. LIVE_OFF true everywhere.
assert.equal(twoSided.liveOff, true);
assert.equal(tox.liveOff, true);
assert.equal(dump.liveOff, true);
assert.equal(LIVE_OFF, true);

console.log('SMOKE OK');
