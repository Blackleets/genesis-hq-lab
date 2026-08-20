// liveTrader.mjs — REAL-TIME bot: polls the LIVE Binance market (public data),
// and when LIVE_MODE=true places REAL orders on the TESTNET (or paper if false)
// using the validated mean-reversion edge. Writes data/executions.json in real
// time so the frontend can show live executions. NO secrets are written to disk;
// keys come only from env at runtime.
//
// Run (paper, no keys):
//   node server/crypto/backtest/liveTrader.mjs
// Run (LIVE testnet, needs testnet keys in env):
//   LIVE_MODE=true BINANCE_API_KEY=... BINANCE_API_SECRET=... \
//   EXEC_BASE_URL=https://testnet.binance.vision \
//   node server/crypto/backtest/liveTrader.mjs
//
// env: LT_PAIRS, LT_INTERVAL (4h), LT_CAPITAL (2300), LT_LOOP, LT_SLEEP_MS (60000),
//      LT_MINUTES (30), LIVE_MODE, EXEC_BASE_URL, BINANCE_API_KEY, BINANCE_API_SECRET

import { calculateBollingerBands as bollinger, calculateRsi as rsi, calculateAdx as adx } from '../technicalIndicators.mjs';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIVE_MODE = process.env.LIVE_MODE === 'true';
const BASE_URL = process.env.EXEC_BASE_URL || 'https://testnet.binance.vision';
const PAIRS = (process.env.LT_PAIRS || 'SOLUSDT,ETHUSDT,DOGEUSDT,ADAUSDT,AVAXUSDT,LINKUSDT,LTCUSDT,DOTUSDT,NEARUSDT,ARBUSDT,OPUSDT,SUIUSDT,TIAUSDT,SEIUSDT,INJUSDT,FILUSDT,WIFUSDT,PEPEUSDT,XLMUSDT,ALGOUSDT,SANDUSDT,APTUSDT,BCHUSDT').split(',').map(s=>s.trim()).filter(Boolean);
const INTERVAL = process.env.LT_INTERVAL || '4h';
const TOTAL_CAPITAL = Number(process.env.LT_CAPITAL || 2300);
const LOOP = process.env.LT_LOOP !== 'false';
const SLEEP_MS = Number(process.env.LT_SLEEP_MS || 60000);
const RUN_MIN = Number(process.env.LT_MINUTES || 30);
const STOP_PCT = 0.005, R_MULT = 2.2, RISK_PCT = 1.0;
const P = { bbPeriod: 20, bbStd: 2.0, rsiPeriod: 13, rsiOS: 30, rsiOB: 70, adxMax: 25, adxPeriod: 14 };
const SLICE = TOTAL_CAPITAL / PAIRS.length;

const __dir = dirname(fileURLToPath(import.meta.url));
const EXEC_FILE = join(__dir, '..', '..', '..', 'data', 'executions.json');
mkdirSync(dirname(EXEC_FILE), { recursive: true });

const state = {};
for (const p of PAIRS) state[p] = { equity: SLICE, pos: null };

function loadExecutions() { try { return JSON.parse(readFileSync(EXEC_FILE, 'utf8')); } catch { return { mode: 'live', pairs: PAIRS.length, trades: [], updatedAt: 0 }; } }
function saveExecutions(obj) { writeFileSync(EXEC_FILE, JSON.stringify(obj, null, 2)); }

// --- order placement (same logic as liveExecutor.placeRealOrder, no secrets on disk) ---
const lotSizeCache = {};
async function getStepSize(pair) {
  if (lotSizeCache[pair]) return lotSizeCache[pair];
  try { const r = await fetch(`${BASE_URL}/api/v3/exchangeInfo?symbol=${pair}`); if (!r.ok) return 1e-3; const j = await r.json(); let s = 1e-3; for (const f of (j.filters||[])) if (f.filterType==='LOT_SIZE'){ s=parseFloat(f.stepSize); break; } lotSizeCache[pair]=s; return s; } catch { return 1e-3; }
}
function roundQty(q, step) { const p = (String(step).split('.')[1]||'').length; return parseFloat(q.toFixed(p)); }
async function placeOrder(side, pair, qty) {
  if (!LIVE_MODE) return { paper: true, side, pair, qty };
  const key = process.env.BINANCE_API_KEY, secret = process.env.BINANCE_API_SECRET;
  if (!key || !secret) throw new Error('Missing keys for live order');
  const binanceSide = side === 'LONG' ? 'BUY' : 'SELL';
  const step = await getStepSize(pair); const q = roundQty(qty, step);
  const base = { symbol: pair, side: binanceSide, type: 'MARKET', quantity: String(q), timestamp: String(Date.now()) };
  const qs = Object.keys(base).sort().map(k => `${k}=${encodeURIComponent(base[k])}`).join('&');
  const sigKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const buf = await crypto.subtle.sign('HMAC', sigKey, new TextEncoder().encode(qs));
  const signature = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  const res = await fetch(`${BASE_URL}/api/v3/order`, { method: 'POST', headers: { 'X-MBX-APIKEY': key, 'Content-Type': 'application/x-www-form-urlencoded' }, body: qs + '&signature=' + signature });
  if (!res.ok) throw new Error(`order failed ${res.status} ${await res.text()}`);
  return res.json();
}

