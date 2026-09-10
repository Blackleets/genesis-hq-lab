// RESEARCH_ONLY portfolio/risk simulation over candidates that already passed prospective FORWARD PAPER gates.
// This module has no execution authority, never changes production risk gates, and never grants capital eligibility.

import fs from 'node:fs';
import path from 'node:path';

const VERSION = 'portfolio_risk_research_v1';
const FORWARD_LEDGER_VERSION = 'research_forward_shadow_ledger_v1';
const BASE_COST_BPS = 12;
const STRESS_COST_BPS = 18;
const DEFAULT_BUCKET_MS = 60 * 60 * 1000;
const OPEN_SHOCK_BPS = 300;

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function timeMs(value) {
  const n = Date.parse(value ?? '');
  return Number.isFinite(n) ? n : null;
}
function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }
function std(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((sum, x) => sum + (x - m) ** 2, 0) / (xs.length - 1));
}
function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function assertForwardBoundary(snapshot) {
  if (!snapshot || snapshot.mode !== 'FORWARD_PAPER_RESEARCH') throw new Error('forward_snapshot_unavailable_or_unsupported');
  if (snapshot.paperOnly !== true || snapshot.liveOrders !== false || snapshot.executionAuthority !== false || snapshot.capitalEligible !== false) {
    throw new Error('forward_snapshot_capital_boundary_failed');
  }
}

function normalizeTrade(candidate, trade, index) {
  const openedAtMs = timeMs(trade?.openedAt);
  const closedAtMs = timeMs(trade?.closedAt);
  const netBaseBps = finite(trade?.netBaseBps);
  const netStressBps = finite(trade?.netStressBps);
  const direction = Number(trade?.direction);
  if (!Number.isFinite(openedAtMs) || !Number.isFinite(closedAtMs) || closedAtMs < openedAtMs) return null;
  if (netBaseBps === null || netStressBps === null || ![-1, 1].includes(direction)) return null;
  return {
    id: `${candidate.id}:${index}`,
    candidateId: candidate.id,
    symbol: candidate.symbol,
    family: candidate.family,
    openedAt: trade.openedAt,
    closedAt: trade.closedAt,
    openedAtMs,
    closedAtMs,
    direction,
    netBaseBps,
    netStressBps,
  };
}

function admittedCandidates(forwardSnapshot, forwardLedger) {
  const safeLatest = new Map(
    (forwardSnapshot.candidates ?? [])
      .filter(candidate => candidate?.nextStageEligible === true
        && candidate?.liveEligible === false
        && candidate?.executionAuthority === false
        && candidate?.capitalEligible === false)
      .map(candidate => [candidate.id, candidate]),
  );
  const admitted = [];
  for (const [id, latest] of safeLatest) {
    const state = forwardLedger?.candidates?.[id];
    if (!state) continue;
    if (state.paperOnly !== true || state.liveEligible !== false || state.executionAuthority !== false || state.capitalEligible !== false) continue;
    const normalized = (state.closedTrades ?? []).map((trade, index) => normalizeTrade(state, trade, index)).filter(Boolean);
    admitted.push({
      id,
      symbol: state.symbol ?? latest.symbol ?? null,
      family: state.family ?? latest.family ?? null,
      laneType: state.laneType ?? latest.laneType ?? null,
      enrollmentBaselineCapturedAt: state.enrollmentBaselineCapturedAt ?? latest.enrollmentBaselineCapturedAt ?? null,
      lastProcessedCapturedAt: state.lastProcessedCapturedAt ?? latest.lastProcessedCapturedAt ?? null,
      pendingSignal: state.pendingSignal ?? latest.pendingSignal ?? null,
      closedTrades: normalized,
      sourceClosedTrades: (state.closedTrades ?? []).length,
      invalidClosedTrades: Math.max(0, (state.closedTrades ?? []).length - normalized.length),
    });
  }
  admitted.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return admitted;
}

