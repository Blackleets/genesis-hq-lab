// liveWatcher.mjs — Runs the VALIDATED edge in a LIVE loop using ONLY public
// Binance market data (no API key, no execution, ZERO risk). It polls the
// current price of each basket pair on a real interval, applies the validated
// signal, and paper-trades in real time against the LIVE market. This is the
// closest thing to "real money" without credentials: it watches and acts on
// the REAL market, just without placing orders.
//
// Why it's safe + public:
//   - Uses GET /api/v3/klines and /ticker/price (public, keyless).
//   - Never calls /order, never holds secrets. LIVE_MODE is forced false.
//   - Writes an audit trail of signals + paper fills.
//
// Run: node --env pls not needed; just:
//   node server/crypto/backtest/liveWatcher.mjs
//   env: LW_PAIRS (csv), LW_INTERVAL (4h), LW_CAPITAL (2300), LW_LOOP (true/false),
//        LW_SLEEP_MS (300000 = 5min), LW_MINUTES (how long to run, e.g. 30)

import { calculateBollingerBands as bollinger, calculateRsi as rsi, calculateAdx as adx } from '../technicalIndicators.mjs';
import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PAIRS = (process.env.LW_PAIRS || 'SOLUSDT,ETHUSDT,DOGEUSDT,ADAUSDT,AVAXUSDT,LINKUSDT,LTCUSDT,DOTUSDT,NEARUSDT,ARBUSDT,OPUSDT,SUIUSDT,TIAUSDT,SEIUSDT,INJUSDT,FILUSDT,WIFUSDT,PEPEUSDT,XLMUSDT,ALGOUSDT,SANDUSDT,APTUSDT,BCHUSDT').split(',').map(s=>s.trim()).filter(Boolean);
const INTERVAL = process.env.LW_INTERVAL || '4h';
const TOTAL_CAPITAL = Number(process.env.LW_CAPITAL || 2300);
const LOOP = process.env.LW_LOOP !== 'false';
const SLEEP_MS = Number(process.env.LW_SLEEP_MS || 300000);
const RUN_MIN = Number(process.env.LW_MINUTES || 30);
const STOP_PCT = 0.005, R_MULT = 2.2, RISK_PCT = 1.0;
const P = { bbPeriod: 20, bbStd: 2.0, rsiPeriod: 13, rsiOS: 30, rsiOB: 70, adxMax: 25, adxPeriod: 14 };
const SLICE = TOTAL_CAPITAL / PAIRS.length;

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, '..', '..', '..', 'data', 'livewatch');
mkdirSync(OUT, { recursive: true });
const LOG = join(OUT, `livewatch-${Date.now()}.jsonl`);

const state = {}; // pair -> {side, entry, sl, tp, units, equity}
for (const p of PAIRS) state[p] = { equity: SLICE, pos: null };

async function getIndicators(pair) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${INTERVAL}&limit=120`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`klines ${pair} ${resp.status}`);
  const k = await resp.json();
  const closes = k.map(x => +x[4]), highs = k.map(x => +x[2]), lows = k.map(x => +x[3]);
  const n = closes.length;
  const sC = closes.slice(0, n), sH = highs.slice(0, n), sL = lows.slice(0, n);
  const bb = bollinger(sC, P.bbPeriod, P.bbStd), rsiVal = rsi(sC, P.rsiPeriod), a = adx(sH, sL, sC, P.adxPeriod);
  const price = closes[n - 1];
  let signal = null;
  if (!(a > P.adxMax)) {
    if (price <= bb.lower && rsiVal <= P.rsiOS) signal = 'LONG';
    else if (price >= bb.upper && rsiVal >= P.rsiOB) signal = 'SHORT';
  }
  return { price, signal, high: highs[n-1], low: lows[n-1] };
}

function tick(pair) {
  const s = state[pair];
  const price = s._price, hi = s._high, lo = s._low, sig = s._signal;
  if (s.pos) {
    const pos = s.pos;
    const tp = pos.side === 'LONG' ? hi >= pos.tp : lo <= pos.tp;
    const sl = pos.side === 'LONG' ? lo <= pos.sl : hi >= pos.sl;
    if (tp) { const pnl = (pos.side==='LONG'?pos.tp-pos.entry:pos.entry-pos.tp)*pos.units; s.equity+=pnl; appendFileSync(LOG, JSON.stringify({t:Date.now(),pair,event:'TP',pnl,equity:s.equity})+'\n'); s.pos=null; }
    else if (sl) { const pnl = (pos.side==='LONG'?pos.sl-pos.entry:pos.entry-pos.sl)*pos.units; s.equity+=pnl; appendFileSync(LOG, JSON.stringify({t:Date.now(),pair,event:'SL',pnl,equity:s.equity})+'\n'); s.pos=null; }
  }
  if (!s.pos && sig) {
    const sd = price * STOP_PCT, units = (s.equity*(RISK_PCT/100))/sd, side = sig;
    s.pos = { side, entry: price, sl: side==='LONG'?price-sd:price+sd, tp: side==='LONG'?price+sd*R_MULT:price-sd*R_MULT, units };
    appendFileSync(LOG, JSON.stringify({t:Date.now(),pair,event:'OPEN',side,price,equity:s.equity})+'\n');
  }
}

async function cycle() {
  for (const pair of PAIRS) {
    try {
      const ind = await getIndicators(pair);
      state[pair]._price = ind.price; state[pair]._high = ind.high; state[pair]._low = ind.low; state[pair]._signal = ind.signal;
      tick(pair);
    } catch (e) { /* skip pair this cycle */ }
  }
  const totalEq = PAIRS.reduce((a,p)=>a+state[p].equity,0);
  const open = PAIRS.filter(p=>state[p].pos).length;
  console.log(`[${new Date().toISOString()}] eq $${Math.round(totalEq)} open ${open}/${PAIRS.length}  (public live, no keys, no orders)`);
  return totalEq;
}

async function main() {
  console.log(`\n=== LIVE WATCHER (PUBLIC data, keyless, no execution) ===`);
  console.log(`pairs=${PAIRS.length} interval=${INTERVAL} capital=$${TOTAL_CAPITAL} loop=${LOOP} run=${RUN_MIN}min`);
  const deadline = Date.now() + RUN_MIN * 60000;
  let last = 0;
  while (LOOP && Date.now() < deadline) {
    last = await cycle();
    await new Promise(r => setTimeout(r, SLEEP_MS));
  }
  if (!LOOP) last = await cycle();
  const final = PAIRS.reduce((a,p)=>a+state[p].equity,0);
  const summary = { mode: 'live-public-keyless', pairs: PAIRS.length, interval: INTERVAL, start: TOTAL_CAPITAL, final: Math.round(final), net: Math.round(final-TOTAL_CAPITAL), log: LOG };
  writeFileSync(join(OUT, `livewatch-summary-${Date.now()}.json`), JSON.stringify(summary, null, 2));
  console.log(`\nDONE. Start $${TOTAL_CAPITAL} -> Final $${Math.round(final)} (paper, REAL market, no keys). Summary -> ${join(OUT,'livewatch-summary.json')}`);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
