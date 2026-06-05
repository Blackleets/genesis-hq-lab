import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exceedsDailyCap, isAssetInCooldown } from '../crypto/cryptoRisk.mjs';

test('exceedsDailyCap — blocks once realized losses reach the cap', () => {
  assert.strictEqual(exceedsDailyCap(-300, 300), true);
  assert.strictEqual(exceedsDailyCap(-350, 300), true);
  assert.strictEqual(exceedsDailyCap(-200, 300), false);
  assert.strictEqual(exceedsDailyCap(50, 300), false); // a profitable day never blocks
});

test('isAssetInCooldown — only after a recent LOSS', () => {
  const now = Date.UTC(2026, 5, 5, 12, 0, 0);
  const recentLoss = { pnl: -2, closed_at: new Date(now - 5 * 60_000).toISOString() };   // 5 min ago
  const oldLoss    = { pnl: -2, closed_at: new Date(now - 60 * 60_000).toISOString() };  // 60 min ago
  const recentWin  = { pnl: 3,  closed_at: new Date(now - 5 * 60_000).toISOString() };

  assert.strictEqual(isAssetInCooldown(recentLoss, now, 15), true);   // within 15 min cooldown
  assert.strictEqual(isAssetInCooldown(oldLoss, now, 15), false);     // cooldown expired
  assert.strictEqual(isAssetInCooldown(recentWin, now, 15), false);   // wins don't trigger cooldown
  assert.strictEqual(isAssetInCooldown(null, now, 15), false);        // no prior trade
});

test('isAssetInCooldown — tolerates a bad timestamp', () => {
  const now = Date.UTC(2026, 5, 5, 12, 0, 0);
  assert.strictEqual(isAssetInCooldown({ pnl: -2, closed_at: 'garbage' }, now, 15), false);
});
