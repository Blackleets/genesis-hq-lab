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
  scores: Record<string, number>; // agentId -> learningScore (0..1)
}

interface StrategyParams {
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
    profitFactor: 0, maxDrawdownPct: 0, avgWinPct: 0, avgLossPct: 0,
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
    returns.push(exitPct);
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
  params: StrategyParams = DEFAULT_PARAMS,
): Promise<LocalLearningSnapshot> {
  const ranAt = new Date().toISOString();
  const results: BacktestResult[] = [];

  for (const pair of pairs) {
    try {
      const closes = await fetchCloses(pair);
      const r = backtest(closes, params);
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
    maxDrawdownPct: aggregate.maxDrawdownPct, avgWinPct: 0, avgLossPct: 0,
  };

  return {
    ok: true, ranAt, source: 'binance-local', results, aggregate,
    scores: scoreAgents(aggAsResult),
  };
}
