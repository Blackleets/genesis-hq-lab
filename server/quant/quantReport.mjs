// quantReport.mjs — human-readable quant lab summary.
// Answers: "Do we have edge? If yes, how much capital paper? If no, why not?"

import { getQuantState } from './quantState.mjs';

/**
 * Generate a structured quant readiness report.
 *
 * @returns {{ headline, edgeAnswer, strategies, blockers, allocation, dataMode, updatedAt }}
 */
export function generateQuantReport() {
  const state = getQuantState();

  const { edgeVerdict, registry, validation, allocation } = state;

  // ── Headline ──────────────────────────────────────────────────────────────
  const headline = buildHeadline(edgeVerdict, allocation);

  // ── Strategy summary ──────────────────────────────────────────────────────
  const strategies = registry?.strategies?.map((s) => ({
    strategyId:   s.strategyId,
    name:         s.name,
    status:       s.status,
    trades:       s.live?.trades ?? null,
    profitFactor: s.live?.profitFactor ?? null,
    winRate:      s.live?.winRate ?? null,
    avgPnl:       s.live?.avgPnl ?? null,
    note:         s.note ?? null,
  })) ?? [];

  // ── Blockers ──────────────────────────────────────────────────────────────
  const blockers = (validation?.reasons ?? []).map((r) => ({
    reason: r,
    code:   validation?.checks?.find((c) => !c.pass && c.detail === r)?.code ?? 'UNKNOWN',
  }));

  // ── Allocation summary ────────────────────────────────────────────────────
  const allocationSummary = allocation ? {
    blocked:           allocation.blocked,
    blockReason:       allocation.reason,
    totalAllocatedPct: allocation.totalAllocatedPct,
    totalAllocatedUsd: allocation.totalAllocatedUsd,
    availableCapital:  allocation.availableCapital,
    topAllocations:    (allocation.allocations ?? [])
      .filter((a) => a.recommendedCapitalPct > 0)
      .slice(0, 5),
  } : null;

  return {
    headline,
    edgeAnswer:  edgeVerdict?.answer ?? 'UNKNOWN',
    edgeReason:  edgeVerdict?.reason ?? null,
    strategies,
    blockers,
    allocation:  allocationSummary,
    metrics: {
      totalStrategies: registry?.summary?.total ?? 0,
      byStatus:        registry?.summary?.byStatus ?? {},
      ...validation?.metrics,
    },
    dataMode: validation?.dataMode ?? 'REAL_DATA',
    errors:   state.errors,
    updatedAt: state.updatedAt,
  };
}

function buildHeadline(edgeVerdict, allocation) {
  const ans = edgeVerdict?.answer;
  if (ans === 'YES') {
    const pct = allocation?.totalAllocatedPct ?? 0;
    const usd = allocation?.totalAllocatedUsd ?? 0;
    return `EDGE VALIDATED — ${edgeVerdict.promotedCount} strategy promoted. Recommended paper capital: ${(pct * 100).toFixed(1)}% ($${usd}).`;
  }
  if (ans === 'WF_VALIDATED') return `OOS EDGE HISTÓRICO VALIDADO — ${edgeVerdict.reason}`;
  if (ans === 'NO') return `SIN EDGE — ${edgeVerdict.reason}`;
  return 'EDGE DESCONOCIDO — datos insuficientes o error del motor.';
}
