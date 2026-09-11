import { createHash } from 'node:crypto';

export const EDGE_AUDIT_VERSION = 'qeec_v1.1';

export const DEFAULT_EDGE_AUDIT_POLICY = Object.freeze({
  kill: Object.freeze({
    minClosed: 20,
    maxProfitFactor: 0.9,
    requireNegativeExpectancy: true,
    maxDrawdownPct: 0.25,
  }),
  evidence: Object.freeze({
    minClosed: 50,
    minProfitFactor: 1.3,
    minExpectancy: 0,
    minWinRate: 0.45,
    minTStat: 2,
    maxDrawdownPct: 0.25,
    minPositiveRegimes: 2,
    minTradesPerPositiveRegime: 5,
    minCalibrationTrades: 30,
    maxBrier: 0.2,
    maxEce: 0.1,
    minConfidenceBuckets: 2,
    requireWalkForward: true,
    requireOos: true,
  }),
});

// Missing/invalid financial observations must never become synthetic zeroes.
const finiteNumber = value => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const round = (value, digits = 6) => {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const sampleStd = (values) => {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / (values.length - 1));
};

export function modeledSlippagePct(orderSizeUsd, volumeUsd) {
  if (!(orderSizeUsd > 0)) return 0;
  if (!(volumeUsd > 0)) return 0.0008;
  const ratio = orderSizeUsd / volumeUsd;
  if (ratio < 0.0005) return 0.0001;
  if (ratio < 0.005) return 0.0003;
  return 0.0008;
}

export function modeledFriction(trade, { feeRatePerSide = 0.0004 } = {}) {
  const entry = Number(trade.entry_price);
  const shares = Number(trade.shares);
  const capital = Number(trade.capital_used);
  const leverage = Number(trade.leverage || 1);
  const storedNotional = Number(trade.notional_usd);
  const inferredNotional = Number.isFinite(entry) && Number.isFinite(shares) ? Math.abs(entry * shares) : null;
  const notionalUsd = Number.isFinite(storedNotional) && storedNotional > 0
    ? storedNotional
    : (Number.isFinite(inferredNotional) && inferredNotional > 0 ? inferredNotional : (capital > 0 ? capital * Math.max(1, leverage) : 0));
  const volumeUsd = Number(trade.entry_volume24h || 0);
  const slipPct = modeledSlippagePct(notionalUsd, volumeUsd);
  const feeUsd = notionalUsd * feeRatePerSide * 2;
  const slippageUsd = notionalUsd * slipPct * 2;
  const fundingUsd = Math.abs(Number(trade.funding_paid || 0));
  const modeledCostUsd = feeUsd + slippageUsd + fundingUsd;
  const modeledCostBps = notionalUsd > 0 ? modeledCostUsd / notionalUsd * 10000 : null;
  return {
    notionalUsd: round(notionalUsd, 4),
    feeUsd: round(feeUsd, 6),
    slippageUsd: round(slippageUsd, 6),
    fundingUsd: round(fundingUsd, 6),
    modeledCostUsd: round(modeledCostUsd, 6),
    modeledCostBps: round(modeledCostBps, 4),
    slipPct: round(slipPct, 8),
  };
}

function costBucket(costBps) {
  if (!Number.isFinite(costBps)) return 'UNATTRIBUTED';
  if (costBps <= 12) return 'LOW_<=12BPS';
  if (costBps <= 20) return 'MEDIUM_12_20BPS';
  return 'HIGH_>20BPS';
}
function sizingBucket(capitalUsd) {
  if (!Number.isFinite(capitalUsd) || capitalUsd <= 0) return 'UNATTRIBUTED';
  if (capitalUsd <= 50) return 'TINY_<=50';
  if (capitalUsd <= 150) return 'SMALL_50_150';
  if (capitalUsd <= 250) return 'MEDIUM_150_250';
  return 'LARGE_>250';
}

