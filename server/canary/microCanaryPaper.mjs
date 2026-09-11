import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const MICRO_CANARY_POLICY = Object.freeze({
  version: 'micro_canary_paper_v2_v8_mirror',
  mode: 'MICRO_CANARY_PAPER',
  strategyVersionId: 'futures_breakout_short_micro:v8',
  validationStatus: 'EXPERIMENT',
  startingCapitalUsd: 10,
  maxCapitalUsd: 10,
  maxTotalLossUsd: 0.25,
  maxOpenPositions: 1,
  maxLeverage: 1,
  fallbackStopPct: 0.03,
  baseCostBps: 12,
  stressCostBps: 18,
  statusUrl: 'https://genesis-hq-lab.vercel.app/api/system/health',
});

const round = (value, digits = 8) => Number(Number(value).toFixed(digits));
const finite = value => Number.isFinite(Number(value));
const asMs = value => {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
};

export function validateCanaryPolicy(policy = MICRO_CANARY_POLICY) {
  if (policy.startingCapitalUsd <= 0 || policy.startingCapitalUsd > 10) throw new Error('micro canary capital must be >0 and <= $10');
  if (policy.maxCapitalUsd !== 10) throw new Error('micro canary hard capital cap must remain $10');
  if (policy.maxTotalLossUsd <= 0 || policy.maxTotalLossUsd > 0.25) throw new Error('micro canary max total loss must be >0 and <= $0.25');
  if (policy.maxOpenPositions !== 1) throw new Error('micro canary must allow exactly one open position');
  if (policy.maxLeverage !== 1) throw new Error('micro canary paper preview must remain 1x');
  if (!policy.strategyVersionId?.endsWith(':v8')) throw new Error('micro canary must mirror an explicit v8 strategy version');
  return true;
}

export function assertSafeRunnerSnapshot(snapshot) {
  if (!snapshot?.ok) throw new Error('runner_snapshot_not_ok');
  const runner = snapshot?.agentRunner;
  if (!runner?.ok) throw new Error('runner_status_not_ok');
  if (runner?.paperOnly !== true) throw new Error('runner_paper_boundary_unverified');
  if (runner?.liveOrders !== false) throw new Error('runner_live_orders_boundary_violated');
  if (!Array.isArray(runner?.recentTrades)) throw new Error('runner_recent_trades_unavailable');
  return runner;
}

export function selectCurrentV8PaperTrades(snapshot, policy = MICRO_CANARY_POLICY) {
  const runner = assertSafeRunnerSnapshot(snapshot);
  return runner.recentTrades
    .filter(trade =>
      trade?.status === 'closed'
      && trade?.mode === 'paper'
      && trade?.strategyVersionId === policy.strategyVersionId
      && trade?.validationStatus === policy.validationStatus
      && ['LONG', 'SHORT'].includes(trade?.side)
      && finite(trade?.entryPrice)
      && finite(trade?.exitPrice)
      && Number(trade.entryPrice) > 0
      && asMs(trade?.openedAt) !== null
      && asMs(trade?.closedAt) !== null
    )
    .sort((a, b) => asMs(a.openedAt) - asMs(b.openedAt));
}

function sourceStopLossRate(trade, policy, costBps) {
  const entry = Number(trade.entryPrice);
  const stop = Number(trade.stopPrice);
  const stopPct = finite(stop) && stop > 0
    ? Math.abs(stop - entry) / entry
    : policy.fallbackStopPct;
  return Math.max(stopPct, policy.fallbackStopPct / 4) + (costBps / 10_000);
}

function replayTrade(trade, equity, costBps, policy) {
  const entry = Number(trade.entryPrice);
  const exit = Number(trade.exitPrice);
  const side = trade.side;
  const grossReturn = side === 'LONG' ? (exit - entry) / entry : (entry - exit) / entry;
  const netReturn = grossReturn - (costBps / 10_000);
  const equityFloor = policy.startingCapitalUsd - policy.maxTotalLossUsd;
  const remainingLossBudget = Math.max(0, equity - equityFloor);
  const worstCaseLossRate = sourceStopLossRate(trade, policy, costBps);
  const lossBoundedNotional = worstCaseLossRate > 0 ? remainingLossBudget / worstCaseLossRate : policy.maxCapitalUsd;
  const notionalUsd = Math.max(0, Math.min(equity, policy.maxCapitalUsd, lossBoundedNotional));
  const rawPnl = notionalUsd * netReturn;
  const netPnlUsd = Math.max(rawPnl, -remainingLossBudget);
  const nextEquity = equity + netPnlUsd;
  return {
    equity: nextEquity,
    trade: {
      sourceTradeId: String(trade.id ?? ''),
      pair: String(trade.pair ?? ''),
      side,
      openedAt: trade.openedAt,
      closedAt: trade.closedAt,
      exitReason: trade.exitReason ?? null,
      entry: round(entry),
      exit: round(exit),
      sourceStop: finite(trade.stopPrice) ? round(Number(trade.stopPrice)) : null,
      sourceTarget: finite(trade.targetPrice) ? round(Number(trade.targetPrice)) : null,
      sourceCapitalUsedUsd: finite(trade.capitalUsed) ? round(Number(trade.capitalUsed)) : null,
      sourceLeverage: finite(trade.leverage) ? round(Number(trade.leverage)) : null,
      sourcePnlUsd: finite(trade.pnl) ? round(Number(trade.pnl)) : null,
      canaryLeverage: policy.maxLeverage,
      canaryNotionalUsd: round(notionalUsd),
      grossReturnPct: round(grossReturn * 100, 6),
      costBps,
      netPnlUsd: round(netPnlUsd),
      equityAfterUsd: round(nextEquity),
    },
  };
}

