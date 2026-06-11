import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import db from '../db/database.mjs';
import {
  EXECUTION_MODES,
  FEE_POLICIES,
  assertModeAllowed,
  feePolicyForEntitlement,
  normalizeExecutionMode,
  productFeatureFlags,
} from '../product/productFoundation.mjs';

const REQUIRED_TABLES = [
  'users',
  'user_wallets',
  'wallet_sessions',
  'admin_users',
  'admin_audit_logs',
  'user_entitlements',
  'billing_events',
  'operation_intents',
  'support_cases',
  'risk_flags',
  'wallet_snapshots',
  'memory_consent',
  'user_memory',
  'global_memory_candidates',
  'global_memory',
  'paper_accounts',
  'paper_universe',
  'paper_agent_runs',
];

function columns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
}

describe('product foundation schema', () => {
  it('creates wallet-first product tables', () => {
    const rows = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN (${REQUIRED_TABLES.map(() => '?').join(',')})
    `).all(...REQUIRED_TABLES);
    assert.equal(rows.length, REQUIRED_TABLES.length);
  });

  it('keeps owner/admin actions auditable and non-custodial', () => {
    assert.ok(columns('admin_audit_logs').includes('reason'));
    assert.ok(columns('admin_audit_logs').includes('metadata'));
    assert.equal(columns('user_wallets').includes('private_key'), false);
    assert.equal(columns('user_wallets').includes('seed_phrase'), false);
  });

  it('supports paper sandbox and future billing without enabling fees', () => {
    assert.ok(columns('paper_accounts').includes('max_balance'));
    assert.ok(columns('paper_accounts').includes('mode'));
    assert.ok(columns('billing_events').includes('fee_policy'));
    assert.ok(columns('operation_intents').includes('consent_required'));
  });
});
describe('product foundation contracts', () => {
  it('defaults risky features to disabled', () => {
    const flags = productFeatureFlags({});
    assert.equal(flags.feesEnabled, false);
    assert.equal(flags.liveTradingEnabled, false);
    assert.equal(flags.globalLearningEnabled, false);
    assert.equal(flags.walletLoginEnabled, false);
  });

  it('blocks live mode unless explicitly enabled', () => {
    assert.deepEqual(assertModeAllowed(EXECUTION_MODES.LIVE, { liveTradingEnabled: false }), {
      ok: false,
      mode: 'live',
      reason: 'live_trading_disabled',
    });
    assert.equal(assertModeAllowed(EXECUTION_MODES.LIVE, { liveTradingEnabled: true }).ok, true);
  });

  it('normalizes unknown modes to paper and disables fee policy when fees are off', () => {
    assert.equal(normalizeExecutionMode('bad-mode'), EXECUTION_MODES.PAPER);
    assert.equal(feePolicyForEntitlement({ fee_policy: FEE_POLICIES.REQUIRED }, { feesEnabled: false }), FEE_POLICIES.DISABLED);
  });
});
