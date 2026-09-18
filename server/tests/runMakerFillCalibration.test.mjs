import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readMakerFillObservationJsonl,
  runMakerFillCalibration,
} from '../research/runMakerFillCalibration.mjs';

test('runner ignores malformed JSONL and preserves research-only boundaries', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maker-calibration-'));
  const input = path.join(root, 'maker.jsonl');
  const out = path.join(root, 'report.json');
  const valid = {
    side: 'BUY',
    targetHorizonMs: 10_000,
    queueCoverage: 1.5,
    spreadBps: 3,
    fillRatio: 1,
    adverseSelectionBps: 2,
    spreadCaptureBps: 1.5,
    observedAt: '2026-09-18T12:00:00.000Z',
  };
  fs.writeFileSync(input, JSON.stringify(valid) + '\n{broken\n', 'utf8');

  assert.equal(readMakerFillObservationJsonl(input).length, 1);
  const report = runMakerFillCalibration(input, out);
  assert.equal(report.rawObservationCount, 1);
  assert.equal(report.boundaries.executionAuthority, false);
  assert.equal(report.boundaries.liveLocked, true);
  assert.equal(report.boundaries.notForLiveScoring, true);
  assert.ok(fs.existsSync(out));
});
