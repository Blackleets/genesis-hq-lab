// server/genesis/liveRunner.mjs
// LIVE PAPER runner: executes the validated COTIUSDT meanReversion strategy
// against REAL live candles on a schedule. No keys needed (PAPER only).
//
// Usage:
//   node liveRunner.mjs                 # single scan now (prints state, exits)
//   node liveRunner.mjs --watch         # loop forever, checks every candle close
//
// Env overrides:
//   GENESIS_PAIR (default COTIUSDT), GENESIS_TF (default 1h),
//   GENESIS_PARAMS (JSON), GENESIS_CAPITAL (default 1000 USDT paper)
//
// HONESTY: PAPER trading on real market data. Zero real dollars.

import { fetchOHLCV } from './ccxtFeed.mjs';
import { makeStrategy } from './strategyLib.mjs';
import { sma, ema, rsi, atr, bollinger, adx } from './backtestCore.mjs';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const PAIR = process.env.GENESIS_PAIR || 'COTIUSDT';
const TF = process.env.GENESIS_TF || '1h';

// Per-wallet namespacing: when GENESIS_OWNER_ADDR is set, this runner's state
// lives under data/bots/<sha256(lowercase addr) first 16 hex>/<PAIR>_<TF>.json
// and the saved state carries ownerHash. The hash avoids writing raw wallet
// addresses to the filesystem. Without an owner the legacy flat layout
// (data/genesis_live_state_<PAIR>_<TF>.json, operator-owned) is kept untouched.
import { createHash } from 'node:crypto';
const OWNER_ADDR = (process.env.GENESIS_OWNER_ADDR || '').trim();
const OWNER_HASH = OWNER_ADDR
  ? createHash('sha256').update(OWNER_ADDR.toLowerCase()).digest('hex').slice(0, 16)
  : null;

// State file is per pair+timeframe so multiple runners never clobber each other.
const _pair = PAIR.replace(/[^A-Z0-9]/gi, '');
const _tf = TF.replace(/[^a-zA-Z0-9]/g, '');
const STATE_FILE = OWNER_HASH
  ? path.join(__dirname, `../../data/bots/${OWNER_HASH}/${_pair}_${_tf}.json`)
  : path.join(__dirname, `../../data/genesis_live_state_${_pair}_${_tf}.json`);
const TREASURY_FILE = path.join(__dirname, '../../data/genesis_treasury_state.json');
const CAPITAL = parseFloat(process.env.GENESIS_CAPITAL || '1000');
const P = Object.assign(
  { rsiPeriod: 14, rsiLow: 31, rsiHigh: 71, bbPeriod: 22, bbMult: 10, slMult: 2.7, tpMult: 2.5, atrMinPct: 0.004 },
  process.env.GENESIS_PARAMS ? JSON.parse(process.env.GENESIS_PARAMS) : {}
);
const FEE_RT = 0.001; // 0.10% round trip, same as backtest

// Working capital sized from treasury: 20% of paper balance if positive, else CAPITAL.
// Used ONLY as the INITIAL equity base of a brand-new state (no saved equity, no trades).
// Never re-scales an existing state's history.
function readTreasury() {
  try { return JSON.parse(fs.readFileSync(TREASURY_FILE, 'utf8')); } catch { return null; }
}

// Available paper capital per treasury = paperBalanceUSDT minus every live
// reservation. Read straight from the JSON file (no import of treasury.mjs:
// that module runs its CLI as an import side effect, so we avoid the cycle).
function treasuryAvailable(t) {
  const s = t || readTreasury();
  if (!s) return null;
  const bal = Number(s.paperBalanceUSDT);
  if (!Number.isFinite(bal)) return null;
  const reserved = Array.isArray(s.reservations)
    ? s.reservations.reduce((sum, r) => sum + (Number(r.amount) || 0), 0)
    : 0;
  return bal - reserved;
}

function workingCapital() {
  const avail = treasuryAvailable();
  if (avail !== null) {
    const wc = avail * 0.2;
    if (Number.isFinite(wc) && wc > 0) return wc;
  }
  return CAPITAL;
}

// Sizing base for a NEW trade: full-equity compounding like the backtest,
// but never above the 20% trading allocation of what the treasury still has
// free (Hummingbot BudgetChecker pattern). If equity exceeds the allocation,
// scale DOWN — a signal is never rejected for capital reasons. Without a
// readable treasury this returns plain equity (legacy behavior).
function tradeEquityBase(state) {
  const avail = treasuryAvailable();
  if (avail === null || !Number.isFinite(avail)) return state.equity;
  const alloc = Math.max(avail * 0.2, 0);
  return Math.min(state.equity, alloc);
}