async function getIndicators(pair) {
  const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${INTERVAL}&limit=120`);
  if (!r.ok) throw new Error(`klines ${r.status}`);
  const k = await r.json();
  const closes = k.map(x=>+x[4]), highs = k.map(x=>+x[2]), lows = k.map(x=>+x[3]);
  const n = closes.length, sC = closes.slice(0,n), sH = highs.slice(0,n), sL = lows.slice(0,n);
  const bb = bollinger(sC, P.bbPeriod, P.bbStd), rsiVal = rsi(sC, P.rsiPeriod), a = adx(sH, sL, sC, P.adxPeriod);
  const price = closes[n-1]; let signal = null;
  if (!(a > P.adxMax)) { if (price <= bb.lower && rsiVal <= P.rsiOS) signal = 'LONG'; else if (price >= bb.upper && rsiVal >= P.rsiOB) signal = 'SHORT'; }
  return { price, signal, high: highs[n-1], low: lows[n-1] };
}

function tick(pair) {
  const s = state[pair], price = s._price, hi = s._high, lo = s._low, sig = s._signal;
  if (s.pos) {
    const pos = s.pos;
    const tp = pos.side==='LONG' ? hi>=pos.tp : lo<=pos.tp;
    const sl = pos.side==='LONG' ? lo<=pos.sl : hi>=pos.sl;
    if (tp || sl) {
      const pnl = (pos.side==='LONG'? (tp?pos.tp:pos.sl)-pos.entry : pos.entry-(tp?pos.tp:pos.sl)) * pos.units;
      s.equity += pnl; s.pos = null;
      const ex = loadExecutions(); ex.trades.push({ t: Date.now(), pair, event: tp?'TP':'SL', side: pos.side, price: pos.entry, pnl: +pnl.toFixed(2), equity: +s.equity.toFixed(2), live: LIVE_MODE }); ex.updatedAt = Date.now(); saveExecutions(ex);
      return;
    }
  }
  if (!s.pos && sig) {
    const sd = price * STOP_PCT, units = (s.equity*(RISK_PCT/100))/sd, side = sig;
    s.pos = { side, entry: price, sl: side==='LONG'?price-sd:price+sd, tp: side==='LONG'?price+sd*R_MULT:price-sd*R_MULT, units };
    placeOrder(side, pair, units).then(ord => {
      const ex = loadExecutions(); ex.trades.push({ t: Date.now(), pair, event: 'OPEN', side, price: +price.toFixed(4), live: LIVE_MODE, order: LIVE_MODE ? ord.orderId : 'paper' }); ex.updatedAt = Date.now(); saveExecutions(ex);
    }).catch(e => console.error(`order ${pair} err`, e.message));
  }
}

async function cycle() {
  for (const pair of PAIRS) { try { const ind = await getIndicators(pair); state[pair]._price=ind.price; state[pair]._high=ind.high; state[pair]._low=ind.low; state[pair]._signal=ind.signal; tick(pair); } catch {} }
  const total = PAIRS.reduce((a,p)=>a+state[p].equity,0);
  const open = PAIRS.filter(p=>state[p].pos).length;
  console.log(`[${new Date().toISOString()}] ${LIVE_MODE?'LIVE(testnet)':'paper'} eq $${Math.round(total)} open ${open}/${PAIRS.length}`);
}

async function main() {
  console.log(`\n=== LIVE TRADER (mode=${LIVE_MODE?'LIVE-testnet':'PAPER'}) pairs=${PAIRS.length} ${INTERVAL} ===`);
  saveExecutions({ mode: LIVE_MODE?'live-testnet':'paper', pairs: PAIRS.length, interval: INTERVAL, start: TOTAL_CAPITAL, trades: [], updatedAt: Date.now() });
  const deadline = Date.now() + RUN_MIN*60000;
  while (LOOP && Date.now() < deadline) { await cycle(); await new Promise(r=>setTimeout(r, SLEEP_MS)); }
  if (!LOOP) await cycle();
  console.log('Live trader stopped.');
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
