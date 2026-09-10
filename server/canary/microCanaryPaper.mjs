import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fetchKlines } from '../crypto/backtest/historicalData.mjs';
import {
  calculateBollingerBands as bollinger,
  calculateRsi as rsi,
  calculateAdx as adx,
} from '../crypto/technicalIndicators.mjs';

export const MICRO_CANARY_POLICY = Object.freeze({
  version: 'micro_canary_paper_v1',
  mode: 'MICRO_CANARY_PAPER',
  pair: 'SOLUSDT',
  interval: '4h',
  days: 30,
  startingCapitalUsd: 10,
  maxCapitalUsd: 10,
  maxTotalLossUsd: 0.25,
  maxOpenPositions: 1,
  maxLeverage: 1,
  stopPct: 0.005,
  rewardRisk: 2.2,
  baseCostBps: 12,
  stressCostBps: 18,
  strategyId: 'legacy_mean_reversion_reference_sol_4h_v1',
});

const PARAMS = Object.freeze({
  bbPeriod: 20,
  bbStd: 2.0,
  rsiPeriod: 13,
  rsiOS: 30,
  rsiOB: 70,
  adxMax: 25,
  adxPeriod: 14,
});

const round = (value, digits = 8) => Number(Number(value).toFixed(digits));

export function validateCanaryPolicy(policy = MICRO_CANARY_POLICY) {
  if (policy.startingCapitalUsd <= 0 || policy.startingCapitalUsd > 10) throw new Error('micro canary capital must be >0 and <= $10');
  if (policy.maxCapitalUsd !== 10) throw new Error('micro canary hard capital cap must remain $10');
  if (policy.maxTotalLossUsd <= 0 || policy.maxTotalLossUsd > 0.25) throw new Error('micro canary max total loss must be >0 and <= $0.25');
  if (policy.maxOpenPositions !== 1) throw new Error('micro canary must allow exactly one open position');
  if (policy.maxLeverage !== 1) throw new Error('micro canary paper preview must remain 1x');
  return true;
}

export function referenceSignals(klines) {
  const closes = klines.map(k => Number(k[4]));
  const highs = klines.map(k => Number(k[2]));
  const lows = klines.map(k => Number(k[3]));
  const out = new Array(klines.length).fill(null);
  const warm = Math.max(PARAMS.bbPeriod, PARAMS.adxPeriod * 2) + 2;
  for (let i = warm; i < klines.length; i++) {
    const sliceC = closes.slice(0, i + 1);
    const sliceH = highs.slice(0, i + 1);
    const sliceL = lows.slice(0, i + 1);
    const bb = bollinger(sliceC, PARAMS.bbPeriod, PARAMS.bbStd);
    const currentRsi = rsi(sliceC, PARAMS.rsiPeriod);
    const currentAdx = adx(sliceH, sliceL, sliceC, PARAMS.adxPeriod);
    const price = closes[i];
    if (currentAdx > PARAMS.adxMax) continue;
    if (price <= bb.lower && currentRsi <= PARAMS.rsiOS) out[i] = 'LONG';
    else if (price >= bb.upper && currentRsi >= PARAMS.rsiOB) out[i] = 'SHORT';
  }
  return out;
}

function closeTrade(pos, exitPrice, reason, at, equity, costBps) {
  const grossPnl = (pos.side === 'LONG' ? exitPrice - pos.entry : pos.entry - exitPrice) * pos.units;
  const roundTripCost = pos.notionalUsd * (costBps / 10_000);
  const netPnl = grossPnl - roundTripCost;
  return {
    trade: {
      side: pos.side,
      entry: round(pos.entry),
      exit: round(exitPrice),
      units: round(pos.units),
      notionalUsd: round(pos.notionalUsd),
      grossPnlUsd: round(grossPnl),
      costUsd: round(roundTripCost),
      netPnlUsd: round(netPnl),
      reason,
      openedAt: pos.openedAt,
      closedAt: at,
    },
    equity: equity + netPnl,
  };
}

