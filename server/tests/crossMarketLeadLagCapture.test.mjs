import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCrossMarketObservation } from '../genesis/crossMarketLeadLagCapture.mjs';

const row = (t, close, quote, takerQuote) => [
  t, String(close - 1), String(close + 1), String(close - 2), String(close), '10',
  t + 59_999, String(quote), 100, '5', String(takerQuote), '0',
];

test('buildCrossMarketObservation aligns only closed bars and derives causal spot/perp features', () => {
  const t0 = Date.UTC(2026, 8, 9, 12, 0, 0);
  const t1 = t0 + 60_000;
  const t2 = t1 + 60_000;
  const now = t2 + 30_000; // t2 is still open and must be excluded

  const spot = [row(t0, 100, 1000, 400), row(t1, 101, 1200, 720), row(t2, 999, 1, 1)];
  const fut = [row(t0, 100.1, 2000, 1000), row(t1, 101.2, 2400, 1440), row(t2, 1, 1, 0)];
  const out = buildCrossMarketObservation(spot, fut, { now });

  assert.equal(out.mode, 'RESEARCH_ONLY');
  assert.equal(out.researchUse, 'OBSERVATIONAL_ONLY_NOT_IN_H1_NOT_FOR_RANKING');
  assert.equal(out.barOpenTime, new Date(t1).toISOString());
  assert.equal(out.features.spotClose, 101);
  assert.equal(out.features.futuresClose, 101.2);
  assert.equal(out.features.spotTakerBuyShare, 0.6);
  assert.equal(out.features.futuresTakerBuyShare, 0.6);
  assert.ok(out.features.basisBps > 0);
  assert.ok(out.features.spotReturn1mBps > 0);
});

test('requires two aligned closed bars', () => {
  const t0 = Date.UTC(2026, 8, 9, 12, 0, 0);
  assert.throws(
    () => buildCrossMarketObservation([row(t0, 100, 1000, 500)], [row(t0, 100, 1000, 500)], { now: t0 + 120_000 }),
    /two aligned closed 1m bars/,
  );
});
