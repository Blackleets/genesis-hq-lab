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

test('runner introduces immediate profit capture as a paper-only v9 policy', () => {
  assert.match(source, /const RUNNER_VERSION = 'v8\.3'/);
  assert.match(source, /futures_breakout_short_micro:v9/);
  assert.match(source, /futures_breakout_short_core:v9/);
  assert.match(source, /futures_breakout_short_alt:v9/);
  assert.match(source, /futures_breakout_long_probe:v8/);
  assert.match(source, /version: 'profit_lock_v2'/);
  assert.match(source, /targetPct: 0\.06/);
  assert.match(source, /stopPct: 0\.03/);
  assert.match(source, /immediateProfitRiskFraction: 0\.25/);
  assert.match(source, /timedProfitAfterFraction: 0\.35/);
});

test('profit capture cannot mutate legacy v8 cohorts', () => {
  const block = source.slice(source.indexOf('function profitCaptureReason'), source.indexOf('function summarize'));
  assert.match(block, /row\.outcome !== 'SHORT'/);
  assert.match(block, /endsWith\(':v9'\)/);
  assert.match(block, /profit_lock/);
  assert.match(block, /timed_profit_capture/);
});

test('meaningful net profit locks before any timeout-age requirement', () => {
  const block = source.slice(source.indexOf('function profitCaptureReason'), source.indexOf('function summarize'));
  const immediate = block.indexOf('SHORT_EXIT_POLICY.immediateProfitRiskFraction');
  const timeoutLookup = block.indexOf('timeoutHoursFor');
  const timed = block.indexOf('SHORT_EXIT_POLICY.timedProfitAfterFraction');
  assert.ok(immediate >= 0 && timeoutLookup >= 0 && timed >= 0);
  assert.ok(immediate < timeoutLookup, '0.25R net profit must be captured without waiting for timeout age');
  assert.ok(timeoutLookup < timed, 'timed positive capture must remain a secondary fallback');
});

test('hard target and stop retain priority over adaptive profit capture', () => {
  const block = closeFunction();
  const hardTarget = block.indexOf("reason = 'take_profit'");
  const hardStop = block.indexOf("reason = 'stop_loss'");
  const adaptive = block.indexOf('profitCaptureReason(');
  const timeout = block.indexOf("reason = 'timeout'");
  assert.ok(hardTarget >= 0 && hardStop >= 0 && adaptive >= 0 && timeout >= 0);
  assert.ok(hardTarget < adaptive, 'take profit must be checked before adaptive capture');
  assert.ok(hardStop < adaptive, 'stop loss must be checked before adaptive capture');
  assert.ok(adaptive < timeout, 'adaptive capture must be checked before timeout');
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
