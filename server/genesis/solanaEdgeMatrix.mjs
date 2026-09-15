import { pathToFileURL } from 'node:url';
import {
  SOLANA_EXECUTION_AUTHORITY,
  SOLANA_LIVE_LOCKED,
  getSolanaArbitrageConfig,
  observeSolanaArbitrageOnce,
} from './solanaArbitrageObserver.mjs';

export const SOLANA_EDGE_MATRIX_POLICY = Object.freeze({
  version: 'solana-edge-matrix-v1', mode: 'SHADOW', executionAuthority: false,
  liveLocked: true, infraTier: 'FREE_ONLY',
});

const DEFAULT_NOTIONALS_USDC = Object.freeze([10, 25, 50, 100, 250, 500]);

export function parseNotionalLadder(value) {
  const source = Array.isArray(value) ? value : String(value ?? '').split(',');
  const parsed = source.map(Number)
    .filter((amount) => Number.isFinite(amount) && amount >= 1 && amount <= 10_000);
  return [...new Set(parsed)].sort((a, b) => a - b).slice(0, 12);
}

export function getSolanaEdgeMatrixConfig(env = process.env) {
  const configured = parseNotionalLadder(env.GENESIS_SOLANA_ARB_NOTIONALS_USDC);
  return {
    base: getSolanaArbitrageConfig(env),
    notionalsUsdc: configured.length ? configured : [...DEFAULT_NOTIONALS_USDC],
    policy: SOLANA_EDGE_MATRIX_POLICY,
  };
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function summarizeMatrixResult(result, notionalUsdc) {
  const economics = result?.observation?.economics ?? {};
  const quotedProfitUsd = finite(economics.quotedRoundTripProfitUsd);
  const netPnlUsd = finite(economics.netPnlUsd);
  const observedInputUsdc = finite(result?.observation?.inputUsdc) ?? notionalUsdc;
  const estimatedCostUsd = quotedProfitUsd !== null && netPnlUsd !== null
    ? quotedProfitUsd - netPnlUsd : null;
  const breakEvenQuotedEdgeBps = estimatedCostUsd !== null && observedInputUsdc > 0
    ? (estimatedCostUsd / observedInputUsdc) * 10_000 : null;
  const preSimulationBlockers = (result?.observation?.blockers ?? [])
    .filter((blocker) => !['atomic_simulation_missing', 'capture_evidence_missing'].includes(blocker));
  return {
    notionalUsdc: observedInputUsdc,
    status: result?.status ?? 'FAILED', ok: result?.ok === true,
    quotedProfitUsd, quotedEdgeBps: finite(economics.quotedRoundTripEdgeBps),
    estimatedCostUsd, breakEvenQuotedEdgeBps, netPnlUsd,
    netEdgeBps: finite(economics.netEdgeBps), priceImpactBps: finite(economics.priceImpactBps),
    priorityFeeUsd: finite(economics.priorityFeeUsd),
    quoteLatencyMs: finite(result?.observation?.quoteLatencyMs),
    slotDrift: finite(result?.observation?.slotDrift),
    venues: result?.observation?.venues ?? null, preSimulationBlockers,
    simulationAttempted: result?.observation?.atomicSimulation?.attempted === true,
    simulationPassed: result?.observation?.atomicSimulation?.success === true,
    error: result?.error ?? null,
  };
}

export function summarizeOpportunityFunnel(rows) {
  return {
    scanned: rows.length,
    quoteSucceeded: rows.filter((row) => row.ok).length,
    quotedPositive: rows.filter((row) => row.quotedProfitUsd > 0).length,
    netPositive: rows.filter((row) => row.netPnlUsd > 0).length,
    economicallyQualified: rows.filter((row) => row.netPnlUsd > 0 && row.preSimulationBlockers.length === 0).length,
    simulated: rows.filter((row) => row.simulationAttempted).length,
    paperCaptured: rows.filter((row) => row.status === 'PAPER_EXECUTED').length,
  };
}

export async function scanSolanaEdgeMatrix({ config = getSolanaEdgeMatrixConfig(), observer = observeSolanaArbitrageOnce } = {}) {
  const startedAt = new Date().toISOString();
  const rows = [];
  for (const notionalUsdc of config.notionalsUsdc) {
    try {
      const result = await observer({ config: { ...config.base, notionalUsdc } });
      rows.push(summarizeMatrixResult(result, notionalUsdc));
    } catch (error) {
      rows.push(summarizeMatrixResult({ ok: false, status: 'FAILED', error: String(error?.message ?? error) }, notionalUsdc));
    }
  }
  const ranked = rows.filter((row) => row.netPnlUsd !== null).sort((a, b) => b.netPnlUsd - a.netPnlUsd);
  const best = ranked[0] ?? null;
  return {
    version: SOLANA_EDGE_MATRIX_POLICY.version, startedAt, completedAt: new Date().toISOString(),
    mode: 'SHADOW', executionAuthority: SOLANA_EXECUTION_AUTHORITY, liveLocked: SOLANA_LIVE_LOCKED,
    policy: config.policy, routeFamily: 'USDC → SOL → USDC',
    verdict: rows.every((row) => !row.ok)
      ? 'DATA_UNAVAILABLE'
      : (best?.netPnlUsd > 0 && best.preSimulationBlockers.length === 0
        ? 'ECONOMIC_CANDIDATE' : 'NO_CAPTURABLE_EDGE_OBSERVED'),
    funnel: summarizeOpportunityFunnel(rows), best,
    rows: rows.sort((a, b) => a.notionalUsdc - b.notionalUsdc),
  };
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) process.stdout.write(`${JSON.stringify(await scanSolanaEdgeMatrix(), null, 2)}\n`);
