import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCrossMarketObservation } from '../genesis/crossMarketLeadLagCapture.mjs';

const row = (t, close, quote, confirm = '1') => [
  String(t), String(close - 1), String(close + 1), String(close - 2), String(close),
  '10', '20', String(quote), confirm,
];

test('aligns only confirmed OKX spot/perp bars and derives causal cross-market features', () => {
  const t0 = Date.UTC(2026, 8, 9, 12, 0, 0);
  const t1 = t0 + 60_000;
  const t2 = t1 + 60_000;

  // OKX returns newest first; unconfirmed current bar must be ignored.
  const spot = [row(t2, 999, 1, '0'), row(t1, 101, 1200), row(t0, 100, 1000)];
  const fut = [row(t2, 1, 1, '0'), row(t1, 101.2, 2400), row(t0, 100.1, 2000)];
  const out = buildCrossMarketObservation(spot, fut);

  assert.equal(out.mode, 'RESEARCH_ONLY');
  assert.equal(out.provider, 'okx_public_market_data');
  assert.equal(out.researchUse, 'OBSERVATIONAL_ONLY_NOT_IN_H1_NOT_FOR_RANKING');
  assert.equal(out.barOpenTime, new Date(t1).toISOString());
  assert.equal(out.features.spotClose, 101);
  assert.equal(out.features.futuresClose, 101.2);
  assert.equal(out.features.spotQuoteVolume, 1200);
  assert.equal(out.features.futuresQuoteVolume, 2400);
  assert.ok(out.features.basisBps > 0);
  assert.ok(out.features.spotReturn1mBps > 0);
  assert.equal(out.provenance.confirmedBarsOnly, true);
});

test('requires two aligned confirmed bars', () => {
  const t0 = Date.UTC(2026, 8, 9, 12, 0, 0);
  assert.throws(
    () => buildCrossMarketObservation([row(t0, 100, 1000)], [row(t0, 100, 1000)]),
    /two aligned confirmed 1m bars/,
  );
});
