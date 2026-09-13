import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FUNDING_EXECUTION_AUTHORITY,
  FUNDING_SHADOW_MODE,
  contractCompatibility,
  evaluateFundingPair,
  evaluateFundingPersistence,
  projectFundingCarry,
  rankFundingPairs,
  roundTripFeeBps,
} from '../genesis/crossExchangeFundingShadow.mjs';

const gateEth = {
  venue: 'gate',
  symbol: 'ETH/USDT:USDT',
  base: 'ETH',
  quote: 'USDT',
  settle: 'USDT',
  fundingRate: -0.000081,
  interval: '8h',
  taker: 0.0005,
  maker: 0.0002,
  fundingTimestamp: 1789344000000,
};

const bitgetEth = {
  venue: 'bitget',
  symbol: 'ETH/USDT:USDT',
  base: 'ETH',
  quote: 'USDT',
  settle: 'USDT',
  fundingRate: 0.0001,
  interval: '8h',
  taker: 0.0006,
  maker: 0.0002,
  fundingTimestamp: 1789344000000,
};

test('funding evaluator is structurally SHADOW only', () => {
  assert.equal(FUNDING_SHADOW_MODE, 'SHADOW');
  assert.equal(FUNDING_EXECUTION_AUTHORITY, false);
});

test('Gate ETH long / Bitget ETH short reproduces the observed 1.81 bps differential', () => {
  const row = evaluateFundingPair(gateEth, bitgetEth);

  assert.equal(row.status, 'OBSERVING');
  assert.equal(row.longVenue.venue, 'gate');
  assert.equal(row.shortVenue.venue, 'bitget');
  assert.ok(Math.abs(row.fundingDifferential.bpsPerInterval - 1.81) < 1e-9);
  assert.ok(Math.abs(row.fees.takerRoundTripBps - 22) < 1e-9);
  assert.ok(Math.abs(row.fees.makerRoundTripBps - 8) < 1e-9);
  assert.ok(Math.abs(row.breakEven.takerPeriods - (22 / 1.81)) < 1e-9);
  assert.ok(Math.abs(row.breakEven.takerHours - ((22 / 1.81) * 8)) < 1e-9);
  assert.ok(Math.abs(row.breakEven.makerHours - ((8 / 1.81) * 8)) < 1e-9);
  assert.ok(row.blockers.includes('fee_evidence_unverified'));
  assert.ok(row.blockers.includes('persistence_unmeasured'));
});

test('conditional horizon projections charge entry and exit fees on both legs', () => {
  const row = evaluateFundingPair(gateEth, bitgetEth);
  const day = row.projections.taker.find((x) => x.horizonHours === 24);
  const threeDay = row.projections.taker.find((x) => x.horizonHours === 72);
  const week = row.projections.taker.find((x) => x.horizonHours === 168);

  assert.ok(Math.abs(day.projectedFundingBps - 5.43) < 1e-9);
  assert.ok(Math.abs(day.projectedNetBeforeBasisSlippageBps - (-16.57)) < 1e-9);
  assert.ok(Math.abs(threeDay.projectedNetBeforeBasisSlippageBps - (-5.71)) < 1e-9);
  assert.ok(Math.abs(week.projectedNetBeforeBasisSlippageBps - 16.01) < 1e-9);
  assert.equal(week.assumption, 'projection_if_funding_differential_persists');
  assert.ok(row.projections.excludes.includes('funding_rate_change'));
});

test('round-trip fee math uses both venues twice', () => {
  assert.equal(roundTripFeeBps(
    { takerFee: 0.0005 },
    { takerFee: 0.0006 },
    'taker',
  ), 22);
});

test('contract mismatch is filtered instead of compared', () => {
  const incompatible = {
    ...bitgetEth,
    quote: 'USDC',
    symbol: 'ETH/USDC:USDT',
  };
  const compat = contractCompatibility(gateEth, incompatible);
  assert.equal(compat.compatible, false);
  assert.ok(compat.reasons.includes('quote_mismatch'));

  const row = evaluateFundingPair(gateEth, incompatible);
  assert.equal(row.status, 'FILTERED');
  assert.ok(row.blockers.includes('quote_mismatch'));
});

test('persistence requires enough samples, repeated positive spread and fee-positive horizon', () => {
  const weak = evaluateFundingPersistence([
    { diffBps: 1.8 },
    { diffBps: 1.7 },
  ], {
    intervalHours: 8,
    roundTripTradingFeeBps: 22,
  });
  assert.equal(weak.qualified, false);
  assert.ok(weak.blockers.includes('persistence_sample_too_small'));

  const stable = evaluateFundingPersistence([
    { diffBps: 1.8 }, { diffBps: 1.9 }, { diffBps: 1.7 },
    { diffBps: 1.8 }, { diffBps: 1.85 }, { diffBps: 1.75 },
    { diffBps: 1.82 }, { diffBps: 1.88 }, { diffBps: 1.79 },
  ], {
    intervalHours: 8,
    roundTripTradingFeeBps: 22,
  });
  assert.equal(stable.qualified, true);
  assert.equal(stable.sampleCount, 9);
  assert.equal(stable.positiveRatio, 1);
  assert.ok(stable.projectedNetBeforeBasisSlippageBps > 0);
});

test('even persistent spread cannot qualify without verified fee evidence', () => {
  const persistence = Array.from({ length: 9 }, () => ({ diffBps: 1.81 }));
  const unverified = evaluateFundingPair(gateEth, bitgetEth, {
    persistence,
    feeEvidenceVerified: false,
  });
  assert.equal(unverified.status, 'OBSERVING');
  assert.ok(unverified.blockers.includes('fee_evidence_unverified'));

  const verified = evaluateFundingPair(gateEth, bitgetEth, {
    persistence,
    feeEvidenceVerified: true,
  });
  assert.equal(verified.status, 'QUALIFIED');
  assert.deepEqual(verified.blockers, []);
  assert.equal(verified.executionAuthority, false);
});

test('ranking favors the widest compatible funding differential without claiming execution', () => {
  const okxEth = {
    ...gateEth,
    venue: 'okx',
    fundingRate: -0.0000314757088036,
  };
  const rows = rankFundingPairs([okxEth, gateEth, bitgetEth]);
  assert.equal(rows[0].longVenue.venue, 'gate');
  assert.equal(rows[0].shortVenue.venue, 'bitget');
  assert.equal(rows[0].executionAuthority, false);
});

test('projection helper is explicit about persistence assumption', () => {
  const projection = projectFundingCarry({
    fundingDiffBps: 1.81,
    intervalHours: 8,
    roundTripTradingFeeBps: 22,
    horizonHours: 168,
  });
  assert.ok(projection.projectedNetBeforeBasisSlippageBps > 16 - 1e-9);
  assert.equal(projection.assumption, 'projection_if_funding_differential_persists');
});
