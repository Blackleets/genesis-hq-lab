// multiPairExecutorRisk.mjs — Same basket as multiPairExecutor.mjs but WITH
// the riskManager layer: concurrency throttle (MAX_OPEN), global risk cap
// (MAX_RISK_PCT), and trailing stop (TRAIL_PCT). Tests whether we can LOWER
// drawdown on REAL data without killing the validated edge.
//
// Run: node --env-file-if-exists=.env server/crypto/backtest/multiPairExecutorRisk.mjs
//   env: MP_PAIRS (csv), MP_INTERVAL (4h), MP_DAYS (400), MP_CAPITAL (2300),
//        MAX_OPEN (6), MAX_RISK_PCT (8), TRAIL_PCT (0.003), TRAIL_ACT (0.004), LIVE_MODE (false)

import { fetchKlines } from './historicalData.mjs';
import { computeMetrics } from './metrics.mjs';
import { calculateBollingerBands as bollinger, calculateRsi as rsi, calculateAdx as adx } from '../technicalIndicators.mjs';
import { makeRiskManager } from './riskManager.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIVE_MODE = process.env.LIVE_MODE === 'true';
const PAIRS = (process.env.MP_PAIRS || 'SOLUSDT,ETHUSDT,DOGEUSDT,ADAUSDT,AVAXUSDT,LINKUSDT,LTCUSDT,DOTUSDT,NEARUSDT,ARBUSDT,OPUSDT,SUIUSDT,TIAUSDT,SEIUSDT,INJUSDT,FILUSDT,WIFUSDT,PEPEUSDT,XLMUSDT,ALGOUSDT,SANDUSDT,APTUSDT,BCHUSDT').split(',').map(s=>s.trim()).filter(Boolean);
const INTERVAL = process.env.MP_INTERVAL || '4h';
const DAYS = Number(process.env.MP_DAYS || 400);
const TOTAL_CAPITAL = Number(process.env.MP_CAPITAL || 2300);
const RISK_PCT = Number(process.env.MP_RISK || 1.0);
const STOP_PCT = 0.005, R_MULT = 2.2;
const MAX_OPEN = Number(process.env.MAX_OPEN || 6);
const MAX_RISK_PCT = Number(process.env.MAX_RISK_PCT || 8.0);
const TRAIL_PCT = Number(process.env.TRAIL_PCT || 0.003);
const TRAIL_ACT = Number(process.env.TRAIL_ACT || 0.004);
const SLICE = TOTAL_CAPITAL / PAIRS.length;
const P = { bbPeriod: 20, bbStd: 2.0, rsiPeriod: 13, rsiOS: 30, rsiOB: 70, adxMax: 25, adxPeriod: 14 };

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, '..', '..', '..', 'data', 'multipair');

function signalsFor(closes, highs, lows) {
  const n = closes.length, out = new Array(n).fill(null);
  const warm = Math.max(P.bbPeriod, P.adxPeriod) + 2;
  for (let i = warm; i < n; i++) {
    const sC = closes.slice(0, i+1), sH = highs.slice(0, i+1), sL = lows.slice(0, i+1);
    const bb = bollinger(sC, P.bbPeriod, P.bbStd), r = rsi(sC, P.rsiPeriod), a = adx(sH, sL, sC, P.adxPeriod);
    const price = closes[i];
    if (a > P.adxMax) continue;
    if (price <= bb.lower && r <= P.rsiOS) out[i] = 'LONG';
    else if (price >= bb.upper && r >= P.rsiOB) out[i] = 'SHORT';
  }
  return out;
}

