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

// ---------- Lookahead guard (P0) ----------
// Views that only expose data up to index i (inclusive). Any attempt to read
// a future index throws RangeError('LOOKAHEAD_AT_CANDLE_<i>') instead of
// silently handing the strategy the future.
function cappedView(arr, i) {
  const cap = i;
  return new Proxy(arr, {
    get(target, prop) {
      if (prop === 'length') return cap + 1;
      if (typeof prop === 'string' && /^\d+$/.test(prop)) {
        const idx = Number(prop);
        if (idx > cap) throw new RangeError(`LOOKAHEAD_AT_CANDLE_${i} (index ${idx} > ${cap})`);
      }
      if (prop === 'slice') {
        return (a = 0, b) => Array.prototype.slice.call(target, a, Math.min(b ?? cap + 1, cap + 1));
      }
      if (prop === 'at') {
        return (k) => {
          const idx = k < 0 ? cap + 1 + k : k;
          if (idx < 0 || idx > cap) throw new RangeError(`LOOKAHEAD_AT_CANDLE_${i} (at(${k}))`);
          return target[idx];
        };
      }
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

function capIndicators(ind, i) {
  const out = {};
  for (const [k, v] of Object.entries(ind || {})) {
    if (Array.isArray(v)) out[k] = cappedView(v, i);
    else if (v && typeof v === 'object') {
      const o = {};
      for (const [k2, arr] of Object.entries(v)) o[k2] = Array.isArray(arr) ? cappedView(arr, i) : arr;
      out[k] = o;
    } else out[k] = v;
  }
  return out;
}

export function createCappedCtx(ctx, i) {
  return {
    ...ctx,
    i,
    candles: cappedView(ctx.candles, i),
    close: cappedView(ctx.close, i),
    open: cappedView(ctx.open, i),
    high: cappedView(ctx.high, i),
    low: cappedView(ctx.low, i),
    vol: cappedView(ctx.vol, i),
    ind: capIndicators(ctx.ind, i),
  };
}

// ---------- Backtest engine ----------
// strategyFn(ctx) -> { long?: boolean, short?: boolean, exit?: boolean, bias?: number }
// ctx = { i, candles, close, open, high, low, vol, ind }
// strictLookahead: strategy only sees data up to candle i; future reads are
//   recorded in result.lookaheadViolations and the signal is rejected.
// signalShift: an entry signal born on candle i fills at the OPEN of candle
//   i+1 (no fill at the same candle that produced the signal).
// protections (optional, Freqtrade --enable-protections style, simulated):
//   { stoplossStreak, cooldownCandles, maxDrawdownPct }
//   - stoplossStreak + cooldownCandles: after `stoplossStreak` consecutive
//     losing trades, entry signals are skipped until `cooldownCandles` candles
//     have passed since the last losing close.
//   - maxDrawdownPct: if current drawdown ((peakEquity - equity)/peakEquity)
//     exceeds the limit, NO further entries for the rest of the backtest.
export function runBacktest({ candles, strategyFn, initialCapital = 10000, feeRate = COST_ROUNDTRIP / 2, riskPct = 0.02, strictLookahead = true, signalShift = true, protections = null }) {
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
  const lookaheadViolations = [];
  let pendingSignal = null; // entry signal born on candle i, fills at open[i+1]

  // --- Simulated protections state (Freqtrade-style guards) ---
  const prot = protections ? {
    stoplossStreak: Number.isFinite(+protections.stoplossStreak) ? +protections.stoplossStreak : 3,
    cooldownCandles: Number.isFinite(+protections.cooldownCandles) ? +protections.cooldownCandles : 4,
    maxDrawdownPct: Number.isFinite(+protections.maxDrawdownPct) ? +protections.maxDrawdownPct : 0.15,
  } : null;
  let consecLosses = 0;      // rolling consecutive losing trades
  let peakEquity = initialCapital;
  let lastLossIdx = null;    // candle index of the last losing close
  let ddLocked = false;      // MaxDrawdown fired -> no entries for the rest
  let ddLockIdx = null;
  const protectionEvents = { entryBlocks: 0, stoplossGuard: 0, drawdownLock: false };

  // Entry gate evaluated BEFORE accepting a signal. Causal: uses only state
  // from candles strictly before i (lastLossIdx is always < i).
  const protectionEntryBlock = (i) => {
    if (!prot) return null;
    if (ddLocked) return 'MAX_DD';
    if (consecLosses >= prot.stoplossStreak && lastLossIdx !== null && (i - lastLossIdx) < prot.cooldownCandles) return 'STOPLOSS_COOLDOWN';
    return null;
  };

  const openPosition = (sig, execIdx, price) => {
    const side = sig.long ? 'long' : 'short';
    const size = cash * riskPct;
    const atrV = ind.atr14[execIdx - 1] || price * 0.01;
    const slMult = sig.slMult ?? 1.5;
    const tpMult = sig.tpMult ?? 2.0;
    position = {
      side, entry: price, size, entryIdx: execIdx,
      stop: side === 'long' ? price - atrV * slMult : price + atrV * slMult,
      target: side === 'long' ? price + atrV * tpMult : price - atrV * tpMult,
      slMult, tpMult,
    };
  };

  for (let i = 1; i < candles.length; i++) {
    // 1) ask the strategy for a signal on candle i (capped view when strict)
    let sig = null;
    try {
      const ctx = strictLookahead
        ? createCappedCtx({ i, candles, close, open, high, low, vol, ind }, i)
        : { i, candles, close, open, high, low, vol, ind };
      sig = strategyFn(ctx) || {};
    } catch (e) {
      if (e instanceof RangeError && String(e.message).startsWith('LOOKAHEAD_AT_CANDLE_')) {
        lookaheadViolations.push({ idx: i, detail: e.message });
        sig = null; // signal rejected, backtest continues honestly
      } else {
        throw e;
      }
    }

    // 1b) protections gate: strip entry flags BEFORE accepting the signal
    // (exit signals still pass through so an open position can be managed).
    if (prot && sig && (sig.long || sig.short)) {
      const blockReason = protectionEntryBlock(i);
      if (blockReason) {
        protectionEvents.entryBlocks++;
        if (blockReason === 'STOPLOSS_COOLDOWN') protectionEvents.stoplossGuard++;
        sig = { ...sig, long: false, short: false };
      }
    }

    // 2) execute a pending entry from the previous candle at THIS candle's open
    if (signalShift && pendingSignal && !position) openPosition(pendingSignal, i, +open[i]);
    pendingSignal = (sig && (sig.long || sig.short)) ? sig : null;

    // 3) manage the position on this candle (intrabar stop/target + strategy exit)
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
        if (prot) {
          if (pnl <= 0) { consecLosses++; lastLossIdx = i; }
          else consecLosses = 0;
        }
        position = null;
      }
    } else if (!signalShift && sig && (sig.long || sig.short)) {
      // legacy path (signalShift = false): fill at the close of the signal candle
      openPosition(sig, i, +candles[i][4]);
    }
    // mark-to-market equity
    let eq = cash;
    if (position) {
      const dir = position.side === 'long' ? 1 : -1;
      eq += dir * (+candles[i][4] - position.entry) / position.entry * position.size;
    }
    equityCurve.push(eq);
    // protections rolling state: peak equity + permanent drawdown lock
    if (prot) {
      if (eq > peakEquity) peakEquity = eq;
      if (!ddLocked && peakEquity > 0 && (peakEquity - eq) / peakEquity > prot.maxDrawdownPct) {
        ddLocked = true;
        ddLockIdx = i;
        protectionEvents.drawdownLock = true;
      }
    }
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

  return {
    trades, equityCurve, finalCapital: cash, initialCapital, lookaheadViolations,
    protectionsActive: !!prot,
    protectionEvents: prot ? { ...protectionEvents, ddLockIdx } : null,
  };
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
    protectionsActive: !!result.protectionsActive,
  };
  if (result.protectionEvents) m.protectionEvents = result.protectionEvents;
  return m;
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
  // Implicit 7th gate: any lookahead violation kills the candidate.
  const nv = Array.isArray(result.lookaheadViolations) ? result.lookaheadViolations.length : 0;
  if (nv > 0) {
    gates.gates.push({ name: 'Lookahead guard', pass: false, value: `${nv} violation(s)` });
    gates.passed = gates.gates.filter(g => g.pass).length;
    gates.total = gates.gates.length;
    gates.go = false;
    gates.reason = 'LOOKAHEAD';
  }
  return { result, metrics, gates };
}
