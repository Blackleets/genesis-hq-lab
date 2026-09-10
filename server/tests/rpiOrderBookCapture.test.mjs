import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendRpiOrderBookJsonl } from '../genesis/rpiOrderBookCapture.mjs';

test('appendRpiOrderBookJsonl preserves prior evidence and appends one JSON object per line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'genesis-rpi-'));
  const file = path.join(dir, 'rpi-orderbook.jsonl');
  const a = { capturedAt: '2026-09-09T12:00:00.000Z', features: { rpiDepthImbalance: -0.25 } };
  const b = { capturedAt: '2026-09-09T12:15:00.000Z', features: { rpiDepthImbalance: 0.4 } };

  appendRpiOrderBookJsonl(file, a);
  appendRpiOrderBookJsonl(file, b);

  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(lines, [a, b]);
  fs.rmSync(dir, { recursive: true, force: true });
});
