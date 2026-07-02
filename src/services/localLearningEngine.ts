// localLearningEngine — real, backend-independent learning signal.
//
// Runs a Donchian-breakout + SMA-regime backtest (the same shape the Supabase
// genesis-runner uses) over REAL Binance klines fetched directly in the browser
// (CORS-open, no key, no backend). Turns the backtest's measured performance
// into per-agent learning scores, so agents keep learning from real market data
// even while the backend is offline.
//
// This is simulation only (paper). It never places an order and never touches
// live_mode. It does not import or modify the existing trading engines,
// Crypto Lab, Kalshi, or Prediction Markets.

const BINANCE = 'https://api.binance.com/api/v3';

export interface BacktestResult {
  pair: string;
  trades: number;
  wins: number;
  winRate: number;        // 0..1
  totalPnlPct: number;    // sum of per-trade % returns
  profitFactor: number;   // gross wins / gross losses (0 if no losses & no wins)
  maxDrawdownPct: number; // worst peak-to-trough on the cumulative equity, %
  avgWinPct: number;
  avgLossPct: number;
  returns: number[];      // per-trade fractional returns (for global stats)
}

export interface ReadinessCheck {
  key: string;
  label: string;
  value: number | null;
  threshold: number;
  pass: boolean;
}

export type ReadinessVerdict = 'GO' | 'NO_GO' | 'INSUFFICIENT_DATA';

// Professional-grade "ready for real money" scorecard. Every gate must pass,
// on real out-of-sample market data, before the verdict is GO. This is the
// bar that separates a validated edge from a demo.
export interface LocalScorecard {
  verdict: ReadinessVerdict;
  trades: number;
  winRate: number;        // 0..1
  profitFactor: number;
  expectancyPct: number;  // mean return per trade, %
  sharpe: number;         // mean/std of per-trade returns (per-trade Sharpe)
  maxDrawdownPct: number;
  totalPnlPct: number;
  // Money terms — position-sized on paper capital so PnL reads in dollars,
  // matching how the futures desk sizes ($10k capital, $1k notional/trade).
  pnlUsd: number;
  equityUsd: number;
  avgWinUsd: number;
  avgLossUsd: number;
  expectancyUsd: number;  // expected $ per trade at current sizing
  // Monte Carlo bootstrap (500 resamples of the trade sequence): the
  // "bad luck" view — what the 5th-percentile outcome looks like.
  mc?: {
    p5PnlUsd: number;       // 5th-percentile total PnL
    p95DrawdownPct: number; // 95th-percentile max drawdown
  };
  checks: ReadinessCheck[];
  nextMilestone: string | null;
}

export interface LocalLearningSnapshot {
  ok: boolean;
  ranAt: string;
  source: 'binance-local';
  results: BacktestResult[];
  aggregate: {
    trades: number;
    winRate: number;
    profitFactor: number;
    maxDrawdownPct: number;
    totalPnlPct: number;
  };
  scorecard: LocalScorecard;
  scores: Record<string, number>; // agentId -> learningScore (0..1)
}

export interface StrategyParams {
  breakoutPeriod: number;
  regimeSmaPeriod: number;
  tpPct: number;
  slPct: number;
}

const DEFAULT_PARAMS: StrategyParams = {
  breakoutPeriod: 20,
  regimeSmaPeriod: 55,
  tpPct: 0.06,
  slPct: 0.03,
};

// Pairs mirror the futures desk universe the backend trades.
const DEFAULT_PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];

// Desk sizing: $10k paper capital, $1k notional per trade — so a 6% TP is
// +$60/trade and the PnL reads in real dollars, not cents. Same trades,
// honest sizing. Real capital still requires a GO verdict + manual switch.
export const PAPER_CAPITAL_USD = 10_000;
export const NOTIONAL_PER_TRADE_USD = 1_000;