export function simulateFromSignals(klines, signals, { costBps = MICRO_CANARY_POLICY.baseCostBps } = {}) {
  validateCanaryPolicy();
  if (!Array.isArray(klines) || klines.length < 3) throw new Error('at least 3 klines are required');
  if (!Array.isArray(signals) || signals.length !== klines.length) throw new Error('signals must align with klines');
  if (!Number.isFinite(costBps) || costBps < 0) throw new Error('costBps must be non-negative');

  let equity = MICRO_CANARY_POLICY.startingCapitalUsd;
  let peakEquity = equity;
  let maxDrawdownUsd = 0;
  let pos = null;
  let stoppedByLossCap = false;
  let maxObservedOpenPositions = 0;
  let maxObservedNotionalUsd = 0;
  const trades = [];

  const recordEquity = () => {
    peakEquity = Math.max(peakEquity, equity);
    maxDrawdownUsd = Math.max(maxDrawdownUsd, peakEquity - equity);
  };

  for (let i = 1; i < klines.length; i++) {
    const candle = klines[i];
    const open = Number(candle[1]);
    const high = Number(candle[2]);
    const low = Number(candle[3]);
    const close = Number(candle[4]);
    const at = Number(candle[0]);

    if (pos) {
      const stopHit = pos.side === 'LONG' ? low <= pos.sl : high >= pos.sl;
      const targetHit = pos.side === 'LONG' ? high >= pos.tp : low <= pos.tp;
      let exit = null;
      let reason = null;
      if (stopHit) {
        exit = pos.sl;
        reason = targetHit ? 'STOP_FIRST_INTRABAR_AMBIGUITY' : 'STOP';
      } else if (targetHit) {
        exit = pos.tp;
        reason = 'TARGET';
      }
      if (exit !== null) {
        const closed = closeTrade(pos, exit, reason, at, equity, costBps);
        equity = closed.equity;
        trades.push(closed.trade);
        pos = null;
        recordEquity();
      }
    }

    if (MICRO_CANARY_POLICY.startingCapitalUsd - equity >= MICRO_CANARY_POLICY.maxTotalLossUsd) {
      stoppedByLossCap = true;
    }

    const priorSignal = signals[i - 1];
    if (!pos && !stoppedByLossCap && priorSignal && ['LONG', 'SHORT'].includes(priorSignal)) {
      const entry = open;
      const equityFloor = MICRO_CANARY_POLICY.startingCapitalUsd - MICRO_CANARY_POLICY.maxTotalLossUsd;
      const remainingLossBudget = Math.max(0, equity - equityFloor);
      const worstCaseLossRate = MICRO_CANARY_POLICY.stopPct + (costBps / 10_000);
      const lossBoundedNotional = worstCaseLossRate > 0 ? remainingLossBudget / worstCaseLossRate : MICRO_CANARY_POLICY.maxCapitalUsd;
      const notionalUsd = Math.min(equity, MICRO_CANARY_POLICY.maxCapitalUsd, lossBoundedNotional);
      if (notionalUsd <= 0) { stoppedByLossCap = true; continue; }
      const units = notionalUsd / entry;
      const stopDist = entry * MICRO_CANARY_POLICY.stopPct;
      pos = {
        side: priorSignal,
        entry,
        units,
        notionalUsd,
        sl: priorSignal === 'LONG' ? entry - stopDist : entry + stopDist,
        tp: priorSignal === 'LONG' ? entry + stopDist * MICRO_CANARY_POLICY.rewardRisk : entry - stopDist * MICRO_CANARY_POLICY.rewardRisk,
        openedAt: at,
      };
      maxObservedOpenPositions = Math.max(maxObservedOpenPositions, 1);
      maxObservedNotionalUsd = Math.max(maxObservedNotionalUsd, notionalUsd);
    }

    if (i === klines.length - 1 && pos) {
      const closed = closeTrade(pos, close, 'END_OF_WINDOW_MARK', at, equity, costBps);
      equity = closed.equity;
      trades.push(closed.trade);
      pos = null;
      recordEquity();
    }
  }

  const wins = trades.filter(t => t.netPnlUsd > 0);
  const losses = trades.filter(t => t.netPnlUsd < 0);
  const grossWin = wins.reduce((sum, t) => sum + t.netPnlUsd, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.netPnlUsd, 0));
  const netPnlUsd = equity - MICRO_CANARY_POLICY.startingCapitalUsd;
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? null : 0;

  return {
    costBps,
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? round(wins.length / trades.length, 6) : 0,
    netPnlUsd: round(netPnlUsd),
    roiPct: round((netPnlUsd / MICRO_CANARY_POLICY.startingCapitalUsd) * 100, 6),
    expectancyUsd: trades.length ? round(netPnlUsd / trades.length) : 0,
    profitFactor: profitFactor === null ? null : round(profitFactor, 6),
    finalEquityUsd: round(equity),
    maxDrawdownUsd: round(maxDrawdownUsd),
    maxDrawdownPct: round((maxDrawdownUsd / MICRO_CANARY_POLICY.startingCapitalUsd) * 100, 6),
    stoppedByLossCap,
    maxObservedOpenPositions,
    maxObservedNotionalUsd: round(maxObservedNotionalUsd),
    tradesDetail: trades,
  };
}

