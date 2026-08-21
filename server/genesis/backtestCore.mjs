// server/genesis/backtestCore.mjs
// Honest backtest engine for Genesis HQ Lab.
// Real-data-first, costs (fee + slippage) included, 6-gate evaluation (+ Sharpe).
// No live trading. PAPER only. The ONLY path to real capital is a human GO
// + API keys + the gates report (see evolutionLoops / terminal).

const COST_ROUNDTRIP = 0.001;     // 0.10% taker round-trip fee (conservative)
const SLIPPAGE = 0.0005;          // 0.05% avg slippage per fill (realistic)
const RISK_FREE = 0;

// ---------- Indicators (pure functions over number[]) ----------
export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) continue;
    if (prev === null) {
      let s = 0;
      for (let j = i - period + 1; j <= i; j++) s += values[j];
      prev = s / period;
    } else {
      prev = values[i] * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

export function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  let gain = 0, loss = 0;
  for (let i = 1; i < values.length; i++) {
    const ch = values[i] - values[i - 1];
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    if (i <= period) {
      gain += g; loss += l;
      if (i === period) {
        gain /= period; loss /= period;
        out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
      }
    } else {
      gain = (gain * (period - 1) + g) / period;
      loss = (loss * (period - 1) + l) / period;
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
  }
  return out;
}

export function atr(candles, period = 14) {
  const tr = new Array(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i][2], l = candles[i][3], pc = candles[i - 1][4];
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  const out = new Array(candles.length).fill(null);
  let prev = null;
  for (let i = 1; i < candles.length; i++) {
    if (i <= period) {
      let s = 0; for (let j = 1; j <= i; j++) s += tr[j];
      prev = s / i;
    } else {
      prev = (prev * (period - 1) + tr[i]) / period;
    }
    out[i] = prev;
  }
  return out;
}

export function bollinger(values, period = 20, mult = 2) {
  const mid = sma(values, period);
  const upper = new Array(values.length).fill(null);
  const lower = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += (values[j] - mid[i]) ** 2;
    const sd = Math.sqrt(s / period);
    upper[i] = mid[i] + mult * sd;
    lower[i] = mid[i] - mult * sd;
  }
  return { mid, upper, lower };
}

export function donchian(candles, period = 20) {
  const upper = new Array(candles.length).fill(null);
  const lower = new Array(candles.length).fill(null);
  for (let i = period; i < candles.length; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      hi = Math.max(hi, candles[j][2]);
      lo = Math.min(lo, candles[j][3]);
    }
    upper[i] = hi; lower[i] = lo;
  }
  return { upper, lower };
}

// ADX — trend strength. <25 = ranging (favor mean reversion), >25 = trending.
export function adx(candles, period = 14) {
  const out = new Array(candles.length).fill(null);
  const plusDM = new Array(candles.length).fill(0);
  const minusDM = new Array(candles.length).fill(0);
  const tr = new Array(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i][2], l = candles[i][3], pc = candles[i - 1][4];
    const up = candles[i][2] - candles[i - 1][2];
    const down = candles[i - 1][3] - candles[i][3];
    plusDM[i] = (up > down && up > 0) ? up : 0;
    minusDM[i] = (down > up && down > 0) ? down : 0;
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  let pDI = 0, mDI = 0, trSm = 0;
  for (let i = 1; i < candles.length; i++) {
    if (i <= period) {
      pDI += plusDM[i]; mDI += minusDM[i]; trSm += tr[i];
      if (i === period) {
        pDI /= period; mDI /= period; trSm /= period;
        const diSum = pDI + mDI || 1;
        out[i] = (Math.abs(pDI - mDI) / diSum) * 100;
      }
    } else {
      pDI = (pDI * (period - 1) + plusDM[i]) / period;
      mDI = (mDI * (period - 1) + minusDM[i]) / period;
      trSm = (trSm * (period - 1) + tr[i]) / period;
      const diSum = pDI + mDI || 1;
      out[i] = (Math.abs(pDI - mDI) / diSum) * 100;
    }
  }
  return out;
}

