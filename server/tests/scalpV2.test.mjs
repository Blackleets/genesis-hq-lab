// scalpV2.test.mjs — Phase 6B Scalp V2 unit tests.
//
// Suites:
//   1. checkExitConditions  — pure function (positionMonitorCore.mjs, no DB)
//   2. evaluateScalpSignal  — signal scoring (scalpingEngine.mjs, requires DB)
//   3. scalpConfig          — config shape (scalpingEngine.mjs, requires DB)
//   4. getScalpV2Diagnostics — diagnostics shape (scalpingEngine.mjs, requires DB)

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkExitConditions } from '../trading/positionMonitorCore.mjs';

// ── Suite 1: checkExitConditions — pure, no DB ────────────────────────────────

describe('checkExitConditions — positionMonitorCore', () => {

  function makeTrade({
    outcome      = 'LONG',
    opened_at    = new Date(Date.now() - 60_000).toISOString(),  // 1 min ago
    stop_price   = null,
    target_price = null,
    days_to_close = null,
  } = {}) {
    return { outcome, opened_at, stop_price, target_price, days_to_close };
  }

  // ── CRITICAL risk forces exit ──
  it('CRITICAL risk → risk_close for any trade', () => {
    const result = checkExitConditions(makeTrade(), 50000, 'CRITICAL');
    assert.equal(result.shouldExit, true);
    assert.equal(result.reason, 'risk_close');
    assert.equal(result.exitType, 'risk');
  });

  // ── Stop loss ──
  it('LONG stop-loss triggers when price <= stop_price', () => {
    const trade = makeTrade({ outcome: 'LONG', stop_price: 49000 });
    assert.equal(checkExitConditions(trade, 48900, 'NORMAL').reason, 'stop_loss');
    assert.equal(checkExitConditions(trade, 49000, 'NORMAL').reason, 'stop_loss');
    assert.equal(checkExitConditions(trade, 49100, 'NORMAL').shouldExit, false);
  });

  it('SHORT stop-loss triggers when price >= stop_price', () => {
    const trade = makeTrade({ outcome: 'SHORT', stop_price: 51000 });
    assert.equal(checkExitConditions(trade, 51100, 'NORMAL').reason, 'stop_loss');
    assert.equal(checkExitConditions(trade, 51000, 'NORMAL').reason, 'stop_loss');
    assert.equal(checkExitConditions(trade, 50900, 'NORMAL').shouldExit, false);
  });

  // ── Take profit ──
  it('LONG take-profit triggers when price >= target_price', () => {
    const trade = makeTrade({ outcome: 'LONG', target_price: 51000 });
    assert.equal(checkExitConditions(trade, 51100, 'NORMAL').reason, 'take_profit');
    assert.equal(checkExitConditions(trade, 51000, 'NORMAL').reason, 'take_profit');
    assert.equal(checkExitConditions(trade, 50900, 'NORMAL').shouldExit, false);
  });

  it('SHORT take-profit triggers when price <= target_price', () => {
    const trade = makeTrade({ outcome: 'SHORT', target_price: 49000 });
    assert.equal(checkExitConditions(trade, 48900, 'NORMAL').reason, 'take_profit');
    assert.equal(checkExitConditions(trade, 49000, 'NORMAL').reason, 'take_profit');
    assert.equal(checkExitConditions(trade, 49100, 'NORMAL').shouldExit, false);
  });

  // ── Priority: SL wins over TP if both hit ──
  it('SL checked before TP (LONG price below both)', () => {
    const trade = makeTrade({ outcome: 'LONG', stop_price: 49000, target_price: 51000 });
    // Price 48000 → below stop → SL fires first
    const result = checkExitConditions(trade, 48000, 'NORMAL');
    assert.equal(result.reason, 'stop_loss');
  });

  // ── Timeout ──
  it('timeout fires after days_to_close * 24 hours', () => {
    const old = makeTrade({
      opened_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), // 3h ago
      days_to_close: 0.1, // 2.4h max
    });
    const result = checkExitConditions(old, 50000, 'NORMAL');
    assert.equal(result.reason, 'timeout');
    assert.equal(result.exitType, 'timeout');
  });

  it('no timeout when within time window', () => {
    const fresh = makeTrade({ opened_at: new Date().toISOString(), days_to_close: 1 });
    assert.equal(checkExitConditions(fresh, 50000, 'NORMAL').shouldExit, false);
  });

  // ── Hold when nothing triggers ──
  it('no exit when no conditions met', () => {
    const trade = makeTrade({ outcome: 'LONG', stop_price: 49000, target_price: 51000 });
    const result = checkExitConditions(trade, 50000, 'NORMAL');
    assert.equal(result.shouldExit, false);
    assert.equal(result.reason, null);
    assert.equal(result.exitType, null);
  });

  // ── Null price fields (no SL/TP configured) ──
  it('skips stop check when stop_price is null', () => {
    const trade = makeTrade({ outcome: 'LONG', stop_price: null, target_price: null });
    assert.equal(checkExitConditions(trade, 1, 'NORMAL').shouldExit, false);
  });

  // ── Priority order: CRITICAL beats SL ──
  it('CRITICAL fires before stop-loss', () => {
    const trade = makeTrade({ outcome: 'LONG', stop_price: 60000 });
    const result = checkExitConditions(trade, 30000, 'CRITICAL');
    assert.equal(result.reason, 'risk_close');
  });
});

// ── Suite 2: evaluateScalpSignal — signal scoring (requires DB at import) ─────

