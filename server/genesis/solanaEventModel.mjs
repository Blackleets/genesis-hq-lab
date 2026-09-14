import { createHash } from 'node:crypto';

export const SOLANA_EVENT_TYPES = Object.freeze([
  'SCAN_STARTED',
  'ROUTE_FOUND',
  'QUOTE_RECEIVED',
  'COSTS_CALCULATED',
  'OPPORTUNITY_DETECTED',
  'SIMULATION_STARTED',
  'SIMULATION_PASSED',
  'SIMULATION_FAILED',
  'REJECTED',
  'PAPER_EXECUTED',
  'CAPTURE_MEASURED',
  'FAILED',
]);

const MODES = new Set(['SHADOW', 'PAPER', 'LIVE']);

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

export function solanaEventId({ runId, type, sequence, route = '' }) {
  const material = `${runId}|${type}|${sequence}|${route}`;
  return `sol-${createHash('sha256').update(material).digest('hex').slice(0, 24)}`;
}

export function createSolanaEvent({ runId, type, sequence, timestamp = new Date().toISOString(), mode = 'SHADOW', ...input }) {
  if (!runId || typeof runId !== 'string') throw new Error('run_id_required');
  if (!SOLANA_EVENT_TYPES.includes(type)) throw new Error('invalid_solana_event_type');
  if (!MODES.has(mode)) throw new Error('invalid_execution_mode');

  const route = typeof input.route === 'string' ? input.route.slice(0, 320) : null;
  const event = {
    runId,
    eventId: solanaEventId({ runId, type, sequence, route: route ?? '' }),
    id: solanaEventId({ runId, type, sequence, route: route ?? '' }),
    timestamp,
    observedAt: timestamp,
    recordedAt: timestamp,
    type,
    chain: 'SOLANA',
    mode,
    executionAuthority: false,
    liveLocked: true,
    route,
    tokens: cleanStrings(input.tokens),
    mints: cleanStrings(input.mints),
    venues: cleanStrings(input.venues),
    inputAmountUsd: finiteOrNull(input.inputAmountUsd ?? input.inputUsdc),
    inputUsdc: finiteOrNull(input.inputAmountUsd ?? input.inputUsdc),
    quotedOutputUsd: finiteOrNull(input.quotedOutputUsd ?? input.quotedEndUsdc),
    grossEdgeBps: finiteOrNull(input.grossEdgeBps),
    quotedEdgeBps: finiteOrNull(input.quotedEdgeBps),
    totalCostBps: finiteOrNull(input.totalCostBps),
    netEdgeBps: finiteOrNull(input.netEdgeBps),
    expectedNetPnlUsd: finiteOrNull(input.expectedNetPnlUsd ?? input.netPnlUsd),
    netPnlUsd: finiteOrNull(input.expectedNetPnlUsd ?? input.netPnlUsd),
    capturedNetPnlUsd: finiteOrNull(input.capturedNetPnlUsd),
    capturedEdgeBps: finiteOrNull(input.capturedEdgeBps),
    captureRatio: finiteOrNull(input.captureRatio),
    estimatedCosts: input.estimatedCosts && typeof input.estimatedCosts === 'object' ? input.estimatedCosts : null,
    priorityFeeUsd: finiteOrNull(input.priorityFeeUsd),
    baseFeeUsd: finiteOrNull(input.baseFeeUsd),
    dexFeesUsd: finiteOrNull(input.dexFeesUsd),
    jitoTipUsd: finiteOrNull(input.jitoTipUsd),
    slippageReserveUsd: finiteOrNull(input.slippageReserveUsd),
    failureReserveUsd: finiteOrNull(input.failureReserveUsd),
    priceImpactBps: finiteOrNull(input.priceImpactBps),
    slotDrift: finiteOrNull(input.slotDrift),
    actualFeesUsd: finiteOrNull(input.actualFeesUsd),
    actualOutputUsd: finiteOrNull(input.actualOutputUsd),
    actualSlippageBps: finiteOrNull(input.actualSlippageBps),
    marketRegime: typeof input.marketRegime === 'string' ? input.marketRegime.slice(0, 80) : null,
    simulationResult: input.simulationResult && typeof input.simulationResult === 'object' ? input.simulationResult : null,
    decision: typeof input.decision === 'string' ? input.decision.slice(0, 80) : null,
    reason: typeof input.reason === 'string' ? input.reason.slice(0, 240) : null,
    blockers: cleanStrings(input.blockers),
    latencyMs: finiteOrNull(input.latencyMs ?? input.quoteLatencyMs),
    quoteLatencyMs: finiteOrNull(input.latencyMs ?? input.quoteLatencyMs),
    slot: finiteOrNull(input.slot),
  };
  return Object.freeze(event);
}

export function deduplicateSolanaEvents(events) {
  const byId = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    if (!event?.eventId && !event?.id) continue;
    const id = event.eventId ?? event.id;
    if (!byId.has(id)) byId.set(id, event);
  }
  return [...byId.values()];
}