// Register/release this runner's slice in genesis_treasury_state.json.
// Writes are atomic (temp file + rename) so concurrent readers never see a
// torn JSON. Failures are logged but never block paper trading.
function upsertTreasuryReservation(id, amount, reason) {
  try {
    const t = readTreasury() || {};
    if (!Array.isArray(t.reservations)) t.reservations = [];
    const existing = t.reservations.find(r => r.id === id);
    if (existing) return; // already registered (idempotent)
    t.reservations.push({ id, amount, reason, createdAt: new Date().toISOString() });
    fs.mkdirSync(path.dirname(TREASURY_FILE), { recursive: true });
    const tmp = `${TREASURY_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(t, null, 2));
    fs.renameSync(tmp, TREASURY_FILE);
  } catch (e) {
    console.error(`[liveRunner] treasury reservation write failed (${e.message}) — continuing PAPER`);
  }
}

function removeTreasuryReservation(id) {
  if (!id) return;
  try {
    const t = readTreasury();
    if (!t || !Array.isArray(t.reservations)) return;
    const next = t.reservations.filter(r => r.id !== id);
    if (next.length === t.reservations.length) return;
    t.reservations = next;
    const tmp = `${TREASURY_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(t, null, 2));
    fs.renameSync(tmp, TREASURY_FILE);
  } catch (e) {
    console.error(`[liveRunner] treasury reservation release failed (${e.message})`);
  }
}

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (!Array.isArray(s.trades)) s.trades = [];
    if (typeof s.equity !== 'number' || !Number.isFinite(s.equity)) {
      // saved state with no usable equity: seed it (still only when flat/no history)
      if (s.trades.length === 0) s.equity = workingCapital();
      else s.equity = CAPITAL;
    }
    if (typeof s.initialEquity !== 'number' || !Number.isFinite(s.initialEquity)) s.initialEquity = s.equity;
    return s;
  } catch { const eq = workingCapital(); return { pair: PAIR, tf: TF, equity: eq, initialEquity: eq, position: null, trades: [], log: [], equityCurve: [] }; }
}
function saveState(s) {
  s.pair = PAIR;
  s.tf = TF;
  if (OWNER_HASH) {
    // Tenant marker consumed by api/genesis/live.js for wallet-scoped reads.
    // Only the hash is stored, never the raw address.
    s.ownerHash = OWNER_HASH;
  }
  s.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

function computeInd(candles) {
  const close = candles.map(c => c[4]);
  const high = candles.map(c => c[2]);
  const low = candles.map(c => c[3]);
  const r = rsi(close, P.rsiPeriod);
  const bb = bollinger(close, P.bbPeriod, P.bbMult);
  const a = atr(candles, 14);
  const adxA = adx(candles, 14);
  const n = close.length;
  return {
    close, rsi14: r,
    bb: { lower: bb.lower, upper: bb.upper },
    atr14: a,
    adx14: adxA,
    i: n - 2, // last CLOSED candle (exclude forming one)
  };
}

async function scan() {
  const state = loadState();
  const candles = await fetchOHLCV(PAIR, TF, 400);
  if (!candles || candles.length < 60) { console.log('not enough candles'); return state; }
  const ind = computeInd(candles);
  const i = ind.i;
  const px = ind.close[i];
  const strategyFn = makeStrategy('meanReversion', P);
  const ctx = { i, close: ind.close, ind, open: candles.map(c => c[1]), high: candles.map(c => c[2]), low: candles.map(c => c[3]), vol: candles.map(c => c[5]) };
  const sig = strategyFn(ctx);
  const events = [];

  // 0) reconcile: if we are flat but a treasury reservation from a previous
  // run survived (crash mid-position), release it so capital frees up.
  if (!state.position && state.treasuryReservationId) {
    removeTreasuryReservation(state.treasuryReservationId);
    delete state.treasuryReservationId;
    events.push('RECONCILE released stale treasury reservation');
  }

  // 1) manage open position on the last closed candle
  if (state.position) {
    const pos = state.position;
    let closed = null;
    if (pos.side === 'long') {
      if (px <= pos.sl) closed = { reason: 'SL', exitPx: pos.sl };
      else if (px >= pos.tp) closed = { reason: 'TP', exitPx: pos.tp };
    } else {
      if (px >= pos.sl) closed = { reason: 'SL', exitPx: pos.sl };
      else if (px <= pos.tp) closed = { reason: 'TP', exitPx: pos.tp };
    }
    if (closed) {
      const gross = pos.side === 'long' ? (closed.exitPx - pos.entry) / pos.entry : (pos.entry - closed.exitPx) / pos.entry;
      const net = gross - FEE_RT;
      const pnl = (typeof pos.size === 'number' && Number.isFinite(pos.size) ? pos.size : state.equity) * net; // sized on the reserved slice
      state.equity += pnl;
      removeTreasuryReservation(pos.reservationId);
      delete state.treasuryReservationId;
      state.trades.push({ openedAt: pos.openedAt, closedAt: new Date().toISOString(), side: pos.side, entry: pos.entry, exit: closed.exitPx, reason: closed.reason, pnlPct: +(net * 100).toFixed(3), pnlUsd: +pnl.toFixed(2) });
      events.push(`CLOSE ${pos.side} @${closed.exitPx} (${closed.reason}) net=${(net * 100).toFixed(2)}% equity=${state.equity.toFixed(2)}`);
      state.position = null;
      // equity curve: one point per closed position, capped at last 500
      state.equityCurve = [...(state.equityCurve || []), Number(state.equity.toFixed(2))].slice(-500);
    }
  }

  // 2) entry signal on last closed candle (only if flat)
  if (!state.position && sig) {
    const a = ind.atr14[i] || px * 0.01;
    // Unified capital (P1): size the new trade on treasury's free allocation.
    // Never reject: scale down to what the 20% allocation still allows.
    const base = +tradeEquityBase(state).toFixed(2);
    const reservationId = `rr_${PAIR}_${TF}_${Date.now()}`;
    const openPos = (side) => {
      upsertTreasuryReservation(reservationId, base, `liveRunner:${OWNER_HASH || 'operator'}:${PAIR}:${TF}`);
      state.treasuryReservationId = reservationId;
      state.position = { side, entry: px, sl: side === 'long' ? px - P.slMult * a : px + P.slMult * a, tp: side === 'long' ? px + P.tpMult * a : px - P.tpMult * a, size: base, openedAt: new Date().toISOString() };
      events.push(`OPEN ${side.toUpperCase()} @${px} size=$${base} SL=${state.position.sl.toFixed(6)} TP=${state.position.tp.toFixed(6)}${base < state.equity ? ' (scaled down to 20% treasury allocation)' : ''}`);
    };
    if (sig.long) {
      openPos('long');
    } else if (sig.short) {
      openPos('short');
    }
  }

  const wins = state.trades.filter(t => t.pnlUsd > 0);
  const losses = state.trades.filter(t => t.pnlUsd <= 0);
  const gp = wins.reduce((s, t) => s + t.pnlUsd, 0);
  const gl = Math.abs(losses.reduce((s, t) => s + t.pnlUsd, 0));
  const summary = {
    pair: PAIR, tf: TF, price: px, equity: +state.equity.toFixed(2),
    openPosition: state.position,
    trades: state.trades.length, wins: wins.length,
    winRate: state.trades.length ? +(wins.length / state.trades.length * 100).toFixed(1) : null,
    profitFactor: gl > 0 ? +(gp / gl).toFixed(2) : (gp > 0 ? Infinity : null),
    returnPct: +((state.equity / (state.initialEquity || CAPITAL) - 1) * 100).toFixed(2),
  };
  if (events.length) { state.log.push(...events.map(e => `${new Date().toISOString()} ${e}`)); state.log = state.log.slice(-200); }
  saveState(state);
  return { summary, events };
}

async function main() {
  const watch = process.argv.includes('--watch');
  if (!watch) {
    const { summary, events } = await scan();
    for (const e of events) console.log('EVENT:', e);
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.log(`[liveRunner] watching ${PAIR} ${TF} — PAPER. Ctrl+C to stop.`);
  // check every 5 min; candle logic uses only CLOSED candles so re-checks are safe
  for (;;) {
    try {
      const { summary, events } = await scan();
      for (const e of events) console.log(`[${new Date().toLocaleTimeString()}] EVENT: ${e}`);
      console.log(`[${new Date().toLocaleTimeString()}] px=${summary.price} equity=${summary.equity} trades=${summary.trades}`);
    } catch (e) {
      console.error(`[${new Date().toLocaleTimeString()}] scan error:`, e.message);
    }
    await new Promise(r => setTimeout(r, 5 * 60 * 1000));
  }
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(1); });
