// breakoutShadow.mjs — live, read-only shadow of the regime-switch breakout strategy.
//
// The regime-switch breakout (regimeSwitchBreakoutSignal) is the first strategy to pass
// multi-window walk-forward (positive EV & PF>1 in 6/6 windows; see breakoutWalkForward.mjs).
// Before any paper/live decision it must be OBSERVED on live data. This module does exactly
// that — and nothing else. It NEVER touches the execution engine, risk, Kelly, or any order.
//
// It is STATELESS by design: a 4h-strategy shadow re-derives its signals by replaying the
// SAME backtest over the most recent real 4h klines from Binance (always available), so there
// is nothing to persist — every call reconstructs the current rolling picture, including the
// latest CLOSED 4h bars. A 4h-aware shadow can't reuse the 1m live-snapshot harness
// (shadowCandidate.mjs); it needs 4h bars, which is the whole point of this module.

import { fetchKlines } from './backtest/historicalData.mjs';
import { runBacktest } from './backtest/backtestEngine.mjs';
import { computeMetrics } from './backtest/metrics.mjs';
import { regimeSwitchBreakoutSignal } from './backtest/strategyLab.mjs';

export const BREAKOUT_SHADOW_CONFIG = Object.freeze({
  candidateId: 'regime_breakout_4h_v1',
  pairs: (process.env.BSHADOW_PAIRS ?? 'BTCUSDT,ETHUSDT,SOLUSDT').split(','),
  interval: '4h',
  days: parseInt(process.env.BSHADOW_DAYS ?? '120', 10),
  breakoutPeriod: parseInt(process.env.BSHADOW_PERIOD ?? '55', 10),
  regimeSmaPeriod: parseInt(process.env.BSHADOW_SMA ?? '200', 10),
  targetPct: parseFloat(process.env.BSHADOW_TP ?? '0.08'),
  stopPct: parseFloat(process.env.BSHADOW_SL ?? '0.03'),
  timeoutHours: parseInt(process.env.BSHADOW_TIMEOUT_H ?? '240', 10),
  warmup: parseInt(process.env.BSHADOW_WARMUP ?? '220', 10),
});

const TTL_MS = parseInt(process.env.BSHADOW_TTL_MS ?? '900000', 10); // 15 min — 4h bars move slowly
let _cache = { at: 0, payload: null };

function simpleSma(values, period) {
  if (!Array.isArray(values) || period <= 0 || values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

function pickMetrics(m) {
  return { trades: m.trades, winRate: m.winRate, netPnl: m.netPnl, expectancy: m.expectancy, profitFactor: m.profitFactor, maxDrawdown: m.maxDrawdown };
}

/**
 * Pure summariser — turns already-fetched trades + current per-pair state into the read-only
 * shadow payload. No I/O, so it's unit-testable without the network.
 */
export function buildShadowReport({ allTrades, currentByPair, window, config = BREAKOUT_SHADOW_CONFIG }) {
  const byPair = config.pairs.map((pair) => {
    const t = allTrades.filter((x) => x.pair === pair);
    const m = computeMetrics(t);
    return { pair, trades: m.trades, netPnl: m.netPnl, winRate: m.winRate, profitFactor: m.profitFactor };
  });
  const recent = [...allTrades]
    .sort((a, b) => b.openTime - a.openTime)
    .slice(0, 15)
    .map((t) => ({ pair: t.pair, side: t.side, openTime: t.openTime, entryPrice: t.entryPrice, exitPrice: t.exitPrice, pnl: t.pnl, exitReason: t.exitReason }));

  return {
    candidateId: config.candidateId,
    mode: 'shadow-observe',
    config: {
      pairs: [...config.pairs], interval: config.interval, days: config.days,
      breakoutPeriod: config.breakoutPeriod, regimeSmaPeriod: config.regimeSmaPeriod,
      targetPct: config.targetPct, stopPct: config.stopPct, timeoutHours: config.timeoutHours,
    },
    window,
    combined: pickMetrics(computeMetrics(allTrades)),
    short: pickMetrics(computeMetrics(allTrades.filter((t) => t.side === 'SHORT'))),
    long: pickMetrics(computeMetrics(allTrades.filter((t) => t.side === 'LONG'))),
    byPair,
    current: currentByPair,
    recent,
    note: 'Read-only shadow. Re-derived from live 4h klines each refresh. Never executes any order.',
  };
}

/** Current per-pair regime + whether the latest CLOSED 4h bar is signalling. */
function currentState(pair, closedKlines, config) {
  const closes = closedKlines.map((c) => parseFloat(c[4]));
  const price = closes[closes.length - 1];
  const sma = simpleSma(closes, config.regimeSmaPeriod);
  const regime = sma == null ? 'unknown' : (price > sma ? 'bull' : price < sma ? 'bear' : 'range');
  const ctx = { closes };
  const sig = regimeSwitchBreakoutSignal(ctx, { breakoutPeriod: config.breakoutPeriod, regimeSmaPeriod: config.regimeSmaPeriod });
  return {
    pair,
    price: price != null ? Math.round(price * 100) / 100 : null,
    sma: sma != null ? Math.round(sma * 100) / 100 : null,
    regime,
    signalNow: sig.action === 'TRADE' ? sig.side : null,
    lastBarTime: closedKlines.length ? closedKlines[closedKlines.length - 1][0] : null,
  };
}

export async function getBreakoutShadowDiagnostics({ now = Date.now(), fetchKlinesFn = fetchKlines, config = BREAKOUT_SHADOW_CONFIG } = {}) {
  if (_cache.payload && now - _cache.at < TTL_MS) return _cache.payload;

  const params = { targetPct: config.targetPct, stopPct: config.stopPct, timeoutHours: config.timeoutHours };
  const signalParams = { breakoutPeriod: config.breakoutPeriod, regimeSmaPeriod: config.regimeSmaPeriod };

  const allTrades = [];
  const currentByPair = [];
  let minTs = Infinity, maxTs = -Infinity;

  for (const pair of config.pairs) {
    const klines = await fetchKlinesFn(pair, { days: config.days, interval: config.interval });
    // Drop the last (still-forming) bar so we only ever evaluate CLOSED candles.
    const closed = klines.length > 1 ? klines.slice(0, -1) : klines;
    if (closed.length) {
      minTs = Math.min(minTs, closed[0][0]);
      maxTs = Math.max(maxTs, closed[closed.length - 1][0]);
    }
    const { trades } = runBacktest(closed, { ...params, ...signalParams }, {
      signalFn: (ctx) => regimeSwitchBreakoutSignal(ctx, signalParams),
      warmup: config.warmup,
    });
    for (const t of trades) allTrades.push({ ...t, pair });
    currentByPair.push(currentState(pair, closed, config));
  }

  const window = {
    from: Number.isFinite(minTs) ? new Date(minTs).toISOString().slice(0, 10) : null,
    to: Number.isFinite(maxTs) ? new Date(maxTs).toISOString().slice(0, 10) : null,
  };
  const payload = { ...buildShadowReport({ allTrades, currentByPair, window, config }), evaluatedAt: new Date(now).toISOString() };
  _cache = { at: now, payload };
  return payload;
}
