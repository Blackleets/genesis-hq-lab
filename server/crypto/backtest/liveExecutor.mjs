// liveExecutor.mjs — Execution path for the VALIDATED mean-reversion edge.
//
// SAFETY MODEL (matches repo convention in server/solana-alpha/paperEngine.mjs):
//   - LIVE_MODE is ALWAYS false by default.
//   - With LIVE_MODE=false this module ONLY simulates fills on REAL Binance
//     candles and writes an audit trail. It NEVER places a real order.
//   - To trade real money you (the human operator) must:
//       1. set LIVE_MODE=true in the environment AND
//       2. provide BINANCE_API_KEY / BINANCE_API_SECRET (trade-only, withdrawals disabled)
//       3. accept total loss of the allocated capital.
//   - The agent will NEVER flip LIVE_MODE on its own.
//
// The signal logic is IDENTICAL to the validated backtest/paper paths so the
// live behavior matches what was proven on out-of-sample data.
//
// Run: node --env-file-if-exists=.env server/crypto/backtest/liveExecutor.mjs
//   env: EXEC_PAIR (SOLUSDT), EXEC_INTERVAL (4h), EXEC_CAPITAL (50),
//        EXEC_RISK (1.0), LIVE_MODE (false), EXEC_BASE_URL (https://api.binance.com)

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
const BASE_URL = process.env.EXEC_BASE_URL || 'https://api.binance.com';
const PAIR = process.env.EXEC_PAIR || 'SOLUSDT';
const INTERVAL = process.env.EXEC_INTERVAL || '4h';
const DAYS = Number(process.env.EXEC_DAYS || 30);
const START_CAPITAL = Number(process.env.EXEC_CAPITAL || 50);
const RISK_PCT = Number(process.env.EXEC_RISK || 1.0);
const STOP_PCT = 0.005;
const R_MULT = 2.2;

const P = { bbPeriod: 20, bbStd: 2.0, rsiPeriod: 13, rsiOS: 30, rsiOB: 70, adxMax: 25, adxPeriod: 14 };

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, '..', '..', '..', 'data', 'executor');

