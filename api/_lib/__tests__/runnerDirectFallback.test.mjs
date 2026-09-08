import assert from 'node:assert/strict';
import test from 'node:test';
import { mapRunnerTrade, runnerStats } from '../../system/health.js';

test('direct runner fallback maps paper facts and calculates its bounded sample', () => {
  const open = mapRunnerTrade({ id: 1, asset_pair: 'BTCUSDT', outcome: 'SHORT', status: 'open', entry_price: '100', target_price: '90', stop_price: '105', opened_at: '2026-09-08T00:00:00Z', trade_type: 'crypto_futures_breakout_short', leverage: '2', capital_used: '25' });
  const win = mapRunnerTrade({ id: 2, asset_pair: 'ETHUSDT', outcome: 'LONG', status: 'closed', pnl: '4', opened_at: '2026-09-08T00:00:00Z', closed_at: '2026-09-08T01:00:00Z' });
  const loss = mapRunnerTrade({ id: 3, asset_pair: 'SOLUSDT', outcome: 'LONG', status: 'closed', pnl: '-2', opened_at: '2026-09-08T01:00:00Z', closed_at: '2026-09-08T02:00:00Z' });
  assert.equal(open.mode, 'paper'); assert.equal(open.side, 'SHORT'); assert.equal(open.entryPrice, 100); assert.equal(open.pnl, null);
  assert.deepEqual(runnerStats([open, win, loss]), { sampleTrades: 3, sampleClosed: 2, openPositions: 1, sampleRealizedPnl: 2, sampleWinRate: 0.5, profitFactor: 2, expectancy: 1, maxDrawdown: 2, windowLimit: 160 });
});
