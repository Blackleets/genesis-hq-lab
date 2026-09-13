// Public chain evidence only. Never publish RPC errors, credentials or raw payloads.
export function buildHostedSnapshot(result, previous = null, now = new Date().toISOString()) {
  if (result?.executionAuthority === true || (result?.mode && result.mode !== 'SHADOW')) {
    throw new Error('shadow_only');
  }
  const rows = [...(result?.evaluation?.candidates ?? []), ...(result?.evaluation?.rejected ?? [])];
  const numeric = (value) => Number.isFinite(value) ? value : null;
  const routes = rows.map((row) => ({
    route: String(row.routeId ?? `${row.buyDex}->${row.sellDex}`).slice(0, 180),
    netPnlUsd: numeric(row.netPnlUsd),
    grossPnlUsd: numeric(row.grossPnlUsd),
    totalCostsUsd: numeric(row.totalCostsUsd),
    expectedNetPnlUsd: numeric(row.expectedNetPnlUsd),
    stressNetPnlUsd: numeric(row.stressNetPnlUsd),
    netEdgeBps: numeric(row.netEdgeBps),
    status: row.verdict === 'SHADOW_CANDIDATE' ? 'qualified' : 'filtered',
    blockers: (row.blockers ?? []).map(String).slice(0, 20),
    capturedAt: result?.capturedAt ?? now,
  })).sort((a, b) => (b.netPnlUsd ?? -Infinity) - (a.netPnlUsd ?? -Infinity));
  const observing = result?.ok === true && Number(result.routesQuoted) > 0;
  const point = {
    capturedAt: result?.capturedAt ?? now,
    blockNumber: result?.blockNumber ?? null,
    routesQuoted: observing ? result.routesQuoted : 0,
    bestNetPnlUsd: routes[0]?.netPnlUsd ?? null,
    positiveRoutes: routes.filter((r) => r.netPnlUsd > 0).length,
  };
  const history = Array.isArray(previous?.history) ? previous.history.slice(-95).map((p) => ({
    capturedAt: p.capturedAt, blockNumber: p.blockNumber, routesQuoted: numeric(p.routesQuoted),
    bestNetPnlUsd: numeric(p.bestNetPnlUsd), positiveRoutes: numeric(p.positiveRoutes),
  })) : [];
  if (!history.some((p) => p.blockNumber === point.blockNumber && p.capturedAt === point.capturedAt)) history.push(point);
  return {
    mode: 'SHADOW', executionAuthority: false, source: 'github_periodic_observer',
    status: observing ? 'observing' : 'degraded', providerConfigured: observing,
    chainId: 1, blockNumber: point.blockNumber, updatedAt: now,
    routesScanned: result?.routesScanned ?? 0, routesQuoted: point.routesQuoted,
    evaluated: rows.length, qualified: routes.filter((r) => r.status === 'qualified').length,
    filtered: routes.filter((r) => r.status === 'filtered').length,
    bestNetPnlUsd: point.bestNetPnlUsd, positiveRoutes: point.positiveRoutes,
    theoreticalExpectedNetPnlUsd: null, theoreticalStressNetPnlUsd: null, medianNetEdgeBps: null,
    topRoutes: routes.slice(0, 8), history,
    error: observing ? null : 'observation_unavailable',
    paperStatus: 'awaiting_execution_evidence', paperRealizedPnlUsd: null,
    note: 'Periodic real quotes; no executed paper fills or realized profit. Capture and atomic execution remain unproven.',
  };
}