// ---------- Backtest engine ----------
// strategyFn(ctx) -> { long?: boolean, short?: boolean, exit?: boolean, bias?: number }
// ctx = { i, candles, close, open, high, low, vol, ind }
export function runBacktest({ candles, strategyFn, initialCapital = 10000, feeRate = COST_ROUNDTRIP / 2, riskPct = 0.02 }) {
  const close = candles.map(c => +c[4]);
  const open = candles.map(c => +c[1]);
  const high = candles.map(c => +c[2]);
  const low = candles.map(c => +c[3]);
  const vol = candles.map(c => +c[5]);

  const ind = {
    sma20: sma(close, 20),
    sma50: sma(close, 50),
    ema9: ema(close, 9),
    ema21: ema(close, 21),
    rsi14: rsi(close, 14),
    atr14: atr(candles, 14),
    bb: bollinger(close, 20, 2),
    dc: donchian(candles, 20),
    adx14: adx(candles, 14),
  };

  let cash = initialCapital;
  let position = null; // { side, entry, size, entryIdx }
  const trades = [];
  const equityCurve = [initialCapital];

  for (let i = 1; i < candles.length; i++) {
    const ctx = { i, candles, close, open, high, low, vol, ind };
    const sig = strategyFn(ctx) || {};

    if (position) {
      const dir = position.side === 'long' ? 1 : -1;
      const exitPrice = position.side === 'long' ? low[i] : high[i];
      let exit = sig.exit;
      if (!exit && position.stop && (position.side === 'long' ? low[i] <= position.stop : high[i] >= position.stop)) exit = true;
      if (!exit && position.target && (position.side === 'long' ? high[i] >= position.target : low[i] <= position.target)) exit = true;
      if (exit) {
        const px = position.target && (position.side === 'long' ? high[i] >= position.target : low[i] <= position.target) ? position.target : +candles[i][4];
        // slippage applied on both entry and exit fills
        const fillEntry = position.side === 'long' ? position.entry * (1 + SLIPPAGE) : position.entry * (1 - SLIPPAGE);
        const fillExit = position.side === 'long' ? px * (1 - SLIPPAGE) : px * (1 + SLIPPAGE);
        const pnl = dir * (fillExit - fillEntry) / fillEntry * position.size - position.size * feeRate * 2;
        cash += pnl;
        trades.push({ side: position.side, entry: position.entry, exit: px, pnl, size: position.size, entryIdx: position.entryIdx, exitIdx: i, bars: i - position.entryIdx });
        position = null;
      }
    } else if (sig.long || sig.short) {
      const side = sig.long ? 'long' : 'short';
      const price = +candles[i][4];
      const size = cash * riskPct;
      const atr = ind.atr14[i] || price * 0.01;
      const slMult = sig.slMult ?? 1.5;
      const tpMult = sig.tpMult ?? 2.0;
      position = {
        side, entry: price, size, entryIdx: i,
        stop: side === 'long' ? price - atr * slMult : price + atr * slMult,
        target: side === 'long' ? price + atr * tpMult : price - atr * tpMult,
        slMult, tpMult,
      };
    }
    // mark-to-market equity
    let eq = cash;
    if (position) {
      const dir = position.side === 'long' ? 1 : -1;
      eq += dir * (+candles[i][4] - position.entry) / position.entry * position.size;
    }
    equityCurve.push(eq);
  }
  // force-close at end
  if (position) {
    const px = +candles[candles.length - 1][4];
    const dir = position.side === 'long' ? 1 : -1;
    const fillEntry = position.side === 'long' ? position.entry * (1 + SLIPPAGE) : position.entry * (1 - SLIPPAGE);
    const fillExit = position.side === 'long' ? px * (1 - SLIPPAGE) : px * (1 + SLIPPAGE);
    const pnl = dir * (fillExit - fillEntry) / fillEntry * position.size - position.size * feeRate * 2;
    cash += pnl;
    trades.push({ side: position.side, entry: position.entry, exit: px, pnl, size: position.size, entryIdx: position.entryIdx, exitIdx: candles.length - 1, bars: candles.length - 1 - position.entryIdx });
  }

  return { trades, equityCurve, finalCapital: cash, initialCapital };
}

// ---------- Metrics + 6 gates ----------
export function computeMetrics(result) {
  const { trades, equityCurve, initialCapital, finalCapital } = result;
  const closed = trades.filter(t => t.exit !== undefined);
  const wins = closed.filter(t => t.pnl > 0);
  const losses = closed.filter(t => t.pnl <= 0);
  const n = closed.length;
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const winRate = n ? wins.length / n : 0;
  const pf = grossLoss === 0 ? (grossProfit > 0 ? Infinity : 0) : grossProfit / grossLoss;
  const expectancy = n ? closed.reduce((s, t) => s + t.pnl, 0) / n : 0;
  const avgPct = n ? closed.reduce((s, t) => {
    const notional = t.size || t.entry || 1;
    return s + (t.pnl / notional) * 100;
  }, 0) / n : 0;
  // t-stat of per-trade returns
  const rets = closed.map(t => t.pnl);
  const mean = rets.reduce((s, r) => s + r, 0) / (rets.length || 1);
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length || 1);
  const tstat = variance > 0 ? mean / Math.sqrt(variance / (rets.length || 1)) : 0;
  // Sharpe (per-trade, annualized-ish): mean / std of returns
  const std = Math.sqrt(variance);
  const sharpe = std > 0 ? mean / std : 0;
  // max drawdown from equity curve
  let peak = -Infinity, maxDD = 0;
  for (const e of equityCurve) {
    if (e > peak) peak = e;
    const dd = peak > 0 ? (peak - e) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }
  return {
    trades: n, wins: wins.length, losses: losses.length,
    winRate, profitFactor: pf, expectancy, expectancyPctPerTrade: avgPct,
    tstat, sharpe, maxDrawdown: maxDD,
    finalCapital, initialCapital, returnPct: (finalCapital - initialCapital) / initialCapital,
  };
}

export function evaluateGates(m) {
  const gates = [
    { name: 'Sample >= 50 trades', pass: m.trades >= 50, value: m.trades },
    { name: 'Win rate >= 45%', pass: m.winRate >= 0.45, value: (m.winRate * 100).toFixed(1) + '%' },
    { name: 'Profit factor >= 1.30', pass: m.profitFactor >= 1.30, value: isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : 'inf' },
    { name: 'Expectancy > 0.05%/trade', pass: m.expectancyPctPerTrade > 0.05, value: m.expectancyPctPerTrade.toFixed(3) + '%' },
    { name: 't-stat >= 2.0', pass: m.tstat >= 2.0, value: m.tstat.toFixed(2) },
    { name: 'Drawdown <= 25%', pass: m.maxDrawdown <= 0.25, value: (m.maxDrawdown * 100).toFixed(1) + '%' },
  ];
  const passed = gates.filter(g => g.pass).length;
  return { gates, passed, total: gates.length, go: passed === gates.length };
}

export function fullReport(candles, strategyFn, opts = {}) {
  const result = runBacktest({ candles, strategyFn, ...opts });
  const metrics = computeMetrics(result);
  const gates = evaluateGates(metrics);
  return { result, metrics, gates };
}
