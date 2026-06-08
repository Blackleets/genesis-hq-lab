import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import db from '../db/database.mjs';
import { getCryptoOverview } from '../crypto/cryptoAnalytics.mjs';
import { getAutopsy } from '../crypto/autoVeto.mjs';
import { dailyCryptoRealizedPnl, lastClosedCryptoTrade } from '../crypto/cryptoRisk.mjs';
import { CRYPTO_TRADE_TYPES_SQL, getClosedCryptoMetrics } from '../crypto/cryptoTradeUniverse.mjs';
import { getCryptoLlmStatus } from '../crypto/cryptoLlmStatus.mjs';
import { runCryptoDebate } from '../crypto/cryptoDebate.mjs';

function utcMidnightIso(nowMs) {
  const d = new Date(nowMs);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

describe('crypto truth consistency', () => {
  it('overview closed total matches autopsy totalSamples', () => {
    const overview = getCryptoOverview();
    const autopsy = getAutopsy();
    assert.equal(overview.pnl.closed.total, autopsy.totalSamples);
  });

  it('cryptoRisk daily realized pnl uses the canonical crypto trade universe', () => {
    const nowMs = Date.now();
    const expected = db.prepare(`
      SELECT COALESCE(SUM(pnl), 0) AS s
      FROM trades
      WHERE trade_type IN ${CRYPTO_TRADE_TYPES_SQL} AND status='closed' AND closed_at >= ?
    `).get(utcMidnightIso(nowMs))?.s ?? 0;

    assert.equal(dailyCryptoRealizedPnl(nowMs), expected);
  });

  it('cryptoRisk lastClosedCryptoTrade reads from the canonical crypto trade universe', () => {
    const latest = db.prepare(`
      SELECT asset_pair
      FROM trades
      WHERE trade_type IN ${CRYPTO_TRADE_TYPES_SQL} AND status='closed' AND asset_pair IS NOT NULL
      ORDER BY closed_at DESC LIMIT 1
    `).get();

    if (!latest?.asset_pair) return;

    const expected = db.prepare(`
      SELECT pnl, closed_at
      FROM trades
      WHERE trade_type IN ${CRYPTO_TRADE_TYPES_SQL} AND status='closed' AND asset_pair = ?
      ORDER BY closed_at DESC LIMIT 1
    `).get(latest.asset_pair);

    assert.deepEqual(lastClosedCryptoTrade(latest.asset_pair), expected);
  });

  it('autopsy edgeSummary verdict is negative when expectancy is negative and PF < 1', () => {
    const autopsy = getAutopsy();
    const metrics = getClosedCryptoMetrics();
    if (metrics.expectancy < 0 && metrics.profitFactor < 1) {
      assert.equal(autopsy.edgeSummary.verdict, 'negative');
    }
  });
});

describe('crypto debate llm status', () => {
  it('records fallbackActive and provider error when Anthropic returns 4xx', async () => {
    const originalFetch = global.fetch;
    const originalKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-key';
    global.fetch = async () => ({
      ok: false,
      status: 402,
      text: async () => 'credit balance too low',
    });

    try {
      const result = await runCryptoDebate({
        symbol: 'BTC',
        pair: 'BTCUSDT',
        price: 63000,
        ema9: 63100,
        ema21: 62950,
        trend: 'bullish',
        rsi14: 56,
        change1h: 0.45,
        change24h: 1.2,
        volume24h: 2_000_000,
      }, [], 'LONG');

      assert.equal(result.action, 'TRADE');
      const status = getCryptoLlmStatus();
      assert.equal(status.configured, true);
      assert.equal(status.available, false);
      assert.equal(status.fallbackActive, true);
      assert.match(status.lastProviderError ?? '', /credit balance too low/i);
    } finally {
      global.fetch = originalFetch;
      if (originalKey == null) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = originalKey;
    }
  });
});
