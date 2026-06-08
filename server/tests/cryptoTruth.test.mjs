import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import db from '../db/database.mjs';
import { getCryptoOverview } from '../crypto/cryptoAnalytics.mjs';
import { getAutopsy } from '../crypto/autoVeto.mjs';
import { dailyCryptoRealizedPnl, lastClosedCryptoTrade } from '../crypto/cryptoRisk.mjs';
import { CRYPTO_TRADE_TYPES_SQL, getClosedCryptoMetrics } from '../crypto/cryptoTradeUniverse.mjs';
import { getCryptoLlmStatus } from '../crypto/cryptoLlmStatus.mjs';
import { runCryptoDebate } from '../crypto/cryptoDebate.mjs';
import { runRegimeBiasBacktest } from '../crypto/backtest/regimeBiasBacktest.mjs';

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

  it('autopsy recommends change_or_pause_strategy after enough negative closed trades', () => {
    const autopsy = getAutopsy();
    const metrics = getClosedCryptoMetrics();
    if (metrics.trades >= 40 && metrics.expectancy < 0 && metrics.profitFactor < 1) {
      assert.equal(autopsy.recommendation.action, 'change_or_pause_strategy');
      assert.equal(autopsy.recommendation.triggered, true);
    }
  });

  it('autopsy exposes breakdown slices for toxic segments', () => {
    const autopsy = getAutopsy();
    assert.ok(autopsy.breakdown);
    assert.ok(Array.isArray(autopsy.breakdown.byPair));
    assert.ok(Array.isArray(autopsy.breakdown.bySide));
    assert.ok(Array.isArray(autopsy.breakdown.byRegime));
    assert.ok(Array.isArray(autopsy.breakdown.byHour));
    assert.ok(Array.isArray(autopsy.breakdown.byConfidenceBand));
  });

  it('autopsy exposes candidateActions as an ordered plan', () => {
    const autopsy = getAutopsy();
    assert.ok(Array.isArray(autopsy.candidateActions));
    for (let i = 1; i < autopsy.candidateActions.length; i++) {
      assert.ok(autopsy.candidateActions[i - 1].priority <= autopsy.candidateActions[i].priority);
    }
  });

  it('manual blocked setups are exposed in config and SHORT_BEAR is blocked', () => {
    const autopsy = getAutopsy();
    assert.ok(Array.isArray(autopsy.config.manualBlockedSetups));
    assert.ok(autopsy.config.manualBlockedSetups.includes('SHORT_BEAR'));
    assert.ok(Array.isArray(autopsy.config.manualBlockedHours));
    assert.ok(autopsy.config.manualBlockedHours.includes('16'));
    assert.ok(Array.isArray(autopsy.config.manualBlockedConfidenceBands));
    assert.ok(Array.isArray(autopsy.config.manualBlockedPairs));
  });

  it('regime backtest BEFORE metrics use the canonical closed crypto trade universe', async () => {
    const canonical = getClosedCryptoMetrics();
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      json: async () => Array.from({ length: 360 }, (_, i) => {
        const price = 100 + i * 0.1;
        return [Date.now() - ((360 - i) * 60_000), `${price}`, `${price}`, `${price}`, `${price}`, '1'];
      }),
    });

    try {
      const backtest = await runRegimeBiasBacktest();
      assert.equal(backtest.before.trades, canonical.trades);
      assert.equal(backtest.before.expectancy, canonical.expectancy);
      assert.equal(backtest.before.profitFactor, canonical.profitFactor);
      assert.equal(backtest.before.winRate, Math.round((canonical.winRate ?? 0) * 1000) / 10);
    } finally {
      global.fetch = originalFetch;
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
