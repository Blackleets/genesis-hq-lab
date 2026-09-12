// basketScan.mjs — Scale the validated edge: scan MANY pairs x timeframes on
// REAL Binance data, keep only those that pass honest out-of-sample gates.
// Reuses historicalData.fetchKlines (REAL data, cached) and metrics.computeMetrics.
// This is a SCANNER, not a trader. It tells you the tradable universe size.
//
// Run: node --env-file-if-exists=.env server/crypto/backtest/basketScan.mjs

import { fetchKlines } from './historicalData.mjs';
import { computeMetrics } from './metrics.mjs';
import {
  calculateBollingerBands as bollinger,
  calculateRsi as rsi,
  calculateAdx as adx,
} from '../technicalIndicators.mjs';

const PAIRS = ['SOLUSDT','ETHUSDT','DOGEUSDT','BNBUSDT','XRPUSDT','ADAUSDT','AVAXUSDT','LINKUSDT','MATICUSDT','LTCUSDT','TRXUSDT','DOTUSDT','NEARUSDT','ATOMUSDT','ARBUSDT','OPUSDT','SUIUSDT','TIAUSDT','SEIUSDT','INJUSDT','APTUSDT','FILUSDT','RNDRUSDT','WIFUSDT','PEPEUSDT','BCHUSDT','ETCUSDT','XLMUSDT','ALGOUSDT','SANDUSDT'];
const INTERVALS = ['2h','4h','6h','8h','12h'];
const DAYS = 400;
const STOP_PCT = 0.005;
const R_MULT = 2.2;
const RISK_PCT = 1.0;

function signalsFor(closes, highs, lows, P) {
  const n = closes.length;
  const out = new Array(n).fill(null);
  const warm = Math.max(P.bbPeriod, P.adxPeriod) + 2;
  for (let i = warm; i < n; i++) {
    const sliceC = closes.slice(0, i + 1);
    const sliceH = highs.slice(0, i + 1);
    const sliceL = lows.slice(0, i + 1);
    const bb = bollinger(sliceC, P.bbPeriod, P.bbStd);
    const r = rsi(sliceC, P.rsiPeriod);
    const a = adx(sliceH, sliceL, sliceC, P.adxPeriod);
    const price = closes[i];
    if (a > P.adxMax) continue;
    if (price <= bb.lower && r <= P.rsiOS) out[i] = 'LONG';
    else if (price >= bb.upper && r >= P.rsiOB) out[i] = 'SHORT';
  }
  return out;
}

function backtest(klines, signals) {
  const closes = klines.map((k) => +k[4]);
  const highs = klines.map((k) => +k[2]);
  const lows = klines.map((k) => +k[3]);
  const trades = [];
  let equity = 10_000, pos = null;
  for (let i = 0; i < signals.length; i++) {
    const hi = highs[i], lo = lows[i], price = closes[i];
    if (pos) {
      const tp = pos.side === 'LONG' ? hi >= pos.tp : lo <= pos.tp;
      const sl = pos.side === 'LONG' ? lo <= pos.sl : hi >= pos.sl;
      if (tp) { const pnl = (pos.side==='LONG'?pos.tp-pos.entry:pos.entry-pos.tp)*pos.units; equity+=pnl; trades.push({pnl,capitalUsed:pos.riskUSD}); pos=null; }
      else if (sl) { const pnl = (pos.side==='LONG'?pos.sl-pos.entry:pos.entry-pos.sl)*pos.units; equity+=pnl; trades.push({pnl,capitalUsed:pos.riskUSD}); pos=null; }
    }
    if (!pos && signals[i]) {
      const sd = price * STOP_PCT;
      const units = (equity * (RISK_PCT/100)) / sd;
      const side = signals[i];
      pos = { side, entry: price, sl: side==='LONG'?price-sd:price+sd, tp: side==='LONG'?price+sd*R_MULT:price-sd*R_MULT, units, riskUSD: equity*(RISK_PCT/100) };
    }
  }
  return trades;
}

// Walk-forward: optimize BB/RSI/ADX grid on first 60%, verify on last 40%.
function bestOOS(klines, Pgrid) {
  const split = Math.floor(klines.length * 0.6);
  const kIS = klines.slice(0, split);
  const kOOS = klines.slice(split);
  let best = null;
  for (const P of Pgrid) {
    const isTrades = backtest(kIS, signalsFor(kIS.map(k=>+k[4]),kIS.map(k=>+k[2]),kIS.map(k=>+k[3]),P));
    const m = computeMetrics(isTrades);
    if (m.trades >= 15 && (best === null || m.expectancy > best.exp)) best = { P, exp: m.expectancy };
  }
  if (!best) return null;
  const oosTrades = backtest(kOOS, signalsFor(kOOS.map(k=>+k[4]),kOOS.map(k=>+k[2]),kOOS.map(k=>+k[3]),best.P));
  const oosM = computeMetrics(oosTrades);
  return { P: best.P, oosM };
}

const Pgrid = (() => {
  const g = [];
  for (const bbPeriod of [20, 22])
    for (const bbStd of [1.8, 2.0, 2.2])
      for (const rsiOS of [28, 30, 32])
        for (const rsiOB of [68, 70, 72])
          for (const adxMax of [22, 25, 28, 999]) {
            g.push({ bbPeriod, bbStd, rsiPeriod: 14, rsiOS, rsiOB, adxMax, adxPeriod: 14 });
          }
  return g;
})();

const passed = [];
for (const pair of PAIRS) {
  for (const iv of INTERVALS) {
    try {
      const k = await fetchKlines(pair, { days: DAYS, interval: iv });
      if (k.length < 200) continue;
      const res = bestOOS(k, Pgrid);
      if (!res) continue;
      const m = res.oosM;
      const ok = m.trades >= 30 && m.expectancy > 0 && m.profitFactor >= 1.2;
      if (ok) {
        passed.push({ pair, iv, trades: m.trades, wr: +(m.winRate*100).toFixed(0), exp: +m.expectancy.toFixed(0), pf: +m.profitFactor.toFixed(2), dd: +(m.maxDrawdown*100).toFixed(1) });
        console.log(`PASS ${pair.padEnd(9)} ${iv.padEnd(3)} trades ${String(m.trades).padStart(3)} WR ${String(Math.round(m.winRate*100)).padStart(2)}% exp $${m.expectancy.toFixed(0)} PF ${m.profitFactor.toFixed(2)} DD ${(m.maxDrawdown*100).toFixed(1)}%`);
      }
    } catch (e) { /* skip pairs without enough history */ }
  }
}

console.log(`\n=== BASKET SCAN COMPLETE ===`);
console.log(`Tradable edges passing honest OOS gates: ${passed.length} of ${PAIRS.length * INTERVALS.length} combos`);
if (passed.length) {
  const avgExp = passed.reduce((a,b)=>a+b.exp,0)/passed.length;
  console.log(`Avg OOS expectancy/trade: $${avgExp.toFixed(0)}`);
  console.log(`Unique pairs with >=1 edge: ${new Set(passed.map(p=>p.pair)).size}`);
}
