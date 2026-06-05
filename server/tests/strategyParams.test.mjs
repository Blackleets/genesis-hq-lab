import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, writeFileSync } from 'node:fs';
import { DEFAULTS, getParams, saveParams, clearParamsCache } from '../crypto/strategyParams.mjs';

const TMP = join(tmpdir(), `crypto_params_test_${process.pid}.json`);

beforeEach(() => {
  process.env.CRYPTO_PARAMS_PATH = TMP;
  try { rmSync(TMP); } catch { /* not there */ }
  clearParamsCache();
});

afterEach(() => {
  try { rmSync(TMP); } catch { /* not there */ }
  delete process.env.CRYPTO_PARAMS_PATH;
  clearParamsCache();
});

test('DEFAULTS keep the current strategy (target 1.5%, stop 0.75%, timeout 4h)', () => {
  assert.strictEqual(DEFAULTS.targetPct, 0.015);
  assert.strictEqual(DEFAULTS.stopPct, 0.0075);
  assert.strictEqual(DEFAULTS.timeoutHours, 4);
});

test('getParams returns defaults when no file exists', () => {
  const p = getParams();
  assert.strictEqual(p.targetPct, 0.015);
  assert.strictEqual(p.stopPct, 0.0075);
});

test('saveParams persists and getParams reads it back', () => {
  saveParams({ targetPct: 0.02, stopPct: 0.01 }, { source: 'test' });
  clearParamsCache();
  const p = getParams();
  assert.strictEqual(p.targetPct, 0.02);
  assert.strictEqual(p.stopPct, 0.01);
});

test('getParams merges partial saved params over defaults', () => {
  saveParams({ targetPct: 0.025 }, { source: 'test' });
  clearParamsCache();
  const p = getParams();
  assert.strictEqual(p.targetPct, 0.025);     // overridden
  assert.strictEqual(p.timeoutHours, 4);      // still default
});

test('getParams ignores a corrupt file and falls back to defaults', () => {
  saveParams({ targetPct: 0.02 }, { source: 'test' });
  // Corrupt the file
  writeFileSync(TMP, 'not json{{{');
  clearParamsCache();
  const p = getParams();
  assert.strictEqual(p.targetPct, 0.015);
});
