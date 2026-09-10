import test from 'node:test';
import assert from 'node:assert/strict';
import { runPositioningUniverseProbe } from '../genesis/researchUniverseProbe.mjs';

test('admits only symbols with every required public research dimension', async () => {
  const probe = async (_provider, { symbol }) => ({
    usableForSynchronizedResearch: symbol !== 'BNBUSDT',
    availableDimensions: symbol === 'BNBUSDT' ? ['funding', 'perp', 'spot', 'trades'] : ['funding', 'oi', 'perp', 'spot', 'trades'],
    checks: symbol === 'BNBUSDT' ? { oi: { ok: false } } : { oi: { ok: true } },
  });

  const out = await runPositioningUniverseProbe({
    symbols: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'],
    probe,
  });

  assert.equal(out.mode, 'RESEARCH_ONLY');
  assert.deepEqual(out.usableSymbols, ['BTCUSDT', 'ETHUSDT']);
  assert.deepEqual(out.excludedSymbols, ['BNBUSDT']);
  assert.equal(out.policy.missingDimensionExcludesSymbol, true);
  assert.equal(out.policy.substitutionsAllowed, false);
  assert.equal(out.policy.admissionDoesNotImplyEdge, true);
  assert.equal(out.boundaries.executionAuthority, false);
  assert.equal(out.boundaries.liveTrading, false);
  assert.equal(out.boundaries.realOrders, false);
  assert.equal(out.boundaries.candidatePromotion, false);
  assert.equal(out.boundaries.holdoutRanking, false);
});

test('records probe errors as exclusion instead of crashing the universe report', async () => {
  const probe = async (_provider, { symbol }) => {
    if (symbol === 'SOLUSDT') throw new Error('provider unavailable');
    return {
      usableForSynchronizedResearch: true,
      availableDimensions: ['funding', 'oi', 'perp', 'spot', 'trades'],
      checks: {},
    };
  };

  const out = await runPositioningUniverseProbe({ symbols: ['BTCUSDT', 'SOLUSDT'], probe });
  assert.deepEqual(out.usableSymbols, ['BTCUSDT']);
  assert.deepEqual(out.excludedSymbols, ['SOLUSDT']);
  assert.match(out.results.SOLUSDT.error, /provider unavailable/);
});