export function simulateFromPaperTrades(trades, { costBps = MICRO_CANARY_POLICY.baseCostBps, policy = MICRO_CANARY_POLICY } = {}) {
  validateCanaryPolicy(policy);
  if (!Array.isArray(trades)) throw new Error('paper trades must be an array');
  if (!Number.isFinite(costBps) || costBps < 0) throw new Error('costBps must be non-negative');

  let equity = policy.startingCapitalUsd;
  let peakEquity = equity;
  let maxDrawdownUsd = 0;
  let maxObservedNotionalUsd = 0;
  let ignoredOverlaps = 0;
  let ignoredAfterLossCap = 0;
  let lastAcceptedClose = null;
  const replayed = [];

  for (const trade of [...trades].sort((a, b) => asMs(a.openedAt) - asMs(b.openedAt))) {
    const openedAt = asMs(trade.openedAt);
    const closedAt = asMs(trade.closedAt);
    if (openedAt === null || closedAt === null || closedAt < openedAt) continue;
    if (lastAcceptedClose !== null && openedAt < lastAcceptedClose) {
      ignoredOverlaps++;
      continue;
    }
    if (equity <= policy.startingCapitalUsd - policy.maxTotalLossUsd + 1e-9) {
      ignoredAfterLossCap++;
      continue;
    }
    const replay = replayTrade(trade, equity, costBps, policy);
    equity = replay.equity;
    replayed.push(replay.trade);
    lastAcceptedClose = closedAt;
    maxObservedNotionalUsd = Math.max(maxObservedNotionalUsd, replay.trade.canaryNotionalUsd);
    peakEquity = Math.max(peakEquity, equity);
    maxDrawdownUsd = Math.max(maxDrawdownUsd, peakEquity - equity);
  }

  const wins = replayed.filter(trade => trade.netPnlUsd > 0);
  const losses = replayed.filter(trade => trade.netPnlUsd < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.netPnlUsd, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.netPnlUsd, 0));
  const netPnlUsd = equity - policy.startingCapitalUsd;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? null : 0;

  return {
    costBps,
    trades: replayed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: replayed.length ? round(wins.length / replayed.length, 6) : 0,
    netPnlUsd: round(netPnlUsd),
    roiPct: round((netPnlUsd / policy.startingCapitalUsd) * 100, 6),
    expectancyUsd: replayed.length ? round(netPnlUsd / replayed.length) : 0,
    profitFactor: profitFactor === null ? null : round(profitFactor, 6),
    finalEquityUsd: round(equity),
    maxDrawdownUsd: round(maxDrawdownUsd),
    maxDrawdownPct: round((maxDrawdownUsd / policy.startingCapitalUsd) * 100, 6),
    stoppedByLossCap: equity <= policy.startingCapitalUsd - policy.maxTotalLossUsd + 1e-9,
    maxObservedOpenPositions: replayed.length ? 1 : 0,
    maxObservedNotionalUsd: round(maxObservedNotionalUsd),
    ignoredOverlaps,
    ignoredAfterLossCap,
    tradesDetail: replayed,
  };
}

function safeReadJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

export function summarizeResearchGates(root) {
  const forward = safeReadJson(join(root, 'quant-evidence', 'research-forward-shadow-latest.json'));
  const portfolio = safeReadJson(join(root, 'quant-evidence', 'portfolio-risk-research-latest.json'));
  const forwardCandidates = Array.isArray(forward?.candidates) ? forward.candidates : [];
  const forwardEligible = forwardCandidates.filter(candidate =>
    candidate?.nextStageEligible === true
    && candidate?.executionAuthority !== true
    && candidate?.capitalEligible !== true
    && candidate?.liveEligible !== true
  ).length;
  const portfolioReady = portfolio?.status === 'PORTFOLIO_RESEARCH_READY'
    && portfolio?.paperOnly === true
    && portfolio?.liveOrders === false
    && portfolio?.executionAuthority === false
    && portfolio?.capitalEligible === false;
  return {
    forwardStatus: forward?.status ?? null,
    forwardEligible,
    portfolioStatus: portfolio?.status ?? null,
    portfolioReady,
  };
}