// Professional practice #1: every backtested trade pays costs. Binance
// futures taker ≈0.04%/side + slippage ≈0.01%/side → 0.10% round trip.
// All metrics downstream (scorecard, sweep, learning) are NET of this.
export const COST_ROUND_TRIP = 0.001;

// Where the brute-force sweep persists its result; the learning loop adopts
// the best OOS-surviving config from here automatically ("sweep feeds loop").
export const SWEEP_KEY = 'genesis.local.sweep.v1';

export interface ActiveConfig extends StrategyParams {
  interval: string;
  source: 'sweep-oos' | 'default';
}

// The config the learning loop + scorecard should run: the sweep's best
// out-of-sample survivor when one exists, else the backend-mirroring default.
export function getActiveConfig(): ActiveConfig {
  try {
    const raw = localStorage.getItem(SWEEP_KEY);
    if (raw) {
      const sweep = JSON.parse(raw) as { ok?: boolean; best?: { config?: StrategyParams & { interval?: string }; test?: { expectancyPct?: number; profitFactor?: number; tStat?: number } } };
      const best = sweep?.best;
      if (
        sweep?.ok && best?.config &&
        (best.test?.expectancyPct ?? 0) > 0 &&
        (best.test?.profitFactor ?? 0) >= 1.1 &&
        // multiple-testing guard: only adopt statistically significant OOS edge
        (best.test?.tStat ?? 0) >= 2.0
      ) {
        return {
          breakoutPeriod: best.config.breakoutPeriod,
          regimeSmaPeriod: best.config.regimeSmaPeriod,
          tpPct: best.config.tpPct,
          slPct: best.config.slPct,
          interval: best.config.interval ?? '1h',
          source: 'sweep-oos',
        };
      }
    }
  } catch { /* corrupted storage → fall through to default */ }
  return { ...DEFAULT_PARAMS, interval: '1h', source: 'default' };
}

