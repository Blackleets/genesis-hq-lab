// reconciliation.test.mjs — BLOCKER-04 startup reconciliation tests
//
// Both getStatusFn and getTradesFn are injected, so tests never touch
// real open trades in the shared genesis.db — complete isolation.
//
// Scenarios tested:
//   1. No open positions → healthy startup
//   2. Open position confirmed by exchange → recovering (not degraded)
//   3. Position resolved during downtime → recovered + closed in DB
//   4. Network failure → degraded (safe mode active)
//   5. Conflicting state → degraded
//   6. isSafeMode() / clearSafeMode() lifecycle
//   7. State persists across simulated restart

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import db from '../db/database.mjs';
import {
  runStartupReconciliation,
  getReconciliationStatus,
  isSafeMode,
  clearSafeMode,
  _resetReconciliationCacheForTest,
  RECONCILIATION_STATUS,
} from '../memory/reconciliationEngine.mjs';

const P = 'recon-test-';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTrade(overrides = {}) {
  return {
    id:              `${P}${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    market_id:       `${P}mkt-default`,
    market_source:   'polymarket',
    capital_used:    50.00,
    opened_at:       new Date().toISOString(),
    ...overrides,
  };
}

// Insert a trade object into the DB using the same schema as tradingMemory.
function saveTrade(t) {
  db.prepare(`
    INSERT OR REPLACE INTO trades
      (id, agent_id, market_id, market_source, market_question, market_category,
       outcome, entry_price, shares, capital_used, confidence, reason, evidence,
       signals_used, lessons_applied, rules_applied, status, opened_at)
    VALUES
      (@id, NULL, @market_id, @market_source, 'Test market question', 'general',
       'YES', 0.50, 10, @capital_used, 0.70, 'Test reason', '[]',
       '[]', '[]', '[]', 'open', @opened_at)
  `).run(t);
  return t.id;
}

function deleteTrade(id) {
  db.prepare(`DELETE FROM trades WHERE id = ?`).run(id);
}

function deleteReconciliationState() {
  db.prepare(`DELETE FROM org_state WHERE key = 'reconciliation_status'`).run();
}

function resetState() {
  deleteReconciliationState();
  _resetReconciliationCacheForTest();
}

// ── Scenario 1: No open positions → healthy ────────────────────────────────────

describe('Scenario 1: No open positions → healthy startup', () => {
  before(resetState);
  after(resetState);

  test('returns healthy status when injected trade list is empty', async () => {
    const result = await runStartupReconciliation(
      () => { throw new Error('should not be called'); },
      () => [],   // no trades
    );
    assert.equal(result.status, RECONCILIATION_STATUS.HEALTHY);
    assert.equal(result.recoveredPositions, 0);
    assert.equal(result.orphanCount, 0);
    assert.equal(result.unresolvedExposure, 0);
    assert.ok(result.lastRun, 'lastRun should be set');
  });

  test('isSafeMode() returns false after healthy startup', () => {
    assert.equal(isSafeMode(), false);
  });

  test('persists healthy state to org_state', () => {
    const row = db.prepare(`SELECT value FROM org_state WHERE key = 'reconciliation_status'`).get();
    assert.ok(row, 'state should be persisted');
    const parsed = JSON.parse(row.value);
    assert.equal(parsed.status, 'healthy');
  });
});

// ── Scenario 2: Open position confirmed by exchange → recovering ───────────────

describe('Scenario 2: Open position confirmed active → recovering', () => {
  before(resetState);
  after(resetState);

  test('marks as recovering when exchange confirms position is open', async () => {
    const trade = makeTrade({ market_id: `${P}mkt-open` });

    const mockStatus = async () => ({ status: 'open' });
    const mockTrades = () => [trade];

    const result = await runStartupReconciliation(mockStatus, mockTrades);

    assert.equal(result.status, RECONCILIATION_STATUS.RECOVERING);
    assert.equal(result.recoveredPositions, 0);
    assert.equal(result.unresolvedExposure, 50.00);
  });

  test('isSafeMode() returns false — recovering allows trading', () => {
    assert.equal(isSafeMode(), false);
  });
});

// ── Scenario 3: Position resolved during downtime → recovered ─────────────────

describe('Scenario 3: Position resolved during downtime → recovered', () => {
  let tradeId;
  before(() => {
    resetState();
    tradeId = saveTrade(makeTrade({ id: `${P}resolved-001`, market_id: `${P}mkt-resolved` }));
  });
  after(() => {
    deleteTrade(tradeId);
    resetState();
  });

  test('closes resolved trade and returns healthy status', async () => {
    const mockStatus = async () => ({ status: 'resolved', result: 'yes' });
    // Return the actual DB trade so closeTrade() can find it by id
    const dbTrade = db.prepare(`SELECT * FROM trades WHERE id = ?`).get(tradeId);
    const mockTrades = () => [dbTrade];

    const result = await runStartupReconciliation(mockStatus, mockTrades);

    assert.equal(result.recoveredPositions, 1);
    assert.equal(result.unresolvedExposure, 0);
    assert.equal(result.status, RECONCILIATION_STATUS.HEALTHY);
  });

  test('trade is now closed in SQLite', () => {
    const trade = db.prepare(`SELECT status FROM trades WHERE id = ?`).get(tradeId);
    assert.equal(trade.status, 'closed');
  });

  test('isSafeMode() returns false after full recovery', () => {
    assert.equal(isSafeMode(), false);
  });
});

// ── Scenario 4: Network failure → degraded (safe mode) ────────────────────────

describe('Scenario 4: Network failure → degraded', () => {
  before(resetState);
  after(resetState);

  test('enters degraded state when exchange is unreachable', async () => {
    const trade = makeTrade({ market_id: `${P}mkt-net-fail` });
    const mockStatus = async () => { throw new Error('ECONNREFUSED'); };
    const mockTrades = () => [trade];

    const result = await runStartupReconciliation(mockStatus, mockTrades);

    assert.equal(result.status, RECONCILIATION_STATUS.DEGRADED);
    assert.ok(result.issues.length > 0);
    assert.equal(result.issues[0].type, 'network_failure');
  });

  test('isSafeMode() returns true after degraded startup', () => {
    assert.equal(isSafeMode(), true);
  });

  test('clearSafeMode() clears the block', () => {
    clearSafeMode();
    assert.equal(isSafeMode(), false);
  });
});

// ── Scenario 5: Conflicting state → degraded ──────────────────────────────────

describe('Scenario 5: Conflicting market state → degraded', () => {
  before(resetState);
  after(resetState);

  test('enters degraded state on unrecognized market status', async () => {
    const trade = makeTrade({ market_id: `${P}mkt-conflict` });
    const mockStatus = async () => ({ status: 'unknown_state_xyz' });
    const mockTrades = () => [trade];

    const result = await runStartupReconciliation(mockStatus, mockTrades);

    assert.equal(result.status, RECONCILIATION_STATUS.DEGRADED);
    const conflictIssue = result.issues.find(i => i.type === 'conflicting_state');
    assert.ok(conflictIssue, 'should log conflicting_state issue');
  });

  test('isSafeMode() is true after conflict', () => {
    assert.equal(isSafeMode(), true);
  });
});

// ── Scenario 6: isSafeMode / clearSafeMode lifecycle ─────────────────────────

describe('Scenario 6: Safe mode lifecycle via org_state injection', () => {
  before(() => {
    resetState();
    db.prepare(`
      INSERT OR REPLACE INTO org_state (key, value, updated_at)
      VALUES ('reconciliation_status', ?, datetime('now'))
    `).run(JSON.stringify({
      status: 'degraded',
      issues: [{ type: 'network_failure' }],
      recoveredPositions: 0,
      orphanCount: 0,
      unresolvedExposure: 10,
      lastRun: '2026-01-01T00:00:00Z',
    }));
    _resetReconciliationCacheForTest();
  });
  after(resetState);

  test('reads degraded state from org_state on first access', () => {
    const status = getReconciliationStatus();
    assert.equal(status.status, 'degraded');
  });

  test('isSafeMode() is true when state is degraded', () => {
    assert.equal(isSafeMode(), true);
  });

  test('clearSafeMode() sets status to healthy', () => {
    clearSafeMode();
    assert.equal(isSafeMode(), false);
    assert.equal(getReconciliationStatus().status, RECONCILIATION_STATUS.HEALTHY);
  });

  test('cleared state persists to org_state', () => {
    const row = db.prepare(`SELECT value FROM org_state WHERE key = 'reconciliation_status'`).get();
    const parsed = JSON.parse(row.value);
    assert.equal(parsed.status, 'healthy');
  });
});

// ── Scenario 7: State persistence across restart ──────────────────────────────

describe('Scenario 7: State persists across simulated restarts', () => {
  before(resetState);
  after(resetState);

  test('step 1: healthy reconciliation persists to org_state', async () => {
    const result = await runStartupReconciliation(
      async () => ({ status: 'open' }),
      () => [],  // no trades
    );
    assert.equal(result.status, RECONCILIATION_STATUS.HEALTHY);
    const row = db.prepare(`SELECT value FROM org_state WHERE key = 'reconciliation_status'`).get();
    assert.ok(row);
    assert.equal(JSON.parse(row.value).status, 'healthy');
  });

  test('step 2: cache reset reloads healthy state from DB', () => {
    _resetReconciliationCacheForTest();
    const status = getReconciliationStatus();
    assert.equal(status.status, 'healthy', 'state should reload from org_state after cache reset');
  });

  test('step 3: inject degraded state into DB, verify restart reads it', () => {
    db.prepare(`
      INSERT OR REPLACE INTO org_state (key, value, updated_at)
      VALUES ('reconciliation_status', ?, datetime('now'))
    `).run(JSON.stringify({
      status: 'degraded',
      issues: [{ type: 'test_injection' }],
      recoveredPositions: 0,
      orphanCount: 1,
      unresolvedExposure: 99.99,
      lastRun: '2026-01-01T00:00:00Z',
    }));
    _resetReconciliationCacheForTest();

    const status = getReconciliationStatus();
    assert.equal(status.status, 'degraded');
    assert.equal(status.orphanCount, 1);
    assert.ok(Math.abs(status.unresolvedExposure - 99.99) < 0.01);
  });
});