export function simulateMicroCanary(klines, opts = {}) {
  return simulateFromSignals(klines, referenceSignals(klines), opts);
}

function safeReadJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

export function summarizeResearchGates(root) {
  const forward = safeReadJson(join(root, 'quant-evidence', 'research-forward-shadow-latest.json'));
  const portfolio = safeReadJson(join(root, 'quant-evidence', 'portfolio-risk-research-latest.json'));
  const forwardCandidates = Array.isArray(forward?.candidates) ? forward.candidates : [];
  const forwardEligible = forwardCandidates.filter(candidate =>
    candidate?.nextStageEligible === true &&
    candidate?.executionAuthority !== true &&
    candidate?.capitalEligible !== true &&
    candidate?.liveEligible !== true
  ).length;
  const portfolioReady = portfolio?.status === 'PORTFOLIO_RESEARCH_READY' &&
    portfolio?.paperOnly === true && portfolio?.liveOrders === false &&
    portfolio?.executionAuthority === false && portfolio?.capitalEligible === false;
  return {
    forwardStatus: forward?.status ?? null,
    forwardEligible,
    portfolioStatus: portfolio?.status ?? null,
    portfolioReady,
  };
}

export function buildEvidence({ baseline, stress, gates, generatedAt = new Date().toISOString() }) {
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
      id: MICRO_CANARY_POLICY.strategyId,
      purpose: 'LEGACY_REFERENCE_DIAGNOSTIC_ONLY',
      note: 'Reference PnL is not an Issue-72 promotion candidate and cannot unlock LIVE.',
      pair: MICRO_CANARY_POLICY.pair,
      interval: MICRO_CANARY_POLICY.interval,
      lookbackDays: MICRO_CANARY_POLICY.days,
      params: PARAMS,
    },
    policy: { ...MICRO_CANARY_POLICY },
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

export async function runMicroCanaryPaper({ root = '.', now = new Date() } = {}) {
  validateCanaryPolicy();
  const klines = await fetchKlines(MICRO_CANARY_POLICY.pair, {
    days: MICRO_CANARY_POLICY.days,
    interval: MICRO_CANARY_POLICY.interval,
  });
  if (klines.length < 50) throw new Error(`not enough real Binance candles: ${klines.length}`);
  const baseline = simulateMicroCanary(klines, { costBps: MICRO_CANARY_POLICY.baseCostBps });
  const stress = simulateMicroCanary(klines, { costBps: MICRO_CANARY_POLICY.stressCostBps });
  const gates = summarizeResearchGates(root);
  const evidence = buildEvidence({ baseline, stress, gates, generatedAt: now.toISOString() });
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