function evidenceList(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function normalizeTrade(row) {
  const pnl = finiteNumber(row.pnl);
  const confidenceRaw = finiteNumber(row.confidence);
  const confidence = Number.isFinite(confidenceRaw) && confidenceRaw >= 0 && confidenceRaw <= 1 ? confidenceRaw : null;
  const capitalUsed = finiteNumber(row.capital_used);
  const friction = modeledFriction(row);
  const evidence = evidenceList(row.evidence);
  const strategyVersionId = String(row.strategy_version_id || '').trim() || null;
  const strategyFamily = String(row.trade_type || '').trim() || 'UNATTRIBUTED';
  return {
    ...row,
    pnl: Number.isFinite(pnl) ? pnl : null,
    confidence,
    capitalUsed: Number.isFinite(capitalUsed) ? capitalUsed : null,
    strategyVersionId,
    strategyKey: strategyVersionId || strategyFamily,
    asset: String(row.asset_pair || '').trim().toUpperCase() || 'UNATTRIBUTED',
    regime: String(row.entry_regime || '').trim() || 'UNATTRIBUTED',
    session: String(row.entry_session || '').trim() || 'UNATTRIBUTED',
    mode: String(row.mode || '').trim().toLowerCase() || 'unknown',
    validationStatus: String(row.validation_status || '').trim() || null,
    evidence,
    friction,
    costBucket: costBucket(friction.modeledCostBps),
    sizingBucket: sizingBucket(capitalUsed),
  };
}

export function summarizeCohort(rows) {
  const closed = rows.filter((row) => row.status === 'closed' && Number.isFinite(row.pnl));
  const pnls = closed.map((row) => row.pnl);
  const wins = pnls.filter((value) => value > 0);
  const losses = pnls.filter((value) => value < 0);
  const grossProfit = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  const realizedPnl = pnls.reduce((sum, value) => sum + value, 0);
  const expectancy = pnls.length ? realizedPnl / pnls.length : null;
  const pnlStd = sampleStd(pnls);
  const tStat = pnls.length >= 2 && pnlStd > 0 && expectancy != null ? expectancy / (pnlStd / Math.sqrt(pnls.length)) : null;
  const ordered = [...closed].sort((a, b) => (Date.parse(a.closed_at || a.opened_at || '') || 0) - (Date.parse(b.closed_at || b.opened_at || '') || 0));
  let curve = 0;
  let peak = 0;
  let maxDrawdownUsd = 0;
  for (const trade of ordered) {
    curve += trade.pnl;
    peak = Math.max(peak, curve);
    maxDrawdownUsd = Math.max(maxDrawdownUsd, peak - curve);
  }
  const allocationBaselineUsd = rows.reduce((sum, row) => sum + (row.capitalUsed > 0 ? row.capitalUsed : 0), 0) / Math.max(1, rows.length);
  const maxDrawdownPct = allocationBaselineUsd > 0 ? maxDrawdownUsd / allocationBaselineUsd : null;
  const modeledCostUsd = closed.reduce((sum, row) => sum + (row.friction?.modeledCostUsd || 0), 0);
  const costBps = closed.map((row) => row.friction?.modeledCostBps).filter(Number.isFinite);
  const avgModeledCostBps = costBps.length ? mean(costBps) : null;
  return {
    trades: rows.length,
    closed: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? round(wins.length / closed.length, 6) : null,
    realizedPnl: round(realizedPnl, 4),
    expectancy: expectancy == null ? null : round(expectancy, 6),
    grossProfit: round(grossProfit, 4),
    grossLoss: round(grossLoss, 4),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 6) : (grossProfit > 0 ? Infinity : null),
    tStat: tStat == null ? null : round(tStat, 6),
    maxDrawdownUsd: round(maxDrawdownUsd, 4),
    maxDrawdownPct: maxDrawdownPct == null ? null : round(maxDrawdownPct, 6),
    allocationBaselineUsd: round(allocationBaselineUsd, 4),
    modeledCostUsd: round(modeledCostUsd, 4),
    avgModeledCostBps: avgModeledCostBps == null ? null : round(avgModeledCostBps, 4),
  };
}

function grouped(rows, selector) {
  const map = new Map();
  for (const row of rows) {
    const key = selector(row) || 'UNATTRIBUTED';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return Object.fromEntries([...map.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))).map(([key, sample]) => [key, summarizeCohort(sample)]));
}