async function runPair(pair, rm) {
  const klines = await fetchKlines(pair, { days: DAYS, interval: INTERVAL });
  const closes = klines.map(k=>+k[4]), highs = klines.map(k=>+k[2]), lows = klines.map(k=>+k[3]);
  const sig = signalsFor(closes, highs, lows);
  let equity = SLICE, pos = null; const trades = [];
  for (let i = 0; i < sig.length; i++) {
    const hi = highs[i], lo = lows[i], price = closes[i];
    if (pos) {
      let sl = rm.trailStop({ side: pos.side, entry: pos.entry, sl: pos.sl, price });
      pos.sl = sl;
      const tp = pos.side === 'LONG' ? hi >= pos.tp : lo <= pos.tp;
      const slHit = pos.side === 'LONG' ? lo <= pos.sl : hi >= pos.sl;
      if (tp) { const pnl = (pos.side==='LONG'?pos.tp-pos.entry:pos.entry-pos.tp)*pos.units; equity+=pnl; trades.push({pnl}); rm.markClose(); pos=null; }
      else if (slHit) { const pnl = (pos.side==='LONG'?pos.sl-pos.entry:pos.entry-pos.sl)*pos.units; equity+=pnl; trades.push({pnl}); rm.markClose(); pos=null; }
    }
    if (!pos && sig[i] && rm.canOpen(RISK_PCT * SLICE / TOTAL_CAPITAL * 100)) {
      const sd = price * STOP_PCT, units = (equity*(RISK_PCT/100))/sd, side = sig[i];
      pos = { side, entry: price, sl: side==='LONG'?price-sd:price+sd, tp: side==='LONG'?price+sd*R_MULT:price-sd*R_MULT, units };
      rm.markOpen(RISK_PCT * SLICE / TOTAL_CAPITAL * 100);
    }
  }
  const m = computeMetrics(trades, { startCapital: SLICE });
  return { pair, m, finalEquity: equity };
}

async function main() {
  const rm = makeRiskManager({ maxOpen: MAX_OPEN, maxRiskPct: MAX_RISK_PCT, trailPct: TRAIL_PCT, trailActivatePct: TRAIL_ACT });
  console.log(`\n=== MULTI-PAIR + RISK MANAGER (REAL ${INTERVAL}, ${DAYS}d) ===`);
  console.log(`LIVE_MODE=${LIVE_MODE}  MAX_OPEN=${MAX_OPEN}  MAX_RISK=${MAX_RISK_PCT}%  TRAIL=${TRAIL_PCT}  pairs=${PAIRS.length}`);
  console.log(`Total $${TOTAL_CAPITAL} -> $${SLICE.toFixed(0)}/pair\n`);
  let grand = 0;
  for (const pair of PAIRS) {
    try {
      const r = await runPair(pair, rm);
      grand += r.finalEquity;
      console.log(`${pair.padEnd(9)} t ${String(r.m.trades).padStart(3)} WR ${(r.m.winRate*100).toFixed(0).padStart(3)}% net $${String(Math.round(r.m.netPnl)).padStart(6)} PF ${String(r.m.profitFactor).padStart(5)} -> $${Math.round(r.finalEquity)}`);
    } catch (e) { console.log(pair, 'ERR', e.message.split('\n')[0]); }
  }
  const totalNet = grand - TOTAL_CAPITAL;
  console.log(`\n=== BASKET + RISK RESULT (REAL data) ===`);
  console.log(`Start $${TOTAL_CAPITAL} -> Final $${Math.round(grand)}  Net $${Math.round(totalNet)} (${(totalNet/TOTAL_CAPITAL*100).toFixed(1)}%)`);
  console.log(`Max concurrent open (throttle): ${rm.state.open} (cap ${MAX_OPEN})`);
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `multipair-risk-${PAIRS.length}p-${INTERVAL}-${LIVE_MODE?'live':'sim'}.json`);
  writeFileSync(file, JSON.stringify({ pairs: PAIRS.length, interval: INTERVAL, live: LIVE_MODE, capital: TOTAL_CAPITAL, risk: rm.config, final: Math.round(grand), net: Math.round(totalNet), savedAt: new Date().toISOString() }, null, 2));
  console.log(`Audit -> ${file}`);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
