import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateQuantReport } from '../quant/quantReport.mjs';
import { _resetGlobalRiskForTest } from '../risk/globalRiskEngine.mjs';

describe('generateQuantReport — return shape', () => {
  before(() => _resetGlobalRiskForTest());
  after(() => _resetGlobalRiskForTest());

  test('returns all required top-level fields', () => {
    const report = generateQuantReport();
    assert.ok('headline'   in report, 'missing headline');
    assert.ok('edgeAnswer' in report, 'missing edgeAnswer');
    assert.ok('strategies' in report, 'missing strategies');
    assert.ok('blockers'   in report, 'missing blockers');
    assert.ok('allocation' in report, 'missing allocation');
    assert.ok('metrics'    in report, 'missing metrics');
    assert.ok('dataMode'   in report, 'missing dataMode');
    assert.ok('updatedAt'  in report, 'missing updatedAt');
  });

  test('edgeAnswer is one of YES / NO / UNKNOWN', () => {
    const report = generateQuantReport();
    assert.ok(
      ['YES', 'NO', 'UNKNOWN'].includes(report.edgeAnswer),
      `edgeAnswer "${report.edgeAnswer}" is not valid`,
    );
  });

  test('strategies is an array', () => {
    const report = generateQuantReport();
    assert.ok(Array.isArray(report.strategies));
  });

  test('blockers is an array', () => {
    const report = generateQuantReport();
    assert.ok(Array.isArray(report.blockers));
  });

  test('updatedAt is a valid ISO string', () => {
    const report = generateQuantReport();
    assert.ok(typeof report.updatedAt === 'string');
    assert.ok(!Number.isNaN(Date.parse(report.updatedAt)), 'updatedAt should be parseable');
  });
});

describe('generateQuantReport — headline content', () => {
  before(() => _resetGlobalRiskForTest());
  after(() => _resetGlobalRiskForTest());

  test('headline is a non-empty string', () => {
    const report = generateQuantReport();
    assert.ok(typeof report.headline === 'string');
    assert.ok(report.headline.length > 0);
  });

  test('headline contains EDGE keyword', () => {
    const report = generateQuantReport();
    assert.ok(
      report.headline.includes('EDGE'),
      `headline "${report.headline}" should reference EDGE`,
    );
  });

  test('headline matches edgeAnswer direction', () => {
    const report = generateQuantReport();
    if (report.edgeAnswer === 'YES') {
      assert.ok(report.headline.includes('VALIDATED') || report.headline.includes('YES'),
        'YES answer should have positive headline');
    } else if (report.edgeAnswer === 'NO') {
      assert.ok(report.headline.includes('NO EDGE') || report.headline.includes('YET'),
        'NO answer should have negative headline');
    }
  });
});

describe('generateQuantReport — strategy entries', () => {
  before(() => _resetGlobalRiskForTest());
  after(() => _resetGlobalRiskForTest());

  test('each strategy entry has required fields', () => {
    const report = generateQuantReport();
    for (const s of report.strategies) {
      assert.ok('strategyId'  in s, `${s.strategyId} missing strategyId`);
      assert.ok('name'        in s, `${s.strategyId} missing name`);
      assert.ok('status'      in s, `${s.strategyId} missing status`);
    }
  });

  test('strategy count matches registry', async () => {
    const { getStrategyRegistry } = await import('../quant/alpha/strategyRegistry.mjs');
    const reg    = getStrategyRegistry();
    const report = generateQuantReport();
    assert.equal(report.strategies.length, reg.strategies.length);
  });

  test('no strategy mixes crypto and prediction market fields', () => {
    const report = generateQuantReport();
    // Ensure no PM-specific fields leaked into quant report
    for (const s of report.strategies) {
      assert.ok(!('resolution' in s), 'PM resolution field should not appear');
      assert.ok(!('marketUrl'  in s), 'PM marketUrl should not appear');
    }
  });
});

describe('generateQuantReport — blockers', () => {
  before(() => _resetGlobalRiskForTest());
  after(() => _resetGlobalRiskForTest());

  test('each blocker has reason and code fields', () => {
    const report = generateQuantReport();
    for (const b of report.blockers) {
      assert.ok('reason' in b, 'blocker missing reason');
      assert.ok('code'   in b, 'blocker missing code');
    }
  });

  test('blockers.length === 0 when edgeAnswer is YES', () => {
    const report = generateQuantReport();
    if (report.edgeAnswer === 'YES') {
      assert.equal(report.blockers.length, 0, 'no blockers when edge is confirmed');
    }
  });
});

describe('generateQuantReport — metrics', () => {
  before(() => _resetGlobalRiskForTest());
  after(() => _resetGlobalRiskForTest());

  test('metrics has totalStrategies', () => {
    const report = generateQuantReport();
    assert.ok('totalStrategies' in report.metrics);
    assert.ok(typeof report.metrics.totalStrategies === 'number');
    assert.ok(report.metrics.totalStrategies > 0);
  });

  test('metrics has byStatus map', () => {
    const report = generateQuantReport();
    assert.ok('byStatus' in report.metrics);
    assert.ok(typeof report.metrics.byStatus === 'object');
  });

  test('dataMode is a string', () => {
    const report = generateQuantReport();
    assert.ok(typeof report.dataMode === 'string');
    assert.ok(report.dataMode.length > 0);
  });
});

describe('generateQuantReport — allocation summary', () => {
  before(() => _resetGlobalRiskForTest());
  after(() => _resetGlobalRiskForTest());

  test('allocation is null or has expected shape', () => {
    const report = generateQuantReport();
    if (report.allocation !== null) {
      assert.ok('blocked'           in report.allocation, 'allocation missing blocked');
      assert.ok('totalAllocatedPct' in report.allocation, 'allocation missing totalAllocatedPct');
    }
  });

  test('allocation.topAllocations is array when present', () => {
    const report = generateQuantReport();
    if (report.allocation !== null) {
      assert.ok(Array.isArray(report.allocation.topAllocations));
    }
  });
});
