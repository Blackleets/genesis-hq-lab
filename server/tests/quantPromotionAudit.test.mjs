import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  recordStatusIfChanged,
  getTransitionHistory,
  setStatusOverride,
  clearStatusOverride,
  getStatusOverride,
  getAllOverrides,
} from '../quant/alpha/promotionAudit.mjs';
import db from '../db/database.mjs';

const TEST_ID = 'test-strategy-audit-001';
const TEST_ID2 = 'test-strategy-audit-002';

function cleanupTestRows() {
  try {
    db.prepare(`DELETE FROM strategy_transitions WHERE strategy_id LIKE 'test-strategy-audit-%'`).run();
    db.prepare(`DELETE FROM strategy_overrides   WHERE strategy_id LIKE 'test-strategy-audit-%'`).run();
  } catch { /* non-fatal */ }
}

describe('promotionAudit — transition recording', () => {
  before(cleanupTestRows);
  after(cleanupTestRows);

  test('records first-seen transition from null → RESEARCH', () => {
    recordStatusIfChanged(TEST_ID, 'RESEARCH');
    const rows = getTransitionHistory({ strategyId: TEST_ID, limit: 5 });
    assert.ok(rows.length >= 1, 'expected at least one transition');
    const first = rows[0];
    assert.equal(first.strategy_id, TEST_ID);
    assert.equal(first.to_status, 'RESEARCH');
    assert.equal(first.from_status, null);
    assert.equal(first.reason, 'first_seen');
  });

  test('records subsequent status change', () => {
    recordStatusIfChanged(TEST_ID, 'PAPER');
    const rows = getTransitionHistory({ strategyId: TEST_ID, limit: 5 });
    const latest = rows[0];
    assert.equal(latest.to_status, 'PAPER');
    assert.equal(latest.from_status, 'RESEARCH');
    assert.equal(latest.reason, 'RESEARCH→PAPER');
  });

  test('does NOT record when status is unchanged', () => {
    const before = getTransitionHistory({ strategyId: TEST_ID, limit: 5 }).length;
    recordStatusIfChanged(TEST_ID, 'PAPER'); // same status
    const after = getTransitionHistory({ strategyId: TEST_ID, limit: 5 }).length;
    assert.equal(after, before, 'should not insert a duplicate row');
  });

  test('records PROMOTED transition with live data', () => {
    const live = { trades: 45, profitFactor: 1.8, winRate: 0.62, avgPnl: 12.5 };
    recordStatusIfChanged(TEST_ID, 'PROMOTED', live);
    const rows = getTransitionHistory({ strategyId: TEST_ID, limit: 5 });
    const promoted = rows.find((r) => r.to_status === 'PROMOTED');
    assert.ok(promoted, 'PROMOTED row should exist');
    assert.equal(promoted.trades, 45);
    assert.ok(Math.abs(promoted.profit_factor - 1.8) < 0.001);
    assert.ok(Math.abs(promoted.win_rate - 0.62) < 0.001);
  });

  test('records REJECTED transition', () => {
    recordStatusIfChanged(TEST_ID, 'REJECTED', { profitFactor: 0.7 });
    const rows = getTransitionHistory({ strategyId: TEST_ID, limit: 5 });
    const rejected = rows.find((r) => r.to_status === 'REJECTED');
    assert.ok(rejected, 'REJECTED row should exist');
  });
});

describe('promotionAudit — transition history queries', () => {
  before(() => {
    cleanupTestRows();
    recordStatusIfChanged(TEST_ID2, 'RESEARCH');
    recordStatusIfChanged(TEST_ID2, 'PAPER');
    recordStatusIfChanged(TEST_ID2, 'PROMOTED');
  });
  after(cleanupTestRows);

  test('getTransitionHistory returns array', () => {
    const rows = getTransitionHistory({ strategyId: TEST_ID2 });
    assert.ok(Array.isArray(rows));
    assert.ok(rows.length >= 3);
  });

  test('rows are ordered newest first', () => {
    const rows = getTransitionHistory({ strategyId: TEST_ID2 });
    for (let i = 0; i < rows.length - 1; i++) {
      assert.ok(rows[i].id >= rows[i + 1].id, 'rows should be DESC by id');
    }
  });

  test('limit parameter is respected', () => {
    const rows = getTransitionHistory({ strategyId: TEST_ID2, limit: 1 });
    assert.equal(rows.length, 1);
  });

  test('getTransitionHistory without strategyId returns all strategies', () => {
    const rows = getTransitionHistory({ limit: 100 });
    const hasTest2 = rows.some((r) => r.strategy_id === TEST_ID2);
    assert.ok(hasTest2, 'global history should include test strategy');
  });
});

describe('promotionAudit — manual overrides', () => {
  before(cleanupTestRows);
  after(cleanupTestRows);

  test('getStatusOverride returns null when no override set', () => {
    const ov = getStatusOverride(TEST_ID);
    assert.equal(ov, null);
  });

  test('setStatusOverride stores the override', () => {
    setStatusOverride(TEST_ID, 'PAPER', { reason: 'hold for review', setBy: 'test-runner' });
    const ov = getStatusOverride(TEST_ID);
    assert.ok(ov !== null, 'override should exist');
    assert.equal(ov.strategy_id, TEST_ID);
    assert.equal(ov.status, 'PAPER');
    assert.equal(ov.reason, 'hold for review');
    assert.equal(ov.set_by, 'test-runner');
  });

  test('getAllOverrides includes the new override', () => {
    const all = getAllOverrides();
    assert.ok(Array.isArray(all));
    const found = all.find((o) => o.strategy_id === TEST_ID);
    assert.ok(found, 'getAllOverrides should include our test override');
  });

  test('setStatusOverride replaces existing override', () => {
    setStatusOverride(TEST_ID, 'DISABLED', { reason: 'updated' });
    const ov = getStatusOverride(TEST_ID);
    assert.equal(ov.status, 'DISABLED');
    assert.equal(ov.reason, 'updated');
  });

  test('clearStatusOverride removes the override', () => {
    clearStatusOverride(TEST_ID);
    const ov = getStatusOverride(TEST_ID);
    assert.equal(ov, null);
  });

  test('getAllOverrides no longer contains cleared strategy', () => {
    const all = getAllOverrides();
    const found = all.find((o) => o.strategy_id === TEST_ID);
    assert.equal(found, undefined);
  });
});