export function simulatePortfolio(candidates = [], field = 'netBaseBps') {
  const count = candidates.length;
  if (!count) {
    return {
      candidateCount: 0,
      tradeCount: 0,
      cumulativeTradeReturnPct: 0,
      portfolioReturnPct: 0,
      maxDrawdownPct: 0,
      weightPerCandidatePct: 0,
    };
  }
  const weight = 1 / count;
  const trades = candidates.flatMap(candidate => candidate.closedTrades.map(trade => ({ ...trade, weight })))
    .filter(trade => finite(trade[field]) !== null)
    .sort((a, b) => a.closedAtMs - b.closedAtMs || a.id.localeCompare(b.id));
  let cumulativeTradeBps = 0;
  let portfolioLogReturn = 0;
  let equity = 1;
  let peak = 1;
  let maxDrawdownPct = 0;
  for (const trade of trades) {
    const r = finite(trade[field]);
    cumulativeTradeBps += r;
    portfolioLogReturn += weight * r / 10_000;
    equity = Math.exp(portfolioLogReturn);
    peak = Math.max(peak, equity);
    maxDrawdownPct = Math.max(maxDrawdownPct, peak > 0 ? ((peak - equity) / peak) * 100 : 0);
  }
  return {
    candidateCount: count,
    tradeCount: trades.length,
    cumulativeTradeReturnPct: cumulativeTradeBps / 100,
    portfolioReturnPct: (Math.exp(portfolioLogReturn) - 1) * 100,
    maxDrawdownPct,
    weightPerCandidatePct: weight * 100,
  };
}

export function concurrencyDiagnostics(candidates = []) {
  if (!candidates.length) {
    return { peakConcurrentTrades: 0, peakConcurrentCandidates: 0, peakGrossExposurePct: 0, peakSymbolExposurePct: 0, peakFamilyExposurePct: 0 };
  }
  const weight = 1 / candidates.length;
  const events = [];
  for (const candidate of candidates) {
    for (const trade of candidate.closedTrades) {
      events.push({ t: trade.openedAtMs, kind: 1, trade });
      events.push({ t: trade.closedAtMs, kind: -1, trade });
    }
  }
  events.sort((a, b) => a.t - b.t || a.kind - b.kind || a.trade.id.localeCompare(b.trade.id));
  const active = new Map();
  let peakConcurrentTrades = 0;
  let peakConcurrentCandidates = 0;
  let peakGrossExposurePct = 0;
  let peakSymbolExposurePct = 0;
  let peakFamilyExposurePct = 0;

  for (const event of events) {
    if (event.kind === 1) active.set(event.trade.id, event.trade);
    else active.delete(event.trade.id);
    const activeTrades = [...active.values()];
    const candidateIds = new Set(activeTrades.map(trade => trade.candidateId));
    const symbolWeights = new Map();
    const familyWeights = new Map();
    for (const candidateId of candidateIds) {
      const candidate = candidates.find(item => item.id === candidateId);
      if (!candidate) continue;
      symbolWeights.set(candidate.symbol, (symbolWeights.get(candidate.symbol) ?? 0) + weight);
      familyWeights.set(candidate.family, (familyWeights.get(candidate.family) ?? 0) + weight);
    }
    peakConcurrentTrades = Math.max(peakConcurrentTrades, activeTrades.length);
    peakConcurrentCandidates = Math.max(peakConcurrentCandidates, candidateIds.size);
    peakGrossExposurePct = Math.max(peakGrossExposurePct, candidateIds.size * weight * 100);
    peakSymbolExposurePct = Math.max(peakSymbolExposurePct, ...[...symbolWeights.values()].map(x => x * 100), 0);
    peakFamilyExposurePct = Math.max(peakFamilyExposurePct, ...[...familyWeights.values()].map(x => x * 100), 0);
  }
  return { peakConcurrentTrades, peakConcurrentCandidates, peakGrossExposurePct, peakSymbolExposurePct, peakFamilyExposurePct };
}

function sampleCovariance(xs, ys) {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const mx = mean(xs), my = mean(ys);
  return xs.reduce((sum, x, i) => sum + (x - mx) * (ys[i] - my), 0) / (xs.length - 1);
}

