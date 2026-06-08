import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildShadowReport, BREAKOUT_SHADOW_CONFIG } from '../crypto/breakoutShadow.mjs';

const config = { ...BREAKOUT_SHADOW_CONFIG, pairs: ['BTCUSDT', 'ETHUSDT'] };

function trade(pair, side, openTime, pnl) {
  return { pair, side, openTime, pnl, capitalUsed: 100, entryPrice: 100, exitPrice: 100 + pnl, exitReason: pnl > 0 ? 'target_hit' : 'stop_loss' };
}

describe('buildShadowReport', () => {
  it('aggregates combined / short / long / per-pair metrics', () => {
    const allTrades = [
      trade('BTCUSDT', 'SHORT', 3, 2),
      trade('BTCUSDT', 'LONG', 1, -1),
      trade('ETHUSDT', 'SHORT', 2, 1),
    ];
    const report = buildShadowReport({ allTrades, currentByPair: [], window: { from: '2026-01-01', to: '2026-06-01' }, config });

    assert.equal(report.combined.trades, 3);
    assert.equal(report.combined.netPnl, 2); // 2 - 1 + 1
    assert.equal(report.short.trades, 2);
    assert.equal(report.long.trades, 1);

    const btc = report.byPair.find((p) => p.pair === 'BTCUSDT');
    const eth = report.byPair.find((p) => p.pair === 'ETHUSDT');
    assert.equal(btc.trades, 2);
    assert.equal(btc.netPnl, 1); // 2 - 1
    assert.equal(eth.trades, 1);
  });

  it('returns recent trades sorted newest-first and capped at 15', () => {
    const allTrades = Array.from({ length: 20 }, (_, i) => trade('BTCUSDT', 'LONG', i, 0.5));
    const report = buildShadowReport({ allTrades, currentByPair: [], window: {}, config });
    assert.equal(report.recent.length, 15);
    assert.equal(report.recent[0].openTime, 19); // newest first
    assert.ok(report.recent[0].openTime > report.recent[1].openTime);
  });

  it('is read-only and self-labelled — never references execution', () => {
    const report = buildShadowReport({ allTrades: [], currentByPair: [], window: {}, config });
    assert.equal(report.mode, 'shadow-observe');
    assert.match(report.note, /[Nn]ever executes/);
    assert.equal(report.combined.trades, 0);
  });
});
