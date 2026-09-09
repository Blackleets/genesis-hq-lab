import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveMarkIndexStress } from '../genesis/okxMarkIndexStress.mjs';

test('deriveMarkIndexStress computes signed and absolute dislocation causally', () => {
  const capturedAtMs = Date.parse('2026-09-09T20:00:00.000Z');
  const out = deriveMarkIndexStress(
    { markPx: '100.10', ts: String(capturedAtMs - 500) },
    { idxPx: '100.00', ts: String(capturedAtMs - 700) },
    { capturedAtMs },
  );
  assert.equal(out.markPx, 100.1);
  assert.equal(out.indexPx, 100);
  assert.ok(out.dislocationBps > 9.9 && out.dislocationBps < 10.1);
  assert.equal(out.absoluteDislocationBps, Math.abs(out.dislocationBps));
  assert.equal(out.agesMs.mark, 500);
  assert.equal(out.agesMs.index, 700);
});

test('deriveMarkIndexStress fails closed on future timestamps', () => {
  const capturedAtMs = 1_000_000;
  assert.throws(() => deriveMarkIndexStress(
    { markPx: '100', ts: String(capturedAtMs + 1) },
    { idxPx: '100', ts: String(capturedAtMs) },
    { capturedAtMs },
  ), /future source timestamp/);
});

test('deriveMarkIndexStress fails closed on stale timestamps', () => {
  const capturedAtMs = 1_000_000;
  assert.throws(() => deriveMarkIndexStress(
    { markPx: '100', ts: String(capturedAtMs - 120_001) },
    { idxPx: '100', ts: String(capturedAtMs - 1_000) },
    { capturedAtMs, maxAgeMs: 120_000 },
  ), /stale mark\/index source/);
});

test('deriveMarkIndexStress rejects invalid denominators', () => {
  const capturedAtMs = 1_000_000;
  assert.throws(() => deriveMarkIndexStress(
    { markPx: '0', ts: String(capturedAtMs - 1_000) },
    { idxPx: '100', ts: String(capturedAtMs - 1_000) },
    { capturedAtMs },
  ), /price must be positive/);
});
