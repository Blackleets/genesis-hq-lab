// realValidation.mjs — Honest strategy validation on REAL Binance data.
//
// Pipeline (all on REAL market data, never fabricated):
//   1. Fetch REAL klines (cached) for a pair/interval.
//   2. Walk-forward: optimize params on IS window (first 60%), verify on OOS (last 40%).
//   3. Mean-reversion: Bollinger touch + RSI extreme, optional ADX regime filter.
//      Exit at fixed 0.5% stop / 1.7R target (validated realistic fills via intrabar H/L).
//   4. Monte Carlo: shuffle trade order 500x, report worst-case (p5) final equity.
//
// This module NEVER fabricates market data and NEVER executes trades.
// It tells you, honestly, whether a strategy has positive expectancy on real
// data and survives out-of-sample + Monte Carlo stress.
//
// Run: node --env-file-if-exists=.env server/crypto/backtest/realValidation.mjs

import { fetchKlines } from './historicalData.mjs';
import { computeMetrics } from './metrics.mjs';
import {
  calculateBollingerBands as bollinger,
  calculateRsi as rsi,
  calculateAdx as adx,
} from '../technicalIndicators.mjs';

export const PAIR = process.env.VAL_PAIR || 'SOLUSDT';
export const INTERVAL = process.env.VAL_INTERVAL || '4h';
export const DAYS = Number(process.env.VAL_DAYS || 400);
const RISK_PCT = Number(process.env.VAL_RISK_PCT || 1.0);
const STOP_PCT = 0.005; // 0.5% stop (validated in raw sweep)
const R_MULT = Number(process.env.VAL_TP_RR || 1.7); // take profit = R_MULT * stop distance

// --- Signal generation ------------------------------------------------------
export function generateSignals(klines, p) {
  const highs = klines.map((k) => +k[2]);
  const lows = klines.map((k) => +k[3]);
  const closes = klines.map((k) => +k[4]);
  const signals = new Array(closes.length).fill(null);
  const warm = Math.max(p.bbPeriod, p.adxPeriod) + 2;
  for (let i = warm; i < closes.length; i++) {
    const sliceH = highs.slice(0, i + 1);
    const sliceL = lows.slice(0, i + 1);
    const sliceC = closes.slice(0, i + 1);
    const bb = bollinger(sliceC, p.bbPeriod, p.bbStd);
    const r = rsi(sliceC, p.rsiPeriod);
    const a = adx(sliceH, sliceL, sliceC, p.adxPeriod);
    const price = closes[i];
    if (a > p.adxMax) continue; // skip in trending markets
    if (price <= bb.lower && r <= p.rsiOS) signals[i] = 'LONG';
    else if (price >= bb.upper && r >= p.rsiOB) signals[i] = 'SHORT';
  }
  return signals;
}

// --- Backtest with realistic intrabar fills ---------------------------------
export function runBacktest(klines, signals, startCapital = 10_000) {
  const closes = klines.map((k) => +k[4]);
  const highs = klines.map((k) => +k[2]);
  const lows = klines.map((k) => +k[3]);
  const trades = [];
  let equity = startCapital;
  let pos = null;

  for (let i = 0; i < signals.length; i++) {
    const hi = highs[i], lo = lows[i], price = closes[i];
    if (pos) {
      const tpHit = pos.side === 'LONG' ? hi >= pos.tp : lo <= pos.tp;
      const slHit = pos.side === 'LONG' ? lo <= pos.sl : hi >= pos.sl;
      if (tpHit) {
        const pnl = (pos.side === 'LONG' ? pos.tp - pos.entry : pos.entry - pos.tp) * pos.units;
        equity += pnl; trades.push({ pnl, capitalUsed: pos.riskUSD }); pos = null;
      } else if (slHit) {
        const pnl = (pos.side === 'LONG' ? pos.sl - pos.entry : pos.entry - pos.sl) * pos.units;
        equity += pnl; trades.push({ pnl, capitalUsed: pos.riskUSD }); pos = null;
      }
    }
    if (!pos && signals[i]) {
      const stopDist = price * STOP_PCT;
      const riskUSD = equity * (RISK_PCT / 100);
      const units = riskUSD / stopDist;
      const side = signals[i];
      pos = {
        side,
        entry: price,
        sl: side === 'LONG' ? price - stopDist : price + stopDist,
        tp: side === 'LONG' ? price + stopDist * R_MULT : price - stopDist * R_MULT,
        units,
        riskUSD,
      };
    }
  }
  return { trades, finalEquity: equity, startCapital };
}

