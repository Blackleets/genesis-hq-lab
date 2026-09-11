import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../supabase/functions/genesis-futures-runner/index.ts', import.meta.url), 'utf8');

function closeFunction() {
  const start = source.indexOf('async function closePositions');
  const end = source.indexOf('async function openPaperPosition', start);
  assert.ok(start >= 0 && end > start, 'closePositions contract must remain inspectable');
  return source.slice(start, end);
}

test('runner uses adaptive profit ratchet as a paper-only v9 policy', () => {
  assert.match(source, /const RUNNER_VERSION = 'v8\.4'/);
  assert.match(source, /futures_breakout_short_micro:v9/);
  assert.match(source, /futures_breakout_short_core:v9/);
  assert.match(source, /futures_breakout_short_alt:v9/);
  assert.match(source, /futures_breakout_long_probe:v8/);
  assert.match(source, /version: 'adaptive_profit_ratchet_v1'/);
  assert.match(source, /activationNetUsd: 5/);
  assert.match(source, /minProtectedUsd: 1/);
  assert.match(source, /targetPct: 0\.06/);
  assert.match(source, /stopPct: 0\.03/);
});

test('v9 mark PnL does not double-charge entry slippage', () => {
  const block = source.slice(source.indexOf('function markEconomics'), source.indexOf('function markForNetPnl'));
  assert.match(block, /const v9 = String\(row\.strategy_version_id \|\| ''\)\.endsWith\(':v9'\)/);
  assert.match(block, /const effectiveEntry = v9 \? entry/);
  assert.match(block, /effectiveExit/);
  assert.match(block, /fees/);
  assert.match(block, /fundingPaid/);
});

test('profit ratchet is monotonic in both MFE and protected floor', () => {
  const block = closeFunction();
  assert.match(block, /Math\.max\(previousMfe, markState\.pnl\)/);
  assert.match(block, /Math\.max\(previousFloor, candidateFloor\)/);
  assert.match(block, /mfeUsd >= SHORT_EXIT_POLICY\.activationNetUsd/);
  assert.match(block, /reason = 'profit_ratchet'/);
});

test('ratchet combines regime momentum volatility and order-book context', () => {
  const context = source.slice(source.indexOf('function exitContext'), source.indexOf('function quoteVolume'));
  assert.match(context, /regimeAligned/);
  assert.match(context, /momentumAligned/);
  assert.match(context, /orderBookImbalance/);
  assert.match(context, /atrPct/);
  assert.match(context, /strength/);
  assert.match(source, /\/depth\?symbol=/);
});

test('large winners raise an explicit minimum protected-profit floor', () => {
  const block = source.slice(source.indexOf('function protectedTierFloor'), source.indexOf('function adaptiveProfitFloor'));
  assert.match(block, /mfeUsd >= 200\) return 150/);
  assert.match(block, /mfeUsd >= 100\) return 70/);
  assert.match(block, /mfeUsd >= 50\) return 30/);
  assert.match(block, /mfeUsd >= 25\) return 15/);
  assert.match(block, /mfeUsd >= 10\) return 5/);
});

test('dynamic stop price only moves in the direction of greater protection', () => {
  const tighten = source.slice(source.indexOf('function ratchetStopIsTighter'), source.indexOf('function summarize'));
  assert.match(tighten, /row\.outcome === 'LONG' \? nextStop > current : nextStop < current/);
  const close = closeFunction();
  assert.match(close, /ratchetStopIsTighter\(row, ratchetStopPrice\)/);
  assert.match(close, /stop_price: ratchetStopPrice/);
  assert.match(close, /profit_ratchet_stop/);
});

test('hard target and stop retain priority over adaptive ratchet and timeout', () => {
  const block = closeFunction();
  const hardTarget = block.indexOf("reason = 'take_profit'");
  const hardStop = block.indexOf("'stop_loss'");
  const ratchet = block.indexOf('adaptiveProfitFloor(');
  const timeout = block.indexOf("reason = 'timeout'");
  assert.ok(hardTarget >= 0 && hardStop >= 0 && ratchet >= 0 && timeout >= 0);
  assert.ok(hardTarget < ratchet, 'take profit must be checked before ratchet management');
  assert.ok(hardStop < ratchet, 'stop must be checked before ratchet management');
  assert.ok(ratchet < timeout, 'ratchet management must run before timeout');
});

test('runner remains paper-only and has no exchange order endpoint', () => {
  assert.match(source, /paperOnly: true/);
  assert.match(source, /liveOrders: false/);
  assert.match(source, /mode: 'paper'/);
  assert.doesNotMatch(source, /\/fapi\/v1\/order/);
  assert.doesNotMatch(source, /\/api\/v3\/order/);
});

test('new trades persist strategy and exit-policy provenance', () => {
  assert.match(source, /STRATEGY_VERSION_\$\{profile\.versionId\}/);
  assert.match(source, /EXIT_POLICY_\$\{profile\.exitPolicyVersion\.toUpperCase\(\)\}/);
  assert.match(source, /strategy_version_id: profile\.versionId/);
  assert.match(source, /runner_version: RUNNER_VERSION/);
});