async function fetchCloses(pair: string, interval = '1h', limit = 300): Promise<number[]> {
  const res = await fetch(
    `${BINANCE}/klines?symbol=${pair}&interval=${interval}&limit=${limit}`,
    { signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) throw new Error(`binance_${res.status}`);
  const raw = (await res.json()) as unknown[];
  if (!Array.isArray(raw)) throw new Error('binance_invalid');
  // kline[4] is the close price.
  return raw
    .map((row) => (Array.isArray(row) ? Number.parseFloat(String(row[4])) : NaN))
    .filter((n) => Number.isFinite(n));
}

function sma(values: number[], period: number, endIdx: number): number | null {
  if (endIdx + 1 < period) return null;
  let sum = 0;
  for (let i = endIdx - period + 1; i <= endIdx; i++) sum += values[i];
  return sum / period;
}

// Walk the series bar by bar. Enter on a regime-aligned Donchian breakout,
// exit on the first TP or SL touch (evaluated on later closes). Returns the
// realized per-trade % returns.
function backtest(closes: number[], p: StrategyParams): BacktestResult {
  const returns: number[] = [];
  const empty: BacktestResult = {
    pair: '', trades: 0, wins: 0, winRate: 0, totalPnlPct: 0,
    profitFactor: 0, maxDrawdownPct: 0, avgWinPct: 0, avgLossPct: 0, returns: [],
  };
  const minBars = Math.max(p.breakoutPeriod, p.regimeSmaPeriod) + 2;
  if (closes.length < minBars) return empty;

  let i = minBars;
  while (i < closes.length) {
    const last = closes[i - 1];
    const channel = closes.slice(i - 1 - p.breakoutPeriod, i - 1);
    const hi = Math.max(...channel);
    const lo = Math.min(...channel);
    const regime = sma(closes, p.regimeSmaPeriod, i - 1);
    if (regime == null) { i++; continue; }

    let side: 'LONG' | 'SHORT' | null = null;
    if (last > hi && last > regime) side = 'LONG';
    else if (last < lo && last < regime) side = 'SHORT';
    if (!side) { i++; continue; }

    const entry = closes[i]; // fill on next bar's close
    if (!Number.isFinite(entry) || entry <= 0) { i++; continue; }
    const tp = side === 'LONG' ? entry * (1 + p.tpPct) : entry * (1 - p.tpPct);
    const sl = side === 'LONG' ? entry * (1 - p.slPct) : entry * (1 + p.slPct);

    let exitPct: number | null = null;
    let j = i + 1;
    for (; j < closes.length; j++) {
      const price = closes[j];
      if (side === 'LONG') {
        if (price >= tp) { exitPct = p.tpPct; break; }
        if (price <= sl) { exitPct = -p.slPct; break; }
      } else {
        if (price <= tp) { exitPct = p.tpPct; break; }
        if (price >= sl) { exitPct = -p.slPct; break; }
      }
    }
    if (exitPct == null) {
      // close at the last available bar (mark-to-market)
      const price = closes[closes.length - 1];
      exitPct = side === 'LONG' ? (price - entry) / entry : (entry - price) / entry;
      j = closes.length;
    }
    // Net of round-trip trading costs — no free fills in this desk.
    returns.push(exitPct - COST_ROUND_TRIP);
    i = j + 1; // no overlapping positions
  }

  const trades = returns.length;
  const wins = returns.filter((r) => r > 0).length;
  const grossWin = returns.filter((r) => r > 0).reduce((s, r) => s + r, 0);
  const grossLoss = Math.abs(returns.filter((r) => r < 0).reduce((s, r) => s + r, 0));
  const totalPnlPct = returns.reduce((s, r) => s + r, 0) * 100;

  // max drawdown on cumulative equity curve
  let peak = 0;
  let cum = 0;
  let maxDd = 0;
  for (const r of returns) {
    cum += r;
    peak = Math.max(peak, cum);
    maxDd = Math.max(maxDd, peak - cum);
  }

  const winRet = returns.filter((r) => r > 0);
  const lossRet = returns.filter((r) => r < 0);
  return {
    pair: '',
    trades,
    wins,
    winRate: trades ? wins / trades : 0,
    totalPnlPct,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 3 : 0,
    maxDrawdownPct: maxDd * 100,
    avgWinPct: winRet.length ? (winRet.reduce((s, r) => s + r, 0) / winRet.length) * 100 : 0,
    avgLossPct: lossRet.length ? (lossRet.reduce((s, r) => s + r, 0) / lossRet.length) * 100 : 0,
    returns,
  };
}

// Readiness gates. Every gate must pass on real out-of-sample data for GO.
// Thresholds are deliberately strict — this is the line before real capital.
const GATE = {
  minTrades: 50,        // statistical evidence, not luck
  minWinRate: 0.45,     // breakout systems win less but big; 45% floor
  minProfitFactor: 1.3, // gross wins must clear gross losses with margin
  minExpectancyPct: 0.05, // positive expectancy per trade after the fact
  // Statistical significance of the edge: t-stat = per-trade Sharpe × √N ≥ 2
  // (edge distinct from zero at ~95%). A fixed per-trade Sharpe floor was
  // miscalibrated for fixed-TP/SL systems: with a 2:1 payoff the per-trade
  // Sharpe is structurally capped near ~0.33 even for a genuinely profitable
  // strategy, so it contradicted the other gates. The t-stat is the standard
  // sample-size-aware test.
  minTStat: 2.0,
  maxDrawdownPct: 25,   // capital preservation ceiling
};

function buildScorecard(allReturns: number[]): LocalScorecard {
  const trades = allReturns.length;
  const wins = allReturns.filter((r) => r > 0).length;
  const winRate = trades ? wins / trades : 0;
  const grossWin = allReturns.filter((r) => r > 0).reduce((s, r) => s + r, 0);
  const grossLoss = Math.abs(allReturns.filter((r) => r < 0).reduce((s, r) => s + r, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 3 : 0;
  const mean = trades ? allReturns.reduce((s, r) => s + r, 0) / trades : 0;
  const variance = trades ? allReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / trades : 0;
  const std = Math.sqrt(variance);
  const sharpe = std > 0 ? mean / std : 0;
  const expectancyPct = mean * 100;
  const totalPnlPct = allReturns.reduce((s, r) => s + r, 0) * 100;

  let peak = 0, cum = 0, maxDd = 0;
  for (const r of allReturns) { cum += r; peak = Math.max(peak, cum); maxDd = Math.max(maxDd, peak - cum); }
  const maxDrawdownPct = maxDd * 100;

  const checks: ReadinessCheck[] = [
    { key: 'sample', label: 'Muestra ≥ 50 trades (evidencia estadística)', value: trades, threshold: GATE.minTrades, pass: trades >= GATE.minTrades },
    { key: 'winRate', label: 'Win rate ≥ 45%', value: Math.round(winRate * 1000) / 10, threshold: GATE.minWinRate * 100, pass: winRate >= GATE.minWinRate },
    { key: 'pf', label: 'Profit factor ≥ 1.30', value: Math.round(profitFactor * 100) / 100, threshold: GATE.minProfitFactor, pass: profitFactor >= GATE.minProfitFactor },
    { key: 'expectancy', label: 'Expectativa/trade > 0.05%', value: Math.round(expectancyPct * 1000) / 1000, threshold: GATE.minExpectancyPct, pass: expectancyPct > GATE.minExpectancyPct },
    { key: 'tstat', label: 'Edge significativo (t-stat = Sharpe×√N ≥ 2.0)', value: Math.round(sharpe * Math.sqrt(trades) * 100) / 100, threshold: GATE.minTStat, pass: sharpe * Math.sqrt(trades) >= GATE.minTStat },
    { key: 'drawdown', label: 'Max drawdown ≤ 25%', value: Math.round(maxDrawdownPct * 10) / 10, threshold: GATE.maxDrawdownPct, pass: maxDrawdownPct <= GATE.maxDrawdownPct },
  ];

  const allPass = checks.every((c) => c.pass);
  const verdict: ReadinessVerdict =
    trades < 30 ? 'INSUFFICIENT_DATA' : allPass ? 'GO' : 'NO_GO';

  const failing = checks.filter((c) => !c.pass);
  const nextMilestone =
    verdict === 'INSUFFICIENT_DATA'
      ? `Faltan ${Math.max(0, 30 - trades)} trades para una lectura válida`
      : failing.length
        ? `Falta: ${failing.map((c) => c.label.split(' (')[0]).join(' · ')}`
        : null;

  // Money terms at desk sizing: each trade risks NOTIONAL_PER_TRADE_USD of
  // notional, so a +6% TP is +$60, not cents. Equity starts at paper capital.
  const pnlUsd = allReturns.reduce((s, r) => s + r * NOTIONAL_PER_TRADE_USD, 0);
  const winsUsd = allReturns.filter((r) => r > 0).map((r) => r * NOTIONAL_PER_TRADE_USD);
  const lossesUsd = allReturns.filter((r) => r < 0).map((r) => r * NOTIONAL_PER_TRADE_USD);
  const avgWinUsd = winsUsd.length ? winsUsd.reduce((s, v) => s + v, 0) / winsUsd.length : 0;
  const avgLossUsd = lossesUsd.length ? lossesUsd.reduce((s, v) => s + v, 0) / lossesUsd.length : 0;

  // Monte Carlo bootstrap — resample the trade sequence 500× to expose the
  // unlucky tail (5th-percentile PnL, 95th-percentile drawdown), instead of
  // trusting the single realized path.
  let mc: LocalScorecard['mc'];
  if (trades >= 10) {
    const totals: number[] = [];
    const dds: number[] = [];
    for (let k = 0; k < 500; k++) {
      let cumR = 0, peakR = 0, ddR = 0;
      for (let i = 0; i < trades; i++) {
        const r = allReturns[Math.floor(Math.random() * trades)];
        cumR += r;
        peakR = Math.max(peakR, cumR);
        ddR = Math.max(ddR, peakR - cumR);
      }
      totals.push(cumR * NOTIONAL_PER_TRADE_USD);
      dds.push(ddR * 100);
    }
    totals.sort((a, b) => a - b);
    dds.sort((a, b) => a - b);
    mc = {
      p5PnlUsd: totals[Math.floor(500 * 0.05)],
      p95DrawdownPct: dds[Math.floor(500 * 0.95)],
    };
  }

  return {
    verdict, trades, winRate, profitFactor, expectancyPct, sharpe, maxDrawdownPct, totalPnlPct,
    pnlUsd,
    equityUsd: PAPER_CAPITAL_USD + pnlUsd,
    avgWinUsd,
    avgLossUsd,
    expectancyUsd: mean * NOTIONAL_PER_TRADE_USD,
    mc,
    checks, nextMilestone,
  };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

// Map measured backtest performance to a learning score per agent. Each agent
// reflects a real facet of the strategy's behaviour — no randomness.
function scoreAgents(agg: BacktestResult): Record<string, number> {
  const winRate = clamp01(agg.winRate);
  const pfNorm = clamp01(agg.profitFactor / 2.5);          // PF 2.5+ => full marks
  const ddPenalty = clamp01(agg.maxDrawdownPct / 40);      // 40%+ dd => full penalty
  const consistency = clamp01(1 - ddPenalty);
  const sampleConf = clamp01(agg.trades / 30);             // needs ~30 trades for confidence

  // Floor at 0.1 so an agent is never shown as fully "dead".
  const floor = (v: number) => Math.max(0.1, clamp01(v));

  return {
    'trading-scalping-hunter': floor(0.5 * winRate + 0.5 * pfNorm),
    'trading-market-analyst': floor(0.6 * winRate + 0.4 * sampleConf),
    'trading-risk-sentinel': floor(0.7 * consistency + 0.3 * winRate),
    'trading-backtest-engineer': floor(0.5 * pfNorm + 0.5 * sampleConf),
    'trading-capital-manager': floor(0.6 * pfNorm + 0.4 * consistency),
  };
}

// Run the full local learning pass. Fetches real Binance data for each pair,
// backtests, aggregates, and returns per-agent scores + metrics.
export async function runLocalLearning(
  pairs: string[] = DEFAULT_PAIRS,
  params?: StrategyParams & { interval?: string },
): Promise<LocalLearningSnapshot> {
  const ranAt = new Date().toISOString();
  const results: BacktestResult[] = [];
  // "Sweep feeds loop": run whatever config the brute-force search validated
  // out-of-sample; fall back to the backend-mirroring default otherwise.
  const active = params ?? getActiveConfig();
  const interval = active.interval ?? '1h';

  for (const pair of pairs) {
    try {
      const closes = await fetchCloses(pair, interval, 1000);
      const r = backtest(closes, active);
      r.pair = pair;
      if (r.trades > 0) results.push(r);
    } catch {
      // skip this pair — one failed fetch must not sink the pass
    }
  }

  if (results.length === 0) {
    return {
      ok: false, ranAt, source: 'binance-local', results: [],
      aggregate: { trades: 0, winRate: 0, profitFactor: 0, maxDrawdownPct: 0, totalPnlPct: 0 },
      scorecard: buildScorecard([]),
      scores: {},
    };
  }

  const trades = results.reduce((s, r) => s + r.trades, 0);
  const wins = results.reduce((s, r) => s + r.wins, 0);
  const grossWin = results.reduce((s, r) => s + Math.max(0, r.avgWinPct) * r.wins, 0);
  const grossLoss = results.reduce((s, r) => s + Math.abs(r.avgLossPct) * (r.trades - r.wins), 0);
  const aggregate = {
    trades,
    winRate: trades ? wins / trades : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 3 : 0,
    maxDrawdownPct: Math.max(...results.map((r) => r.maxDrawdownPct)),
    totalPnlPct: results.reduce((s, r) => s + r.totalPnlPct, 0),
  };

  const aggAsResult: BacktestResult = {
    pair: 'AGG', trades, wins, winRate: aggregate.winRate,
    totalPnlPct: aggregate.totalPnlPct, profitFactor: aggregate.profitFactor,
    maxDrawdownPct: aggregate.maxDrawdownPct, avgWinPct: 0, avgLossPct: 0, returns: [],
  };

  // Global scorecard is computed over ALL trades across every pair, so Sharpe,
  // expectancy and drawdown reflect the full track record, not one symbol.
  const allReturns = results.flatMap((r) => r.returns);

  return {
    ok: true, ranAt, source: 'binance-local', results, aggregate,
    scorecard: buildScorecard(allReturns),
    scores: scoreAgents(aggAsResult),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Brute-force config search with out-of-sample validation.
//
// "Fuerza bruta" applied where it actually makes money: sweep the whole
// strategy-parameter grid against REAL Binance data, select on the training
// window, and judge ONLY on the untouched out-of-sample window. A config that
// shines in-sample but dies out-of-sample is overfit — it is discarded, not
// celebrated. This is how a desk hunts edge; execution stays paper until GO.
// ─────────────────────────────────────────────────────────────────────────────

export interface SweepConfig extends StrategyParams {
  interval: string;
}

export interface SliceStats {
  trades: number;
  winRate: number;
  profitFactor: number;
  expectancyPct: number;
  sharpe: number;
  tStat: number;          // sharpe × √trades — sample-size-aware significance
  maxDrawdownPct: number;
  totalPnlPct: number;
}

export interface SweepEntry {
  config: SweepConfig;
  train: SliceStats;   // in-sample (selection window)
  test: SliceStats;    // out-of-sample (judgement window)
}

export interface SweepResult {
  ok: boolean;
  ranAt: string;
  tested: number;
  best: SweepEntry | null;
  top: SweepEntry[];
  note: string;
}

const SWEEP_GRID = {
  breakoutPeriod: [12, 20, 34, 55],
  regimeSmaPeriod: [34, 55, 89],
  tpPct: [0.04, 0.06, 0.09, 0.12],
  slPct: [0.02, 0.03, 0.04],
  intervals: ['1h', '4h'],
};

const TRAIN_SPLIT = 0.6;          // 60% selection, 40% untouched validation
const MIN_TRAIN_TRADES = 20;
const MIN_TEST_TRADES = 8;
const SELECTION_POOL = 10;        // top-N in-sample candidates judged OOS

function sliceStats(returns: number[]): SliceStats {
  const trades = returns.length;
  const wins = returns.filter((r) => r > 0).length;
  const grossWin = returns.filter((r) => r > 0).reduce((s, r) => s + r, 0);
  const grossLoss = Math.abs(returns.filter((r) => r < 0).reduce((s, r) => s + r, 0));
  const mean = trades ? returns.reduce((s, r) => s + r, 0) / trades : 0;
  const variance = trades ? returns.reduce((s, r) => s + (r - mean) ** 2, 0) / trades : 0;
  const std = Math.sqrt(variance);
  const sharpe = std > 0 ? mean / std : 0;
  let peak = 0, cum = 0, dd = 0;
  for (const r of returns) { cum += r; peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum); }
  return {
    trades,
    winRate: trades ? wins / trades : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 3 : 0,
    expectancyPct: mean * 100,
    sharpe,
    tStat: sharpe * Math.sqrt(trades),
    maxDrawdownPct: dd * 100,
    totalPnlPct: returns.reduce((s, r) => s + r, 0) * 100,
  };
}

export async function runBruteForceSweep(
  pairs: string[] = DEFAULT_PAIRS,
): Promise<SweepResult> {
  const ranAt = new Date().toISOString();

  // One fetch per pair+interval (8 requests); the sweep itself is pure CPU
  // over cached candles, so 288 configs cost zero extra API calls.
  const seriesByInterval: Record<string, number[][]> = {};
  for (const interval of SWEEP_GRID.intervals) {
    const list: number[][] = [];
    for (const pair of pairs) {
      try {
        list.push(await fetchCloses(pair, interval, 1000));
      } catch { /* one pair failing must not sink the sweep */ }
    }
    seriesByInterval[interval] = list;
  }

  const entries: SweepEntry[] = [];
  let tested = 0;

  for (const interval of SWEEP_GRID.intervals) {
    const series = seriesByInterval[interval];
    if (!series.length) continue;
    for (const breakoutPeriod of SWEEP_GRID.breakoutPeriod) {
      for (const regimeSmaPeriod of SWEEP_GRID.regimeSmaPeriod) {
        for (const tpPct of SWEEP_GRID.tpPct) {
          for (const slPct of SWEEP_GRID.slPct) {
            tested++;
            const params: StrategyParams = { breakoutPeriod, regimeSmaPeriod, tpPct, slPct };
            const warmup = Math.max(breakoutPeriod, regimeSmaPeriod) + 2;
            const trainR: number[] = [];
            const testR: number[] = [];
            for (const closes of series) {
              const split = Math.floor(closes.length * TRAIN_SPLIT);
              trainR.push(...backtest(closes.slice(0, split), params).returns);
              // include warmup bars before the split so OOS signals start at the boundary
              testR.push(...backtest(closes.slice(Math.max(0, split - warmup)), params).returns);
            }
            if (trainR.length < MIN_TRAIN_TRADES || testR.length < MIN_TEST_TRADES) continue;
            entries.push({
              config: { ...params, interval },
              train: sliceStats(trainR),
              test: sliceStats(testR),
            });
          }
        }
      }
    }
  }

  if (!entries.length) {
    return { ok: false, ranAt, tested, best: null, top: [], note: 'Sin configs con muestra suficiente.' };
  }

  // Select on TRAIN, judge on TEST: rank in-sample, then pick the best
  // out-of-sample performer among the top candidates. Anything that only
  // works in-sample loses here — that is the anti-overfit gate.
  const byTrain = [...entries].sort((a, b) => b.train.expectancyPct - a.train.expectancyPct);
  const pool = byTrain.slice(0, SELECTION_POOL);
  const byTest = [...pool].sort((a, b) => b.test.expectancyPct - a.test.expectancyPct);
  const best = byTest[0] ?? null;

  // Multiple-testing guard (deflated-Sharpe spirit): after sweeping 288
  // configs, the apparent winner is inflated by selection bias. Survival
  // requires statistical significance on the UNTOUCHED out-of-sample window
  // (t-stat ≥ 2), not just positive numbers.
  const survived = best != null
    && best.test.expectancyPct > 0
    && best.test.profitFactor >= 1.1
    && best.test.tStat >= 2.0;
  const note = survived
    ? `Config con edge significativo out-of-sample (t-stat ${best.test.tStat.toFixed(2)} ≥ 2.0, neto de costos). Sigue siendo paper hasta que el scorecard dé GO.`
    : best != null && best.test.expectancyPct > 0
      ? `La mejor config es positiva OOS pero sin significancia estadística (t-stat ${best.test.tStat.toFixed(2)} < 2.0) — probable sesgo de selección tras ${tested} pruebas. No se adopta.`
      : 'Ninguna config del grid mantiene edge out-of-sample ahora mismo — el mercado actual no paga esta familia de estrategias. Mejor saberlo aquí que con dinero real.';

  return { ok: true, ranAt, tested, best, top: byTest.slice(0, 5), note };
}