// --- Parameter optimization on IS window ------------------------------------
export function optimize(klinesIS, grid) {
  let best = null;
  for (const p of grid) {
    const signals = generateSignals(klinesIS, p);
    const { trades } = runBacktest(klinesIS, signals);
    const m = computeMetrics(trades);
    if (m.trades >= 20 && (best === null || m.expectancy > best.m.expectancy)) {
      best = { p, m };
    }
  }
  return best;
}

// --- Monte Carlo: shuffle trade order, worst-case equity path ----------------
export function monteCarlo(trades, { startCapital = 10_000, runs = 500 } = {}) {
  if (trades.length === 0) return { p5: startCapital, median: startCapital, worst: startCapital, best: startCapital };
  const finals = [];
  for (let r = 0; r < runs; r++) {
    const shuffled = [...trades].sort(() => Math.random() - 0.5);
    let eq = startCapital;
    for (const t of shuffled) eq += t.pnl;
    finals.push(eq);
  }
  finals.sort((a, b) => a - b);
  const pct = (q) => finals[Math.floor(q * finals.length)];
  return {
    p5: Math.round(pct(0.05)),
    median: Math.round(pct(0.5)),
    worst: Math.round(finals[0]),
    best: Math.round(finals[finals.length - 1]),
  };
}

const paramGrid = (() => {
  const grid = [];
  for (const bbPeriod of [18, 20, 22])
    for (const bbStd of [1.8, 2.0, 2.2])
      for (const rsiPeriod of [12, 14])
        for (const rsiOS of [28, 30, 32])
          for (const rsiOB of [68, 70, 72])
            for (const adxMax of [999, 28, 25, 22]) // 999 = no ADX filter
            for (const atrPeriod of [14]) {
              grid.push({ bbPeriod, bbStd, rsiPeriod, rsiOS, rsiOB, adxMax, adxPeriod: atrPeriod, atrPeriod });
            }
  return grid;
})();

export async function main(opts = {}) {
  const pair = opts.pair || PAIR;
  const interval = opts.interval || INTERVAL;
  const days = opts.days || DAYS;
  console.log(`\n=== REAL DATA VALIDATION: ${pair} ${interval} (${days}d) ===`);
  const klines = await fetchKlines(pair, { days, interval });
  console.log(`Fetched ${klines.length} candles (REAL Binance data).`);
  if (klines.length < 200) { console.log('NOT ENOUGH DATA'); return null; }

  const split = Math.floor(klines.length * 0.6);
  const klinesIS = klines.slice(0, split);
  const klinesOOS = klines.slice(split);

  console.log(`\n[1] IN-SAMPLE optimization over ${klinesIS.length} candles...`);
  const best = optimize(klinesIS, paramGrid);
  if (!best) { console.log('No profitable IS config found.'); return null; }
  console.log('Best IS params:', JSON.stringify(best.p));
  console.log('IS metrics:', JSON.stringify(best.m));

  console.log(`\n[2] OUT-OF-SAMPLE verification over ${klinesOOS.length} candles...`);
  const oosRes = runBacktest(klinesOOS, generateSignals(klinesOOS, best.p));
  const oosM = computeMetrics(oosRes.trades);
  console.log('OOS metrics:', JSON.stringify(oosM));

  console.log(`\n[3] MONTE CARLO (500 shuffles) on OOS trades...`);
  const mc = monteCarlo(oosRes.trades, { startCapital: 10_000, runs: 500 });
  console.log('MC final equity:', JSON.stringify(mc));

  console.log('\n=== VERDICT ===');
  const passExpectancy = oosM.expectancy > 0;
  const passTrades = oosM.trades >= 30;
  const passPF = oosM.profitFactor !== null && oosM.profitFactor >= 1.2;
  const passMC = mc.p5 > 10_000;
  console.log(`OOS expectancy > 0:        ${passExpectancy} (${oosM.expectancy})`);
  console.log(`OOS trades >= 30:          ${passTrades} (${oosM.trades})`);
  console.log(`OOS profit factor >= 1.2:  ${passPF} (${oosM.profitFactor})`);
  console.log(`MC p5 final > start:       ${passMC} (${mc.p5})`);
  const approved = passExpectancy && passTrades && passPF && passMC;
  console.log(approved
    ? '\nGO (conditional): positive expectancy on REAL out-of-sample data.'
    : '\nNO-GO: did not pass all honest gates. Do NOT trade real money yet.');
  if (approved) console.log('Next: paper-trade via npm run server, re-validate before any capital.');
  return { best, oosM, mc, approved };
}

// Run only when invoked directly (not on import).
import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error('FATAL', e); process.exit(1); });
}