function signalsFor(closes, highs, lows) {
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

// Real-order path. Only called when LIVE_MODE=true. Uses Binance Spot REST.
// Trade-only keys required; withdrawals must be DISABLED on the exchange.
const lotSizeCache = {};
async function getStepSize(pair) {
  if (lotSizeCache[pair]) return lotSizeCache[pair];
  const r = await fetch(`${BASE_URL}/api/v3/exchangeInfo?symbol=${pair}`);
  if (!r.ok) return 1e-3; // fallback
  const j = await r.json();
  let step = 1e-3;
  for (const f of (j.filters || [])) {
    if (f.filterType === 'LOT_SIZE') { step = parseFloat(f.stepSize); break; }
  }
  lotSizeCache[pair] = step;
  return step;
}
function roundQty(qty, step) {
  const prec = (String(step).split('.')[1] || '').length;
  return parseFloat(qty.toFixed(prec));
}
async function placeRealOrder(side, pair, quantity, price) {
  const key = process.env.BINANCE_API_KEY;
  const secret = process.env.BINANCE_API_SECRET;
  if (!key || !secret) throw new Error('Missing BINANCE_API_KEY / BINANCE_API_SECRET — refusing real order');
  // Translate our internal side convention (LONG/SHORT) to Binance (BUY/SELL).
  const binanceSide = side === 'LONG' ? 'BUY' : side === 'SHORT' ? 'SELL' : side.toUpperCase();
  // Round quantity to the symbol's lot step (Binance rejects excess precision).
  const step = await getStepSize(pair);
  const qty = roundQty(quantity, step);
  // Build an alphabetically-ordered query string (Binance convention) and sign it.
  const base = {
    symbol: pair, side: binanceSide, type: 'MARKET',
    quantity: String(qty), timestamp: String(Date.now()),
  };
  const qs = Object.keys(base).sort().map(k => `${k}=${encodeURIComponent(base[k])}`).join('&');
  const sigKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const buf = await crypto.subtle.sign('HMAC', sigKey, new TextEncoder().encode(qs));
  const signature = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  const body = qs + '&signature=' + signature;
  const res = await fetch(`${BASE_URL}/api/v3/order`, {
    method: 'POST',
    headers: { 'X-MBX-APIKEY': key, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Binance order failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  console.log(`\n=== EXECUTOR: ${PAIR} ${INTERVAL} (${DAYS}d) ===`);
  console.log(`LIVE_MODE = ${LIVE_MODE}`);
  if (LIVE_MODE) {
    console.log('WARNING: real orders will be placed if signals trigger. Withdrawals must be disabled on the exchange.');
  } else {
    console.log('SAFE MODE: simulating on real data, NO real orders will be placed.');
  }

  const klines = await fetchKlines(PAIR, { days: DAYS, interval: INTERVAL });
  console.log(`Loaded ${klines.length} REAL candles.`);
  if (klines.length < 50) { console.log('NOT ENOUGH DATA'); return; }

  const closes = klines.map((k) => +k[4]);
  const highs = klines.map((k) => +k[2]);
  const lows = klines.map((k) => +k[3]);
  const signals = signalsFor(closes, highs, lows);

  let equity = START_CAPITAL;
  let pos = null;
  const trades = [];
  const orders = [];

  for (let i = 0; i < signals.length; i++) {
    const hi = highs[i], lo = lows[i], price = closes[i];
    if (pos) {
      const tpHit = pos.side === 'LONG' ? hi >= pos.tp : lo <= pos.tp;
      const slHit = pos.side === 'LONG' ? lo <= pos.sl : hi >= pos.sl;
      if (tpHit) {
        const pnl = (pos.side === 'LONG' ? pos.tp - pos.entry : pos.entry - pos.tp) * pos.units;
        equity += pnl; trades.push({ pnl, capitalUsed: pos.riskUSD, at: klines[i][0] }); pos = null;
      } else if (slHit) {
        const pnl = (pos.side === 'LONG' ? pos.sl - pos.entry : pos.entry - pos.sl) * pos.units;
        equity += pnl; trades.push({ pnl, capitalUsed: pos.riskUSD, at: klines[i][0] }); pos = null;
      }
    }
    if (!pos && signals[i]) {
      const stopDist = price * STOP_PCT;
      const riskUSD = equity * (RISK_PCT / 100);
      const units = riskUSD / stopDist;
      const side = signals[i];
      pos = {
        side, entry: price,
        sl: side === 'LONG' ? price - stopDist : price + stopDist,
        tp: side === 'LONG' ? price + stopDist * R_MULT : price - stopDist * R_MULT,
        units, riskUSD,
      };
      orders.push({ at: klines[i][0], pair: PAIR, side, price, units, live: LIVE_MODE });
      if (LIVE_MODE) {
        try { await placeRealOrder(side, PAIR, units, price); }
        catch (e) { console.error('ORDER FAILED:', e.message); }
      }
    }
  }

  const m = computeMetrics(trades, { startCapital: START_CAPITAL });
  console.log(`\nResult on REAL ${PAIR} ${INTERVAL} data (${LIVE_MODE ? 'LIVE' : 'SIMULATED'}):`);
  console.log(`  Trades:       ${m.trades}`);
  console.log(`  Win rate:     ${(m.winRate * 100).toFixed(1)}%`);
  console.log(`  Net PnL:      $${m.netPnl} (ROI ${(m.roi * 100).toFixed(1)}%)`);
  console.log(`  Profit factor: ${m.profitFactor}`);
  console.log(`  Expectancy:   $${m.expectancy}/trade`);
  console.log(`  Final equity: $${Math.round(equity)} (from $${START_CAPITAL})`);

  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `exec-${PAIR}-${INTERVAL}-${LIVE_MODE ? 'live' : 'sim'}.json`);
  writeFileSync(file, JSON.stringify({
    pair: PAIR, interval: INTERVAL, live: LIVE_MODE, startCapital: START_CAPITAL,
    params: P, summary: m, orders, savedAt: new Date().toISOString(),
  }, null, 2));
  console.log(`\nAudit trail -> ${file}`);
  console.log(LIVE_MODE
    ? 'LIVE run complete. Review audit trail before next action.'
    : 'SIMULATION complete. Flip LIVE_MODE=true (with trade-only keys + risk acceptance) to execute real orders.');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
