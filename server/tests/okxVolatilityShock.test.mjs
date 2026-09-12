import test from 'node:test';
import assert from 'node:assert/strict';
import { completedCandles, deriveVolatilityShockFeatures, okxInstrumentIds } from '../genesis/okxResearchContext.mjs';

function rawCandle({ time, open, high, low, close, volume = 100, confirm = '1' }) {
  return [String(time), String(open), String(high), String(low), String(close), '1', '1', String(volume), confirm];
}

function bar(time, close, { rangePct = 0.001, volume = 100 } = {}) {
  return {
    time,
    open: close,
    high: close * (1 + rangePct / 2),
    low: close * (1 - rangePct / 2),
    close,
    volumeQuote: volume,
  };
}

test('maps the verified research universe to matching OKX spot and perpetual instruments', () => {
  assert.deepEqual(okxInstrumentIds('BTCUSDT'), { spot: 'BTC-USDT', perp: 'BTC-USDT-SWAP', ccy: 'BTC' });
  assert.deepEqual(okxInstrumentIds('ETHUSDT'), { spot: 'ETH-USDT', perp: 'ETH-USDT-SWAP', ccy: 'ETH' });
  assert.deepEqual(okxInstrumentIds('SOLUSDT'), { spot: 'SOL-USDT', perp: 'SOL-USDT-SWAP', ccy: 'SOL' });
  assert.deepEqual(okxInstrumentIds('XRPUSDT'), { spot: 'XRP-USDT', perp: 'XRP-USDT-SWAP', ccy: 'XRP' });
  assert.deepEqual(okxInstrumentIds('BNBUSDT'), { spot: 'BNB-USDT', perp: 'BNB-USDT-SWAP', ccy: 'BNB' });
  assert.throws(() => okxInstrumentIds('DOGEUSDT'), /Unsupported OKX research symbol/);
  assert.throws(() => okxInstrumentIds('BTCUSD'), /Unsupported OKX research symbol/);
});

test('completedCandles excludes the current unconfirmed OKX candle', () => {
  const rows = [
    rawCandle({ time: 1_000, open: 100, high: 101, low: 99, close: 100.5, confirm: '1' }),
    rawCandle({ time: 2_000, open: 100.5, high: 150, low: 80, close: 140, volume: 10_000, confirm: '0' }),
  ];
  const completed = completedCandles(rows);
  assert.equal(completed.length, 1);
  assert.equal(completed[0].time, 1_000);
  assert.equal(completed[0].close, 100.5);
});

test('deriveVolatilityShockFeatures detects a completed range/volume shock without using future data', () => {
  const rows = [];
  let price = 100;
  for (let i = 0; i < 30; i += 1) {
    price *= i % 2 === 0 ? 1.0003 : 0.9998;
    rows.push(bar(i * 60_000, price, { rangePct: 0.001, volume: 100 }));
  }
  const shockClose = price * 1.006;
  rows.push(bar(30 * 60_000, shockClose, { rangePct: 0.006, volume: 400 }));
  const result = deriveVolatilityShockFeatures(rows);
  assert.equal(result.volatilityBarCount, 31);
  assert.equal(result.volatilityState, 'shock');
  assert.ok(result.rangeShockRatio >= 2);
  assert.ok(result.volumeShockRatio >= 2.5);
  assert.ok(result.maxAbsReturnBpsShort > 50);
});

test('deriveVolatilityShockFeatures does not manufacture a regime with insufficient history', () => {
  const rows = Array.from({ length: 10 }, (_, i) => bar(i * 60_000, 100 + i * 0.01));
  const result = deriveVolatilityShockFeatures(rows);
  assert.equal(result.volatilityState, 'insufficient');
  assert.equal(result.realizedVolShortBps, null);
  assert.equal(result.volatilityExpansionRatio, null);
});