export function buildEvidence({ baseline, stress, gates, source, generatedAt = new Date().toISOString() }) {
  const diagnosticVerdict = baseline.trades === 0 ? 'NO_TRADES' : baseline.netPnlUsd > 0 ? 'PAPER_WIN' : baseline.netPnlUsd < 0 ? 'PAPER_LOSS' : 'FLAT';
  const canaryReadiness = gates.forwardEligible === 0
    ? 'BLOCKED_NO_FORWARD_GATE_PASS'
    : !gates.portfolioReady
      ? 'BLOCKED_PORTFOLIO_RISK_NOT_READY'
      : 'RESEARCH_GATES_PRESENT_HUMAN_REVIEW_REQUIRED';
  return {
    version: MICRO_CANARY_POLICY.version,
    generatedAt,
    mode: MICRO_CANARY_POLICY.mode,
    paperOnly: true,
    liveOrders: false,
    executionAuthority: false,
    capitalEligible: false,
    strategy: {
      id: MICRO_CANARY_POLICY.strategyVersionId,
      purpose: 'ACTIVE_V8_PAPER_MIRROR_DIAGNOSTIC',
      note: 'Replays verified closed PAPER fills from the active v8 experiment at 1x with a hard $10 cap. This cannot unlock LIVE.',
    },
    source,
    policy: { ...MICRO_CANARY_POLICY, statusUrl: undefined },
    researchGates: gates,
    canaryReadiness,
    diagnosticVerdict,
    baseline,
    stress,
    boundaries: {
      realOrdersPlaced: false,
      orderEndpointAvailable: false,
      apiTradingKeysUsed: false,
      liveTradingEnabled: false,
      changesProductionRiskGates: false,
      grantsCapitalEligibility: false,
      writesExecutionState: false,
      maxCapitalUsd: 10,
      maxTotalLossUsd: 0.25,
      maxOpenPositions: 1,
      maxLeverage: 1,
    },
  };
}

export async function fetchRunnerSnapshot(url = process.env.GENESIS_STATUS_URL || MICRO_CANARY_POLICY.statusUrl) {
  const response = await fetch(url, {
    method: 'GET',
    headers: { accept: 'application/json', 'user-agent': 'genesis-micro-canary-paper-v2' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`runner_snapshot_http_${response.status}`);
  return await response.json();
}

export async function runMicroCanaryPaper({ root = '.', now = new Date(), snapshot = null } = {}) {
  validateCanaryPolicy();
  const currentSnapshot = snapshot ?? await fetchRunnerSnapshot();
  const runner = assertSafeRunnerSnapshot(currentSnapshot);
  const trades = selectCurrentV8PaperTrades(currentSnapshot);
  const baseline = simulateFromPaperTrades(trades, { costBps: MICRO_CANARY_POLICY.baseCostBps });
  const stress = simulateFromPaperTrades(trades, { costBps: MICRO_CANARY_POLICY.stressCostBps });
  const gates = summarizeResearchGates(root);
  const evidence = buildEvidence({
    baseline,
    stress,
    gates,
    source: {
      kind: 'VERIFIED_SYSTEM_HEALTH_PAPER_TRADES',
      strategyVersionId: MICRO_CANARY_POLICY.strategyVersionId,
      runnerVersion: runner.runnerVersion ?? runner.lastResult?.runnerVersion ?? null,
      validationEngineVersion: runner.validationEngineVersion ?? runner.lastResult?.validationEngineVersion ?? null,
      sourceClosedTrades: trades.length,
      sourceLastTickAt: runner.lastTickAt ?? null,
      sourceUpdatedAt: runner.updatedAt ?? currentSnapshot?.timestamp ?? null,
    },
    generatedAt: now.toISOString(),
  });
  const outDir = join(root, 'quant-evidence');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'micro-canary-paper-latest.json'), JSON.stringify(evidence, null, 2) + '\n');
  appendFileSync(join(outDir, 'micro-canary-paper-history.jsonl'), JSON.stringify(evidence) + '\n');
  return evidence;
}

function rootFromArgv(argv) {
  const i = argv.indexOf('--root');
  return i >= 0 && argv[i + 1] ? argv[i + 1] : '.';
}

if (process.argv[1] && process.argv[1].endsWith('microCanaryPaper.mjs')) {
  runMicroCanaryPaper({ root: rootFromArgv(process.argv.slice(2)) })
    .then(result => {
      console.log(JSON.stringify({
        mode: result.mode,
        version: result.version,
        strategy: result.strategy.id,
        diagnosticVerdict: result.diagnosticVerdict,
        canaryReadiness: result.canaryReadiness,
        trades: result.baseline.trades,
        netPnlUsd: result.baseline.netPnlUsd,
        finalEquityUsd: result.baseline.finalEquityUsd,
        stressNetPnlUsd: result.stress.netPnlUsd,
        forwardEligible: result.researchGates.forwardEligible,
        portfolioReady: result.researchGates.portfolioReady,
      }, null, 2));
    })
    .catch(error => { console.error(error); process.exitCode = 1; });
}
