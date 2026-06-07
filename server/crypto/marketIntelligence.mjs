// marketIntelligence.mjs — Market intelligence aggregation for Crypto Lab 2.0.
// Derives momentum, volatility, trend, regime, and recommendation from live system state.
// Read-only. Never mutates state.

import db from '../db/database.mjs';
import { getGlobalRiskDiagnostics } from '../risk/globalRiskEngine.mjs';
import { getConfidenceDiagnostics } from '../intelligence/confidenceEngine.mjs';
import { getTimeline } from '../observability/eventTimeline.mjs';
import { getOrderFlowState } from './liquidityMatrix.mjs';

// ── Market Intelligence ────────────────────────────────────────────────────────

/**
 * Aggregates system signals into a human-readable market intelligence snapshot.
 * Derived entirely from real system state — no fake or synthetic values.
 */
export function getMarketIntelligence() {
  let riskBand = 'HEALTHY', riskScore = 0, safeMode = false;
  let confScore = 0, confBand = 'LOW_CONFIDENCE';

  try {
    const r = getGlobalRiskDiagnostics();
    riskBand = r.band ?? 'HEALTHY';
    riskScore = r.score ?? 0;
    safeMode  = r.safeMode ?? false;
  } catch { /* non-fatal */ }

  try {
    const c = getConfidenceDiagnostics();
    confScore = c.lastScore ?? 0;
    confBand  = c.lastBand  ?? 'LOW_CONFIDENCE';
  } catch { /* non-fatal */ }

  // Recent crypto trade directions (last 3 hours) — for momentum derivation
  const recent = (() => {
    try {
      return db.prepare(`
        SELECT outcome, pnl, opened_at
        FROM trades
        WHERE trade_type IN ('crypto_scalp', 'scalp_v2', 'swing_v1')
        AND opened_at > datetime('now', '-3 hours')
        ORDER BY opened_at DESC LIMIT 20
      `).all();
    } catch { return []; }
  })();

  const longs  = recent.filter(t => t.outcome === 'LONG').length;
  const shorts = recent.filter(t => t.outcome === 'SHORT').length;
  const total  = recent.length;

  // Momentum: direction bias of recent signals
  const momentum = total === 0 ? 'Neutral'
    : longs  > shorts * 1.5 ? 'Bullish'
    : shorts > longs  * 1.5 ? 'Bearish' : 'Neutral';

  // Volatility: trade signal frequency (higher freq = more volatile market)
  const volatility = total >= 8 ? 'High' : total >= 3 ? 'Medium' : 'Low';

  // Recent win rate (last 6h closed trades) — for trend quality
  const recentClosed = (() => {
    try {
      return db.prepare(`
        SELECT pnl FROM trades
        WHERE trade_type IN ('crypto_scalp', 'scalp_v2', 'swing_v1')
        AND status = 'closed'
        AND closed_at > datetime('now', '-6 hours')
        ORDER BY closed_at DESC LIMIT 10
      `).all();
    } catch { return []; }
  })();

  const wins    = recentClosed.filter(t => (t.pnl ?? 0) > 0).length;
  const winRate = recentClosed.length > 0 ? wins / recentClosed.length : null;

  const trend = winRate === null ? 'Unknown'
    : winRate >= 0.6 ? 'Strong'
    : winRate >= 0.45 ? 'Weak' : 'Mixed';

  // Regime from global risk band
  const regime = riskBand === 'CRITICAL' || riskBand === 'HIGH_RISK' ? 'Risk-Off'
    : riskBand === 'ELEVATED' ? 'Swing' : 'Scalp';

  // Recommendation: synthesized from risk + confidence + momentum
  let recommendation;
  if (safeMode || riskBand === 'CRITICAL') {
    recommendation = 'WAIT';
  } else if (confBand === 'BLOCK' || confBand === 'LOW_CONFIDENCE') {
    recommendation = 'WAIT';
  } else if (confBand === 'HIGH_CONVICTION' && (riskBand === 'HEALTHY' || riskBand === 'WATCH')) {
    recommendation = momentum === 'Bullish' ? 'LONG' : momentum === 'Bearish' ? 'SHORT' : 'WATCH';
  } else if (confBand === 'GOOD_SETUP' || confBand === 'CAUTION') {
    recommendation = 'WATCH';
  } else {
    recommendation = 'WAIT';
  }

  const orderFlow = (() => {
    try {
      const of = getOrderFlowState();
      if (!of) return null;
      return {
        imbalance: of.imbalance,
        reading:   of.reading,
        signals:   of.signals,
        pair:      of.pair,
        ts:        of.ts,
      };
    } catch { return null; }
  })();

  return {
    momentum,
    volatility,
    trend,
    regime,
    recommendation,
    confidence: { score: confScore, band: confBand },
    risk: { band: riskBand, score: riskScore, safeMode },
    activity: {
      signalsLast3h: total,
      longs,
      shorts,
      recentWinRate: winRate !== null ? Math.round(winRate * 100) / 100 : null,
    },
    orderFlow,
  };
}

