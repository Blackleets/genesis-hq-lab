export const EDGE_INTELLIGENCE_VERSION = 'edge_intelligence_shadow_v1';

const finite = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round = (v, d = 6) => Number.isFinite(v) ? Math.round(v * (10 ** d)) / (10 ** d) : null;
const mean = (a) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;

export const DEFAULT_EDGE_POLICY = Object.freeze({
  minClosedPerSegment: 12,
  preferredClosedPerSegment: 20,
  minProfitFactor: 1.05,
  preferredProfitFactor: 1.20,
  minExpectancyUsd: 0,
  minWinRate: 0.35,
  maxWinnerLostRate: 0.20,
  minPositiveRegimeTrades: 8,
});

export function normalizeEdgeTrade(row) {
  const pnl = finite(row.realized_net_pnl_usd);
  const mfe = Math.max(0, finite(row.mfe_net_usd) ?? 0);
  return {
    strategyVersionId: String(row.strategy_version_id || 'UNATTRIBUTED'),
    pair: String(row.asset_pair || 'UNATTRIBUTED').toUpperCase(),
    side: String(row.side || 'UNATTRIBUTED').toUpperCase(),
    regime: String(row.entry_regime || row.activation_regime || row.close_regime || 'UNATTRIBUTED'),
    session: String(row.entry_session || 'UNATTRIBUTED'),
    exitReason: String(row.exit_reason || 'UNATTRIBUTED'),
    pnl,
    mfe,
    winnerLost: pnl != null && mfe >= 5 && pnl <= 0,
    closed: Boolean(row.closed_at) && pnl != null,
  };
}

export function summarizeEconomicEdge(rows) {
  const closed = rows.map(normalizeEdgeTrade).filter((r) => r.closed);
  const pnls = closed.map((r) => r.pnl);
  const wins = pnls.filter((v) => v > 0);
  const losses = pnls.filter((v) => v < 0);
  const grossProfit = wins.reduce((s, v) => s + v, 0);
  const grossLoss = Math.abs(losses.reduce((s, v) => s + v, 0));
  const realizedPnl = pnls.reduce((s, v) => s + v, 0);
  const significantMfe = closed.filter((r) => r.mfe >= 5);
  const winnerLost = closed.filter((r) => r.winnerLost);
  return {
    closed: closed.length,
    realizedPnl: round(realizedPnl, 4),
    expectancyUsd: closed.length ? round(realizedPnl / closed.length, 6) : null,
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 6) : (grossProfit > 0 ? Infinity : null),
    winRate: closed.length ? round(wins.length / closed.length, 6) : null,
    avgWin: round(mean(wins), 6),
    avgLoss: round(mean(losses), 6),
    winnerLostRate: significantMfe.length ? round(winnerLost.length / significantMfe.length, 6) : null,
    economicsBasis: 'persisted_realized_net_pnl_after_available_fees_slippage_funding',
  };
}

function segmentKey(row) {
  const t = normalizeEdgeTrade(row);
  return [t.strategyVersionId, t.side, t.regime, t.session].join('|');
}

function verdictFor(metrics, policy) {
  if (metrics.closed < policy.minClosedPerSegment) {
    return { verdict: 'INSUFFICIENT_EVIDENCE', score: 0, reason: 'segment_sample_below_minimum' };
  }
  if (metrics.expectancyUsd == null || metrics.expectancyUsd <= policy.minExpectancyUsd) {
    return { verdict: 'NO_TRADE_SHADOW', score: -2, reason: 'non_positive_net_expectancy' };
  }
  if (metrics.profitFactor == null || metrics.profitFactor < policy.minProfitFactor) {
    return { verdict: 'NO_TRADE_SHADOW', score: -2, reason: 'profit_factor_below_floor' };
  }
  if (metrics.winRate != null && metrics.winRate < policy.minWinRate) {
    return { verdict: 'NO_TRADE_SHADOW', score: -1, reason: 'win_rate_below_floor' };
  }
  if (metrics.winnerLostRate != null && metrics.winnerLostRate > policy.maxWinnerLostRate) {
    return { verdict: 'NO_TRADE_SHADOW', score: -1, reason: 'winner_protection_failure_rate_high' };
  }
  const strong = metrics.closed >= policy.preferredClosedPerSegment
    && metrics.profitFactor >= policy.preferredProfitFactor
    && metrics.expectancyUsd > 0;
  return {
    verdict: 'ALLOW_SHADOW',
    score: strong ? 2 : 1,
    reason: strong ? 'positive_edge_preferred_thresholds' : 'positive_edge_minimum_thresholds',
  };
}

export function buildEdgeIntelligence(rows = [], policy = DEFAULT_EDGE_POLICY) {
  const v9 = rows.filter((r) => String(r.strategy_version_id || '').endsWith(':v9'));
  const groups = new Map();
  for (const row of v9) {
    const key = segmentKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const segments = {};
  for (const [key, sample] of groups) {
    const metrics = summarizeEconomicEdge(sample);
    segments[key] = { metrics, ...verdictFor(metrics, policy) };
  }

  const overall = summarizeEconomicEdge(v9);
  const segmentValues = Object.values(segments);
  const positiveSegments = segmentValues.filter((s) => s.verdict === 'ALLOW_SHADOW').length;
  const blockedSegments = segmentValues.filter((s) => s.verdict === 'NO_TRADE_SHADOW').length;

  let systemVerdict = 'ACCUMULATE_EVIDENCE';
  if (overall.closed >= 20 && overall.expectancyUsd != null && overall.expectancyUsd < 0 && overall.profitFactor != null && overall.profitFactor <= 0.9) {
    systemVerdict = 'QUARANTINE_CANDIDATE';
  } else if (positiveSegments > 0) {
    systemVerdict = 'SELECTIVE_SHADOW_EDGE_PRESENT';
  }

  return {
    intelligenceVersion: EDGE_INTELLIGENCE_VERSION,
    mode: 'SHADOW_READ_ONLY',
    executionAuthority: false,
    liveOrders: false,
    strategyScope: 'v9_only',
    policy,
    overall,
    segments,
    counts: { segments: segmentValues.length, positiveSegments, blockedSegments },
    systemVerdict,
    invariants: {
      modifiesRunnerParameters: false,
      modifiesStrategyVersions: false,
      opensTrades: false,
      closesTrades: false,
      unlocksLive: false,
      liveLockedRequired: true,
    },
  };
}

export function evaluateCandidate(context, intelligence) {
  const key = [
    String(context.strategyVersionId || 'UNATTRIBUTED'),
    String(context.side || 'UNATTRIBUTED').toUpperCase(),
    String(context.regime || 'UNATTRIBUTED'),
    String(context.session || 'UNATTRIBUTED'),
  ].join('|');
  const segment = intelligence?.segments?.[key];
  if (!segment) return { decision: 'NO_TRADE_SHADOW', reason: 'no_segment_evidence', key };
  if (segment.verdict !== 'ALLOW_SHADOW') return { decision: 'NO_TRADE_SHADOW', reason: segment.reason, key, metrics: segment.metrics };
  return { decision: 'ALLOW_SHADOW', reason: segment.reason, key, metrics: segment.metrics };
}
