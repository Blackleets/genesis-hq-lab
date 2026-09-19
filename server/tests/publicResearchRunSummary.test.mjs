import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPublicResearchSummary } from '../../scripts/publicResearchRunSummary.mjs';

function reports(overrides = {}) {
  return {
    stack: {
      generatedAt: '2026-09-18T14:00:00.000Z',
      liveLocked: true,
      executionAuthority: false,
      allocation: { qualifiedSleeves: 0, cashReserve: { paperWeight: 1 } },
      executionBrain: { action: 'WAIT' },
      nextResearchPriority: 'NO_EDGE_PROVEN_KEEP_CASH_AND_GATHER_EVIDENCE',
      sleeves: [{
        sleeveKey: 'SOLANA_LIQUIDITY',
        engineVersion: 'solana_liquidity_lab_v7',
        samples: 10,
        expectancyBps: 0.0041,
        profitFactor: 1.30,
        paperCapitalEligible: false,
        liveEligible: false,
      }],
    },
    marketMaking: {
      version: 'market_making_lab_v4',
      best: {
        samples: 23,
        expectancyBps: -2.31,
        profitFactor: 0,
        eligibleForPaperAllocation: false,
        evidenceStatus: 'QUEUE_AWARE_RISK_ADVERSE_PROXY_AVAILABLE',
      },
    },
    statArb: {
      version: 'stat_arb_lab_v2',
      oosPassCount: 0,
      best: { oosTrades: 3, holdout: { expectancyBps: 145.9, profitFactor: 99 }, passedOos: false },
    },
    fundingCarry: {
      version: 'funding_carry_lab_v4',
      oosPassCount: 0,
      best: { oosTrades: 0, holdout: { expectancyBps: null, profitFactor: null }, passedOos: false },
    },
    solanaLiquidity: {},
    ...overrides,
  };
}

test('summary makes a zero-qualified WAIT state obvious and non-promotional', () => {
  const md = buildPublicResearchSummary(reports());
  assert.match(md, /LIVE_LOCKED/);
  assert.match(md, /Qualified sleeves \| 0/);
  assert.match(md, /Paper cash reserve \| 100%/);
  assert.match(md, /Current action \| \*\*WAIT\*\*/);
  assert.match(md, /No sleeve passed/);
  assert.match(md, /not live PnL/);
  assert.match(md, /not a profitability claim/);
  assert.match(md, /Market making .* -2\.31/);
  assert.match(md, /Funding carry .* OOS passes: 0/);
});

test('qualified research evidence never becomes a live-capital claim', () => {
  const input = reports();
  input.stack.allocation.qualifiedSleeves = 1;
  input.stack.allocation.cashReserve.paperWeight = 0.75;
  input.stack.executionBrain.action = 'MAKE';

  const md = buildPublicResearchSummary(input);
  assert.match(md, /Qualified sleeves \| 1/);
  assert.match(md, /Paper cash reserve \| 75%/);
  assert.match(md, /Current action \| \*\*MAKE\*\*/);
  assert.match(md, /not.*equivalent to live-capital approval/i);
});

test('missing lane files render n\/a rather than fabricated zeros', () => {
  const md = buildPublicResearchSummary({
    stack: {
      liveLocked: true,
      executionAuthority: false,
      allocation: { qualifiedSleeves: 0 },
      executionBrain: { action: 'WAIT' },
    },
  });
  assert.match(md, /Market making \| n\/a \| n\/a/);
  assert.match(md, /Paper cash reserve \| n\/a/);
});
