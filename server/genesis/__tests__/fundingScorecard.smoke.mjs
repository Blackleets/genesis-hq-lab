import assert from 'node:assert/strict';
import { buildFundingScorecard } from '../fundingScorecard.mjs';

const flat = buildFundingScorecard({
  paper: true,
  liveOff: true,
  go: false,
  capital: 10000,
  realizedFundingUsdt: 0.87,
  feesUsdt: 6.25,
  mtmUsdt: 0,
  settledCount: 3,
  holds: [],
  closed: [
    { side: 'short', entryPx: 100, exitPx: 101, notional: 1000, feeUsdt: 0.5 },
  ],
});
assert.equal(flat.go, false);
assert.equal(flat.liveOff, true);
assert.equal(flat.verdict, 'INSUFFICIENT_SAMPLE');
assert.equal(flat.productionReadiness.status, 'NOT_READY');
assert.equal(flat.paperPerformance.realizedPricePnlUsdt, -10);
assert.ok(flat.paperPerformance.realizedNetPnlUsdt < -15);

const covered = buildFundingScorecard({
  paper: true,
  liveOff: true,
  go: false,
  capital: 10000,
  realizedFundingUsdt: 20,
  feesUsdt: 5,
  mtmUsdt: 1,
  settledCount: 12,
  holds: [{ instId: 'XAU-USDT-SWAP' }],
  closed: [],
});
assert.equal(covered.edgeEvidence.feesCoveredByFunding, true);
assert.equal(covered.edgeEvidence.realizedEconomicPositive, true);
assert.equal(covered.verdict, 'PAPER_CANDIDATE_NOT_GO');
assert.equal(covered.go, false);

const fundingLooksGoodButPriceKillsIt = buildFundingScorecard({
  paper: true,
  liveOff: true,
  go: false,
  capital: 10000,
  realizedFundingUsdt: 20,
  feesUsdt: 5,
  mtmUsdt: 0,
  settledCount: 12,
  holds: [],
  closed: [
    { side: 'short', entryPx: 100, exitPx: 103, notional: 1000, feeUsdt: 0.5 },
  ],
});
assert.equal(fundingLooksGoodButPriceKillsIt.edgeEvidence.feesCoveredByFunding, true);
assert.equal(fundingLooksGoodButPriceKillsIt.edgeEvidence.realizedEconomicPositive, false);
assert.equal(fundingLooksGoodButPriceKillsIt.verdict, 'ECONOMIC_LOSS');
assert.equal(fundingLooksGoodButPriceKillsIt.go, false);
console.log('fundingScorecard.smoke ok');
