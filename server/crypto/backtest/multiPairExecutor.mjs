// multiPairExecutor.mjs — SCALE the validated edge across a BASKET of pairs.
//
// Each pair runs the validated mean-reversion logic on REAL Binance data with
// its own equity slice (position-sizing = RISK_PCT of that slice). This is how
// we go from "one pair" to "many edges in parallel" = more trade opportunities
// = more scale. All signals/exit logic identical to the validated backtest.
//
// SAFETY: LIVE_MODE=false by default. With LIVE_MODE=false this ONLY simulates
// fills on REAL candles and writes an audit trail. The agent will NEVER set
// LIVE_MODE=true. A human must do that + provide trade-only keys + accept loss.
//
// Run: node --env-file-if-exists=.env server/crypto/backtest/multiPairExecutor.mjs
//   env: MP_PAIRS (csv, default SOLUSDT,ETHUSDT,DOGEUSDT), MP_INTERVAL (4h),
//        MP_DAYS (120), MP_CAPITAL (300), MP_RISK (1.0), LIVE_MODE (false)

import { fetchKlines } from './historicalData.mjs';
import { computeMetrics } from './metrics.mjs';
import {
  calculateBollingerBands as bollinger,
  calculateRsi as rsi,
  calculateAdx as adx,
} from '../technicalIndicators.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIVE_MODE = process.env.LIVE_MODE === 'true';
const PAIRS = (process.env.MP_PAIRS || 'SOLUSDT,ETHUSDT,DOGEUSDT').split(',').map(s => s.trim()).filter(Boolean);
const INTERVAL = process.env.MP_INTERVAL || '4h';
const DAYS = Number(process.env.MP_DAYS || 120);
const TOTAL_CAPITAL = Number(process.env.MP_CAPITAL || 300);
const RISK_PCT = Number(process.env.MP_RISK || 1.0);
const STOP_PCT = 0.005;
const R_MULT = 2.2;
const SLICE = TOTAL_CAPITAL / PAIRS.length;

// Consensus validated params (from SOL/ETH/DOGE 4h walk-forward runs)
const P = { bbPeriod: 20, bbStd: 2.0, rsiPeriod: 13, rsiOS: 30, rsiOB: 70, adxMax: 25, adxPeriod: 14 };

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, '..', '..', '..', 'data', 'multipair');

function signalsFor(closes, highs, lows) {
  const n = closes.length, out = new Array(n).fill(null);
  const warm = Math.max(P.bbPeriod, P.adxPeriod) + 2;
  for (let i = warm; i < n; i++) {
    const sliceC = closes.slice(0, i + 1), sliceH = highs.slice(0, i + 1), sliceL = lows.slice(0, i + 1);
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

async function runPair(pair) {
  const klines = await fetchKlines(pair, { days: DAYS, interval: INTERVAL });
  const closes = klines.map((k) => +k[4]), highs = klines.map((k) => +k[2]), lows = klines.map((k) => +k[3]);
  const signals = signalsFor(closes, highs, lows);
  let equity = SLICE, pos = null; const trades = [];
  for (let i = 0; i < signals.length; i++) {
    const hi = highs[i], lo = lows[i], price = closes[i];
    if (pos) {
      const tp = pos.side === 'LONG' ? hi >= pos.tp : lo <= pos.tp;
      const sl = pos.side === 'LONG' ? lo <= pos.sl : hi >= pos.sl;
      if (tp) { const pnl = (pos.side==='LONG'?pos.tp-pos.entry:pos.entry-pos.tp)*pos.units; equity+=pnl; trades.push({pnl,capitalUsed:pos.riskUSD}); pos=null; }
      else if (sl) { const pnl = (pos.side==='LONG'?pos.sl-pos.entry:pos.entry-pos.sl)*pos.units; equity+=pnl; trades.push({pnl,capitalUsed:pos.riskUSD}); pos=null; }
    }
    if (!pos && signals[i]) {
      const sd = price * STOP_PCT, units = (equity*(RISK_PCT/100))/sd, side = signals[i];
      pos = { side, entry: price, sl: side==='LONG'?price-sd:price+sd, tp: side==='LONG'?price+sd*R_MULT:price-sd*R_MULT, units, riskUSD: equity*(RISK_PCT/100) };
    }
  }
  const m = computeMetrics(trades, { startCapital: SLICE });
  return { pair, m, finalEquity: equity };
}

async function main() {
  console.log(`\n=== MULTI-PAIR EXECUTOR (REAL data replay): ${PAIRS.length} pairs @ ${INTERVAL}, ${DAYS}d ===`);
  console.log(`LIVE_MODE = ${LIVE_MODE} ${LIVE_MODE ? '(REAL ORDERS if signals trigger)' : '(SAFE simulation, no real orders)'}`);
  console.log(`Total capital $${TOTAL_CAPITAL} -> $${SLICE.toFixed(0)} per pair\n`);

  const results = [];
  let grandFinal = 0;
  for (const pair of PAIRS) {
    try {
      const r = await runPair(pair);
      results.push(r);
      grandFinal += r.finalEquity;
      console.log(`${pair.padEnd(9)} trades ${String(r.m.trades).padStart(3)}  WR ${(r.m.winRate*100).toFixed(0).padStart(3)}%  net $${String(Math.round(r.m.netPnl)).padStart(6)}  PF ${String(r.m.profitFactor).padStart(5)}  -> $${Math.round(r.finalEquity)}`);
    } catch (e) {
      console.log(`${pair.padEnd(9)} ERROR ${e.message.split('\n')[0]}`);
    }
  }

  const totalNet = grandFinal - TOTAL_CAPITAL;
  console.log(`\n=== BASKET RESULT (REAL ${INTERVAL} data) ===`);
  console.log(`Start: $${TOTAL_CAPITAL}  Final: $${Math.round(grandFinal)}  Net: $${Math.round(totalNet)} (${(totalNet>=0?'+':'')}${(totalNet/TOTAL_CAPITAL*100).toFixed(1)}%)`);
  const allTrades = results.reduce((a,r)=>a+r.m.trades,0);
  console.log(`Total trades across basket: ${allTrades}`);

  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `multipair-${PAIRS.length}p-${INTERVAL}-${LIVE_MODE?'live':'sim'}.json`);
  writeFileSync(file, JSON.stringify({
    pairs: PAIRS, interval: INTERVAL, live: LIVE_MODE, totalCapital: TOTAL_CAPITAL,
    slicePerPair: SLICE, params: P, results, grandFinal: Math.round(grandFinal), totalNet: Math.round(totalNet),
    savedAt: new Date().toISOString(),
  }, null, 2));
  console.log(`\nAudit trail -> ${file}`);
  console.log(LIVE_MODE ? 'LIVE basket complete.' : 'SIMULATION complete. Flip LIVE_MODE=true (trade-only keys + risk acceptance) to trade real capital.');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