export function covarianceDiagnostics(candidates = [], { bucketMs = DEFAULT_BUCKET_MS, field = 'netBaseBps' } = {}) {
  if (!candidates.length) return { bucketMs, commonWindow: null, bucketCount: 0, pairs: [], portfolioBucketStdBps: null };
  const starts = candidates.map(candidate => timeMs(candidate.enrollmentBaselineCapturedAt)).filter(Number.isFinite);
  const ends = candidates.map(candidate => timeMs(candidate.lastProcessedCapturedAt)).filter(Number.isFinite);
  if (starts.length !== candidates.length || ends.length !== candidates.length) {
    return { bucketMs, commonWindow: null, bucketCount: 0, pairs: [], portfolioBucketStdBps: null, status: 'INSUFFICIENT_ALIGNED_WINDOW' };
  }
  const startMs = Math.max(...starts);
  const endMs = Math.min(...ends);
  const bucketCount = Math.max(0, Math.floor((endMs - startMs) / bucketMs));
  if (bucketCount < 2) {
    return {
      bucketMs,
      commonWindow: endMs >= startMs ? { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() } : null,
      bucketCount,
      pairs: [],
      portfolioBucketStdBps: null,
      status: 'INSUFFICIENT_ALIGNED_BUCKETS',
    };
  }

  const series = new Map();
  for (const candidate of candidates) {
    const values = Array(bucketCount).fill(0);
    for (const trade of candidate.closedTrades) {
      const r = finite(trade[field]);
      if (r === null || trade.closedAtMs < startMs || trade.closedAtMs >= endMs) continue;
      const index = Math.floor((trade.closedAtMs - startMs) / bucketMs);
      if (index >= 0 && index < bucketCount) values[index] += r;
    }
    series.set(candidate.id, values);
  }

  const pairs = [];
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i; j < candidates.length; j += 1) {
      const a = candidates[i], b = candidates[j];
      const xs = series.get(a.id), ys = series.get(b.id);
      const covarianceBps2 = sampleCovariance(xs, ys);
      const sx = std(xs), sy = std(ys);
      const correlation = covarianceBps2 !== null && sx && sy ? covarianceBps2 / (sx * sy) : null;
      pairs.push({ a: a.id, b: b.id, observations: bucketCount, covarianceBps2, correlation });
    }
  }
  const weight = 1 / candidates.length;
  const portfolioSeries = Array.from({ length: bucketCount }, (_, index) => candidates.reduce((sum, candidate) => sum + weight * series.get(candidate.id)[index], 0));
  return {
    bucketMs,
    commonWindow: { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() },
    bucketCount,
    pairs,
    portfolioBucketStdBps: std(portfolioSeries),
    status: 'ALIGNED',
  };
}

export function openShockScenarios(candidates = [], { shockBps = OPEN_SHOCK_BPS, exitCostBps = STRESS_COST_BPS } = {}) {
  if (!candidates.length) return { status: 'NO_ADMITTED_CANDIDATES', openSignals: 0, scenarios: [] };
  const weight = 1 / candidates.length;
  const open = candidates.map(candidate => ({ candidate, direction: Number(candidate.pendingSignal?.direction) }))
    .filter(item => [-1, 1].includes(item.direction));
  if (!open.length) return { status: 'NO_OPEN_FORWARD_SIGNALS', openSignals: 0, scenarios: [] };
  const scenarios = [
    { id: 'MARKET_UP_3PCT', shockBps: Math.abs(shockBps) },
    { id: 'MARKET_DOWN_3PCT', shockBps: -Math.abs(shockBps) },
  ].map(scenario => {
    const portfolioBps = open.reduce((sum, item) => sum + weight * (item.direction * scenario.shockBps - exitCostBps), 0);
    return { ...scenario, assumedExitCostBps: exitCostBps, portfolioPnlPct: portfolioBps / 100 };
  });
  return { status: 'SCENARIOS_AVAILABLE', openSignals: open.length, scenarios };
}