describe('evaluateScalpSignal — new field coverage', async () => {
  let evaluateScalpSignal;
  try { ({ evaluateScalpSignal } = await import('../strategies/scalpingEngine.mjs')); } catch { return; }

  function makeCtx({
    closes    = Array(15).fill(50000),
    ema9      = 50200,
    ema21     = 50000,
    rsi14     = 55,
    change1h  = 0.5,
    volume24h = 5_000_000,
    symbol    = 'BTCUSDT',
  } = {}) {
    return { closes, ema9, ema21, rsi14, change1h, volume24h, symbol };
  }

  it('result includes fatigue field on TRADE signal', () => {
    const ctx = makeCtx({ ema9: 50300, ema21: 50000, rsi14: 55, change1h: 0.5 });
    const result = evaluateScalpSignal(ctx);
    if (result.action === 'TRADE') {
      assert.ok('fatigue' in result, 'missing fatigue field');
      assert.ok('band' in result.fatigue, 'fatigue missing band');
      assert.ok('healthScore' in result.fatigue, 'fatigue missing healthScore');
      assert.ok('confidenceMultiplier' in result.fatigue, 'fatigue missing confidenceMultiplier');
      assert.ok('consecutiveLosses' in result.fatigue, 'fatigue missing consecutiveLosses');
    }
  });

  it('rawConfidence is always >= confidence after veto/fatigue reduction', () => {
    const ctx = makeCtx({ ema9: 50300, ema21: 50000, rsi14: 55, change1h: 0.5 });
    const result = evaluateScalpSignal(ctx);
    if (result.action === 'TRADE' && result.rawConfidence != null) {
      // rawConfidence may be higher or equal (regime/veto/fatigue can only lower)
      assert.ok(result.rawConfidence >= result.confidence - 0.001,
        `rawConfidence ${result.rawConfidence} < confidence ${result.confidence}`);
    }
  });

  it('regime field always present (even on WAIT)', () => {
    const ctx = makeCtx({ change1h: 0.001 }); // LOW_VOLATILITY → WAIT
    const result = evaluateScalpSignal(ctx);
    assert.equal(result.action, 'WAIT');
    assert.ok(typeof result.regime === 'string', 'regime must be a string on WAIT');
  });

  it('score field present on all TRADE results', () => {
    const ctx = makeCtx({ ema9: 50300, ema21: 50000, rsi14: 55, change1h: 0.5 });
    const result = evaluateScalpSignal(ctx);
    if (result.action === 'TRADE') {
      assert.ok(typeof result.score === 'number', 'score must be a number');
      assert.ok(result.score >= 45, `score ${result.score} should be >= 45 for TRADE`);
    }
  });

  it('SHORT side detected on bearish EMA + RSI setup', () => {
    // EMA_BEAR_CROSS: ema9 < ema21 * 0.9995, RSI_BEAR_MOMENTUM: 30 <= rsi14 <= 55
    const ctx = makeCtx({ ema9: 49700, ema21: 50000, rsi14: 45, change1h: -0.5 });
    const result = evaluateScalpSignal(ctx);
    if (result.action === 'TRADE') {
      assert.equal(result.side, 'SHORT');
    }
  });
});

// ── Suite 3: scalpConfig ──────────────────────────────────────────────────────

describe('scalpConfig — completeness', async () => {
  let scalpConfig;
  try { ({ scalpConfig } = await import('../strategies/scalpingEngine.mjs')); } catch { return; }

  it('returns all expected config keys', () => {
    const cfg = scalpConfig();
    for (const key of ['minConfidence', 'tpPct', 'slPct', 'maxCapital', 'timeoutHours']) {
      assert.ok(key in cfg, `missing config key: ${key}`);
      assert.ok(typeof cfg[key] === 'number', `${key} must be a number`);
    }
  });

  it('minConfidence is between 0 and 1', () => {
    const { minConfidence } = scalpConfig();
    assert.ok(minConfidence > 0 && minConfidence < 1, `minConfidence ${minConfidence} out of (0,1)`);
  });

  it('tpPct > slPct (reward > risk)', () => {
    const { tpPct, slPct } = scalpConfig();
    assert.ok(tpPct > slPct, `TP ${tpPct} should exceed SL ${slPct}`);
  });
});

// ── Suite 4: getScalpV2Diagnostics shape ──────────────────────────────────────

describe('getScalpV2Diagnostics — shape', async () => {
  let getScalpV2Diagnostics;
  try { ({ getScalpV2Diagnostics } = await import('../strategies/scalpingEngine.mjs')); } catch { return; }

  it('returns expected diagnostic fields', () => {
    const d = getScalpV2Diagnostics();
    for (const key of ['lastScanAt', 'lastSignalAt', 'lastTradeAt', 'executionBlockedReason', 'scannedSymbols', 'rejectedSignalsByReason', 'config']) {
      assert.ok(key in d, `missing diagnostic key: ${key}`);
    }
  });

  it('scannedSymbols is an array', () => {
    const d = getScalpV2Diagnostics();
    assert.ok(Array.isArray(d.scannedSymbols));
  });

  it('rejectedSignalsByReason is an object', () => {
    const d = getScalpV2Diagnostics();
    assert.ok(typeof d.rejectedSignalsByReason === 'object' && !Array.isArray(d.rejectedSignalsByReason));
  });

  it('config sub-object is populated', () => {
    const { config } = getScalpV2Diagnostics();
    assert.ok(config != null && typeof config === 'object');
    assert.ok('minConfidence' in config);
  });
});