// ── Crypto Feed Events ────────────────────────────────────────────────────────

/**
 * Returns a merged feed of:
 *   1. Real system events from the operator_events table (all categories)
 *   2. Synthetic events derived from recent crypto trade activity
 *
 * Sorted by timestamp DESC. No duplicates. Max `limit` events total.
 */
export function getCryptoFeedEvents(limit = 60) {
  // 1. Real timeline events — all categories, last 48h, limit 40
  const timelineEvents = (() => {
    try {
      return getTimeline({
        limit: 40,
        since: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      });
    } catch { return []; }
  })();

  // 2. Synthetic events from recent trade activity (last 24h)
  const recentTrades = (() => {
    try {
      return db.prepare(`
        SELECT id, asset_pair, outcome, entry_price, exit_price, pnl,
               exit_reason, opened_at, closed_at, status, confidence, trade_type
        FROM trades
        WHERE trade_type IN ('crypto_scalp', 'scalp_v2', 'swing_v1')
        AND (
          opened_at > datetime('now', '-24 hours')
          OR closed_at > datetime('now', '-24 hours')
        )
        ORDER BY COALESCE(closed_at, opened_at) DESC
        LIMIT 40
      `).all();
    } catch { return []; }
  })();

  const tradeEvents = [];
  for (const t of recentTrades) {
    const pair   = (t.asset_pair ?? 'UNKNOWN').replace('USDT', '');
    const engine = t.trade_type === 'swing_v1' ? 'SWING' : 'SCALP';
    const conf   = ((t.confidence ?? 0) * 100).toFixed(0);

    if (t.status === 'open') {
      tradeEvents.push({
        id:        `open-${t.id}`,
        ts:        t.opened_at,
        category:  'EXECUTION',
        severity:  'INFO',
        subsystem: `${engine.toLowerCase()}-engine`,
        reason:    `${t.outcome} OPENED · ${pair} · conf ${conf}%`,
        metadata:  { pair: t.asset_pair, side: t.outcome, entry: t.entry_price, type: 'open' },
      });
    } else if (t.status === 'closed' && t.closed_at) {
      const exit   = t.exit_reason ?? 'closed';
      const pnlNum = t.pnl ?? 0;
      const pnlStr = pnlNum >= 0 ? `+$${pnlNum.toFixed(2)}` : `-$${Math.abs(pnlNum).toFixed(2)}`;

      const label = exit === 'take_profit'        ? `TP HIT · ${pair} ${pnlStr}`
        : exit === 'stop_loss'                    ? `SL HIT · ${pair} ${pnlStr}`
        : exit === 'timeout'                      ? `TIMEOUT EXIT · ${pair} ${pnlStr}`
        : exit === 'confidence_collapse'          ? `EARLY EXIT (momentum) · ${pair} ${pnlStr}`
        : exit === 'risk_close'                   ? `RISK CLOSE · ${pair} ${pnlStr}`
        : `CLOSED · ${pair} ${pnlStr}`;

      tradeEvents.push({
        id:        `close-${t.id}`,
        ts:        t.closed_at,
        category:  'EXECUTION',
        severity:  pnlNum >= 0 ? 'INFO' : 'WARNING',
        subsystem: `${engine.toLowerCase()}-engine`,
        reason:    label,
        metadata:  { pair: t.asset_pair, side: t.outcome, pnl: t.pnl, exitReason: exit, type: 'close' },
      });
    }
  }

  // Merge, sort by ts DESC, deduplicate by id, slice to limit
  const seen  = new Set();
  const merged = [...timelineEvents, ...tradeEvents]
    .filter(e => {
      if (!e.id || seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    })
    .sort((a, b) => (b.ts ?? '').localeCompare(a.ts ?? ''));

  return merged.slice(0, limit);
}