export function buildPortfolioRiskSnapshot(forwardSnapshot, forwardLedger, { bucketMs = DEFAULT_BUCKET_MS } = {}) {
  assertForwardBoundary(forwardSnapshot);
  if (!forwardLedger || forwardLedger.version !== FORWARD_LEDGER_VERSION) throw new Error('forward_ledger_unavailable_or_unsupported');
  const candidates = admittedCandidates(forwardSnapshot, forwardLedger);
  const base = simulatePortfolio(candidates, 'netBaseBps');
  const stressed = simulatePortfolio(candidates, 'netStressBps');
  const covariance = covarianceDiagnostics(candidates, { bucketMs, field: 'netBaseBps' });
  const concurrency = concurrencyDiagnostics(candidates);
  const openScenarios = openShockScenarios(candidates);
  const totalInvalidTrades = candidates.reduce((sum, candidate) => sum + candidate.invalidClosedTrades, 0);
  const status = !candidates.length
    ? 'NO_FORWARD_GATE_PASS_CANDIDATES'
    : covariance.bucketCount < 2
      ? 'PORTFOLIO_EVIDENCE_BUILDING'
      : 'PORTFOLIO_RESEARCH_READY';

  return {
    ok: true,
    version: VERSION,
    mode: 'PORTFOLIO_RISK_RESEARCH',
    paperOnly: true,
    liveOrders: false,
    executionAuthority: false,
    capitalEligible: false,
    status,
    completedAt: new Date().toISOString(),
    source: {
      forwardVersion: forwardSnapshot.version ?? null,
      forwardCompletedAt: forwardSnapshot.completedAt ?? null,
      admittedRule: 'FORWARD_NEXT_STAGE_ELIGIBLE_AND_ZERO_AUTHORITY_ONLY',
      admittedCandidates: candidates.length,
      invalidClosedTradesIgnored: totalInvalidTrades,
    },
    methodology: {
      weighting: 'EQUAL_WEIGHT_ACROSS_ADMITTED_CANDIDATES_NO_OPTIMIZATION',
      portfolioReturn: 'COMPOUNDED_WEIGHTED_LOG_RETURN_FROM_REALIZED_FORWARD_PAPER_TRADES',
      cumulativeTradeReturnIsNotPortfolioReturn: true,
      covariance: 'FIXED_BUCKET_ALIGNED_COMMON_POST_ENROLLMENT_WINDOW_ZERO_WHEN_NO_TRADE',
      covarianceBucketMs: bucketMs,
      baseCostBps: BASE_COST_BPS,
      stressCostBps: STRESS_COST_BPS,
      openSignalShockBps: OPEN_SHOCK_BPS,
      regimeSizing: 'UNAVAILABLE_UNTIL_FORWARD_TRADES_CARRY_CAUSAL_REGIME_LABELS',
      changesProductionRiskGates: false,
      optimizationOrRanking: false,
    },
    universe: candidates.map(candidate => ({
      id: candidate.id,
      laneType: candidate.laneType,
      symbol: candidate.symbol,
      family: candidate.family,
      weightPct: candidates.length ? 100 / candidates.length : 0,
      closedTrades: candidate.closedTrades.length,
      invalidClosedTradesIgnored: candidate.invalidClosedTrades,
      pendingSignal: candidate.pendingSignal ? { openedAt: candidate.pendingSignal.openedAt ?? null, direction: candidate.pendingSignal.direction ?? null } : null,
      liveEligible: false,
      executionAuthority: false,
      capitalEligible: false,
    })),
    realized: { base12Bps: base, stress18Bps: stressed },
    concurrency,
    covariance,
    openScenarios,
    regimeSizing: {
      status: 'UNAVAILABLE',
      reason: 'FORWARD_SHADOW_TRADES_DO_NOT_CARRY_CAUSAL_REGIME_LABELS',
      usedForSizing: false,
    },
    boundaries: {
      realOrdersPlaced: false,
      liveTradingEnabled: false,
      changesRiskGates: false,
      writesExecutionState: false,
      grantsCapitalEligibility: false,
    },
  };
}

export function runPortfolioRiskResearch({ root = '.', forwardPath, ledgerPath, outPath, historyPath, bucketMs = DEFAULT_BUCKET_MS } = {}) {
  const forwardFile = forwardPath ?? path.join(root, 'quant-evidence/research-forward-shadow-latest.json');
  const ledgerFile = ledgerPath ?? path.join(root, 'quant-evidence/research-forward-shadow-ledger.json');
  const outputFile = outPath ?? path.join(root, 'quant-evidence/portfolio-risk-research-latest.json');
  const historyFile = historyPath ?? path.join(root, 'quant-evidence/portfolio-risk-research-history.jsonl');
  const forwardSnapshot = readJson(forwardFile);
  const forwardLedger = readJson(ledgerFile);
  const snapshot = buildPortfolioRiskSnapshot(forwardSnapshot, forwardLedger, { bucketMs });
  writeJson(outputFile, snapshot);
  fs.mkdirSync(path.dirname(historyFile), { recursive: true });
  fs.appendFileSync(historyFile, `${JSON.stringify(snapshot)}\n`);
  return snapshot;
}

if (process.argv[1]?.endsWith('runPortfolioRiskResearch.mjs')) {
  const args = process.argv.slice(2);
  const valueAfter = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  try {
    const snapshot = runPortfolioRiskResearch({
      root: valueAfter('--root') ?? '.',
      forwardPath: valueAfter('--forward'),
      ledgerPath: valueAfter('--ledger'),
      outPath: valueAfter('--out'),
      historyPath: valueAfter('--history'),
    });
    console.log(JSON.stringify({
      ok: snapshot.ok,
      status: snapshot.status,
      admittedCandidates: snapshot.source.admittedCandidates,
      portfolioReturnPct: snapshot.realized.base12Bps.portfolioReturnPct,
      maxDrawdownPct: snapshot.realized.base12Bps.maxDrawdownPct,
    }));
  } catch (error) {
    console.error('ERROR:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
