import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSpotPerpTakerDivergence } from '../genesis/spotPerpTakerDivergenceCapture.mjs';

const now = Date.parse('2026-09-10T08:00:00.000Z');

function flow({ time = now - 1_000, buy = 0.5, coverageMs = 59_500 } = {}) {
  return {
    available: true,
    time,
    targetWindowMs: 60_000,
    coverageMs,
    tradeCount: 250,
    notionalBuyFraction: buy,
  };
}

test('builds normalized spot-perp taker divergence without comparing incompatible raw sizes', () => {
  const out = buildSpotPerpTakerDivergence(
    flow({ buy: 0.42 }),
    flow({ time: now - 2_000, buy: 0.61 }),
    { capturedAtMs: now },
  );
  assert.equal(out.mode, 'RESEARCH_ONLY');
  assert.equal(out.researchUse, 'OBSERVATIONAL_ONLY_NOT_IN_H1_NOT_FOR_RANKING');
  assert.ok(Math.abs(out.divergence.perpMinusSpotNotionalBuyFraction - 0.19) < 1e-12);
  assert.equal(out.provenance.normalization, 'WITHIN_INSTRUMENT_NOTIONAL_BUY_FRACTION');
  assert.equal(out.provenance.rawSpotVsPerpSizeComparisonForbidden, true);
  assert.equal(out.provenance.windowEndSkewMs, 1_000);
});

test('fails closed when exchange-time window ends are not synchronized', () => {
  assert.throws(
    () => buildSpotPerpTakerDivergence(
      flow({ time: now - 1_000 }),
      flow({ time: now - 20_000 }),
      { capturedAtMs: now, maxWindowEndSkewMs: 15_000 },
    ),
    /not synchronized/,
  );
});

test('fails closed on insufficient fixed-window coverage', () => {
  assert.throws(
    () => buildSpotPerpTakerDivergence(
      flow({ coverageMs: 50_000 }),
      flow(),
      { capturedAtMs: now },
    ),
    /Insufficient fixed-window coverage/,
  );
});

test('fails closed on future source timestamps', () => {
  assert.throws(
    () => buildSpotPerpTakerDivergence(
      flow({ time: now + 1 }),
      flow(),
      { capturedAtMs: now },
    ),
    /Future taker evidence/,
  );
});