export function calibrateConfidence(rows) {
  const usable = rows.filter((row) => Number.isFinite(row.confidence) && Number.isFinite(row.pnl));
  if (!usable.length) return { trades: 0, brier: null, ece: null, bucketsPopulated: 0, buckets: {}, sufficient: false };
  const buckets = new Map();
  let brierSum = 0;
  for (const row of usable) {
    const actual = row.pnl > 0 ? 1 : 0;
    brierSum += (row.confidence - actual) ** 2;
    const floor = Math.min(0.9, Math.floor(row.confidence * 10) / 10);
    const key = `${floor.toFixed(1)}-${Math.min(1, floor + 0.1).toFixed(1)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  }
  let ece = 0;
  const output = {};
  for (const [key, sample] of [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const avgConfidence = mean(sample.map((row) => row.confidence));
    const winRate = sample.filter((row) => row.pnl > 0).length / sample.length;
    const error = Math.abs(avgConfidence - winRate);
    ece += error * sample.length / usable.length;
    output[key] = { trades: sample.length, avgConfidence: round(avgConfidence, 6), winRate: round(winRate, 6), calibrationError: round(error, 6) };
  }
  return {
    trades: usable.length,
    brier: round(brierSum / usable.length, 6),
    ece: round(ece, 6),
    bucketsPopulated: buckets.size,
    buckets: output,
    sufficient: usable.length >= 30 && buckets.size >= 2,
  };
}

function pipelineIntegrity(rows) {
  const ids = rows.map(row => String(row.id ?? '').trim());
  const checks = {
    uniqueTradeIds: ids.every(Boolean) && new Set(ids).size === ids.length,
    allClosed: rows.every((row) => row.status === 'closed'),
    paperOnly: rows.every((row) => row.mode === 'paper'),
    strategyAttributed: rows.every((row) => Boolean(row.strategyVersionId)),
    assetAttributed: rows.every((row) => row.asset !== 'UNATTRIBUTED'),
    regimeAttributed: rows.every((row) => row.regime !== 'UNATTRIBUTED'),
    sizingAttributed: rows.every((row) => row.capitalUsed > 0),
    pnlFinite: rows.every((row) => Number.isFinite(row.pnl)),
    confidenceFinite: rows.every((row) => Number.isFinite(row.confidence)),
    signalEvidenceAttributed: rows.every((row) => row.evidence.some((item) => item.includes('STRATEGY_VERSION_')) && row.evidence.some((item) => item.includes('REGIME_'))),
    frictionModeled: rows.every((row) => Number.isFinite(row.friction?.modeledCostBps)),
  };
  const failures = Object.entries(checks).filter(([, pass]) => !pass).map(([code]) => code);
  return { checks, failures, pass: failures.length === 0 };
}

function researchGateFor(strategyKey, researchEvidence = {}) {
  const evidence = researchEvidence?.[strategyKey] || null;
  if (!evidence) return { available: false, walkForwardPass: false, oosPass: false, source: null };
  const walkForward = evidence.walk_forward ?? evidence.walkForward ?? null;
  const oos = evidence.oos_evidence ?? evidence.oosEvidence ?? evidence.oos ?? null;
  return {
    available: true,
    walkForwardPass: walkForward?.pass === true,
    oosPass: oos?.pass === true,
    source: {
      evaluatedAt: evidence.evaluated_at ?? evidence.evaluatedAt ?? null,
      verdict: evidence.verdict ?? null,
      policyVersion: evidence.policy_version ?? evidence.policyVersion ?? null,
    },
  };
}

function evaluateStrategy(strategyKey, rows, policy, researchEvidence) {
  const metrics = summarizeCohort(rows);
  const calibration = calibrateConfidence(rows);
  const segments = {
    regime: grouped(rows, (row) => row.regime),
    asset: grouped(rows, (row) => row.asset),
    cost: grouped(rows, (row) => row.costBucket),
    sizing: grouped(rows, (row) => row.sizingBucket),
    session: grouped(rows, (row) => row.session),
  };
  const integrity = pipelineIntegrity(rows);
  const research = researchGateFor(strategyKey, researchEvidence);
  const kill = policy.kill;
  const evidence = policy.evidence;
  const killReasons = [];

  if (!integrity.pass) killReasons.push(`DATA_INTEGRITY:${integrity.failures.join(',')}`);
  if (metrics.closed >= kill.minClosed && metrics.profitFactor != null && metrics.profitFactor < kill.maxProfitFactor && (!kill.requireNegativeExpectancy || (metrics.expectancy != null && metrics.expectancy < 0))) {
    killReasons.push(`NEGATIVE_EDGE:N=${metrics.closed},PF=${metrics.profitFactor},EV=${metrics.expectancy}`);
  }
  if (metrics.closed >= kill.minClosed && metrics.maxDrawdownPct != null && metrics.maxDrawdownPct > kill.maxDrawdownPct) {
    killReasons.push(`DRAWDOWN:${metrics.maxDrawdownPct}>${kill.maxDrawdownPct}`);
  }

  const positiveRegimes = Object.values(segments.regime).filter((segment) => segment.closed >= evidence.minTradesPerPositiveRegime && segment.expectancy > 0 && segment.profitFactor != null && segment.profitFactor >= 1).length;
  const gates = [
    { code: 'PIPELINE_INTEGRITY', pass: integrity.pass, detail: integrity.pass ? 'complete paper attribution' : integrity.failures.join(',') },
    { code: 'PAPER_ONLY', pass: integrity.checks.paperOnly, detail: integrity.checks.paperOnly ? 'no live contamination' : 'non-paper rows present' },
    { code: 'SAMPLE', pass: metrics.closed >= evidence.minClosed, detail: `${metrics.closed}/${evidence.minClosed}` },
    { code: 'PROFIT_FACTOR', pass: metrics.profitFactor != null && metrics.profitFactor >= evidence.minProfitFactor, detail: `${metrics.profitFactor ?? 'NA'}>=${evidence.minProfitFactor}` },
    { code: 'EXPECTANCY', pass: metrics.expectancy != null && metrics.expectancy > evidence.minExpectancy, detail: `${metrics.expectancy ?? 'NA'}>${evidence.minExpectancy}` },
    { code: 'WIN_RATE', pass: metrics.winRate != null && metrics.winRate >= evidence.minWinRate, detail: `${metrics.winRate ?? 'NA'}>=${evidence.minWinRate}` },
    { code: 'TSTAT', pass: metrics.tStat != null && metrics.tStat >= evidence.minTStat, detail: `${metrics.tStat ?? 'NA'}>=${evidence.minTStat}` },
    { code: 'DRAWDOWN', pass: metrics.maxDrawdownPct != null && metrics.maxDrawdownPct <= evidence.maxDrawdownPct, detail: `${metrics.maxDrawdownPct ?? 'NA'}<=${evidence.maxDrawdownPct}` },
    { code: 'REGIME_BREADTH', pass: positiveRegimes >= evidence.minPositiveRegimes, detail: `${positiveRegimes}/${evidence.minPositiveRegimes}` },
    { code: 'CALIBRATION_SAMPLE', pass: calibration.trades >= evidence.minCalibrationTrades, detail: `${calibration.trades}/${evidence.minCalibrationTrades}` },
    { code: 'CALIBRATION_DIVERSITY', pass: calibration.bucketsPopulated >= evidence.minConfidenceBuckets, detail: `${calibration.bucketsPopulated}/${evidence.minConfidenceBuckets}` },
    { code: 'BRIER', pass: calibration.brier != null && calibration.brier <= evidence.maxBrier, detail: `${calibration.brier ?? 'NA'}<=${evidence.maxBrier}` },
    { code: 'ECE', pass: calibration.ece != null && calibration.ece <= evidence.maxEce, detail: `${calibration.ece ?? 'NA'}<=${evidence.maxEce}` },
    { code: 'WALK_FORWARD', pass: evidence.requireWalkForward !== true || research.walkForwardPass, detail: research.available ? String(research.walkForwardPass) : 'missing exact-version evidence' },
    { code: 'OOS', pass: evidence.requireOos !== true || research.oosPass, detail: research.available ? String(research.oosPass) : 'missing exact-version evidence' },
  ];

  const evidenceCandidate = killReasons.length === 0 && gates.every((gate) => gate.pass);
  const status = killReasons.length ? 'KILL' : (evidenceCandidate ? 'EVIDENCE_CANDIDATE' : 'KEEP_PAPER');
  return {
    strategyKey,
    status,
    capitalEligible: false,
    liveOrdersAuthorized: false,
    killReasons,
    metrics,
    calibration,
    segments,
    pipeline: integrity,
    research,
    gates,
    interpretation: evidenceCandidate
      ? 'Statistical evidence clears the audit gates, but this audit never authorizes real capital. Founder gate + canonical reconciliation + live preflight remain mandatory.'
      : (killReasons.length ? 'Kill criteria triggered. Keep this cohort out of promotion and stop new risk until redesigned/revalidated.' : 'Evidence is incomplete or below threshold. Remain PAPER and collect clean exact-version evidence.'),
  };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function stableHash(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function buildEconomicEdgeAudit(rawRows, { policy = DEFAULT_EDGE_AUDIT_POLICY, researchEvidence = {}, generatedAt = new Date().toISOString() } = {}) {
  const rows = (Array.isArray(rawRows) ? rawRows : []).map(normalizeTrade).sort((a, b) => {
    const ta = Date.parse(a.closed_at || a.opened_at || '') || 0;
    const tb = Date.parse(b.closed_at || b.opened_at || '') || 0;
    return ta - tb || String(a.id || '').localeCompare(String(b.id || ''));
  });
  const futuresPaperRows = rows.filter((row) => String(row.instrument_type || '').toLowerCase() === 'futures' || String(row.trade_type || '').startsWith('crypto_futures_'));
  const strategyGroups = new Map();
  for (const row of futuresPaperRows) {
    const key = row.strategyKey;
    if (!strategyGroups.has(key)) strategyGroups.set(key, []);
    strategyGroups.get(key).push(row);
  }
  const strategies = Object.fromEntries([...strategyGroups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, sample]) => [key, evaluateStrategy(key, sample, policy, researchEvidence)]));
  const normalizedForHash = futuresPaperRows.map((row) => ({
    id: row.id,
    status: row.status,
    evidence: row.evidence,
    friction: row.friction,
    strategyVersionId: row.strategyVersionId,
    tradeType: row.trade_type,
    asset: row.asset,
    regime: row.regime,
    session: row.session,
    mode: row.mode,
    confidence: row.confidence,
    capitalUsed: row.capitalUsed,
    pnl: row.pnl,
    modeledCostBps: row.friction.modeledCostBps,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    runnerVersion: row.runner_version,
    validationStatus: row.validationStatus,
  }));
  const portfolio = summarizeCohort(futuresPaperRows);
  const strategyStatuses = Object.values(strategies).map((strategy) => strategy.status);
  return {
    auditVersion: EDGE_AUDIT_VERSION,
    generatedAt,
    mode: 'READ_ONLY_PAPER_AUDIT',
    pnlBasis: 'STORED_LEDGER_PNL_NOT_INDEPENDENTLY_RECONCILED',
    costBasis: 'MODELED_DIAGNOSTIC_NOT_DEDUCTED_AGAIN',
    drawdownBasis: 'CUMULATIVE_CLOSED_PNL_OVER_MEAN_TRADE_ALLOCATION_NOT_ACCOUNT_EQUITY',
    capitalEligible: false,
    liveOrdersAuthorized: false,
    policy,
    source: {
      rowsReceived: rows.length,
      futuresRowsAudited: futuresPaperRows.length,
      evidenceSha256: stableHash({ auditVersion: EDGE_AUDIT_VERSION, policy, rows: normalizedForHash, researchEvidence }),
    },
    portfolio,
    portfolioSegments: {
      strategy: grouped(futuresPaperRows, (row) => row.strategyKey),
      regime: grouped(futuresPaperRows, (row) => row.regime),
      asset: grouped(futuresPaperRows, (row) => row.asset),
      cost: grouped(futuresPaperRows, (row) => row.costBucket),
      sizing: grouped(futuresPaperRows, (row) => row.sizingBucket),
    },
    strategies,
    verdict: strategyStatuses.includes('KILL') ? 'KILL_PRESENT' : (strategyStatuses.length && strategyStatuses.every((status) => status === 'EVIDENCE_CANDIDATE') ? 'EVIDENCE_CANDIDATE_ONLY' : 'KEEP_PAPER'),
    rule: 'No audit result authorizes real trading. Promotion requires external founder approval, canonical reconciliation and live preflight after exact-version evidence clears all gates.',
  };
}
