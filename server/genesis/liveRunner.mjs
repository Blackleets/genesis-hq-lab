// server/genesis/liveRunner.mjs
// LIVE PAPER runner: executes the validated COTIUSDT meanReversion strategy
// against REAL live candles on a schedule. No keys needed (PAPER only).
//
// Usage:
//   node liveRunner.mjs                 # single scan now (prints state, exits)
//   node liveRunner.mjs --watch         # loop forever, checks every candle close
//   node liveRunner.mjs --health        # run the healthCheck telemetry report, then exit
//   node liveRunner.mjs --scan-users    # one scan for EVERY user bot under data/bots/<ownerHash>/<PAIR>_<TF>.json
//
// Env overrides:
//   GENESIS_PAIR (default COTIUSDT), GENESIS_TF (default 1h),
//   GENESIS_PARAMS (JSON), GENESIS_CAPITAL (default 1000 USDT paper)
//
// HONESTY: PAPER trading on real market data. Zero real dollars.

import { fetchOHLCV, getExchange } from './ccxtFeed.mjs';
import { getSharedThrottler } from './rateLimiter.mjs';
import { makeStrategy } from './strategyLib.mjs';
import { sma, ema, rsi, atr, bollinger, adx } from './backtestCore.mjs';
import { loadFeeSchema, computeFee, netProceeds } from './feeAccountant.mjs';
import { ClientOrderTracker, InFlightOrder, newClientOrderId } from './connectorCore.mjs';
import { evaluateProtections, shouldBlockEntry } from './protections.mjs';
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
// Telemetry heartbeat: refreshed after every saveState(). Single file, last
// writer wins (one heartbeat for the whole runner fleet). Read by healthCheck.
const HEALTH_FILE = path.join(__dirname, '../../data/health.json');
const CAPITAL = parseFloat(process.env.GENESIS_CAPITAL || '1000');
const P = Object.assign(
  { rsiPeriod: 14, rsiLow: 31, rsiHigh: 71, bbPeriod: 22, bbMult: 10, slMult: 2.7, tpMult: 2.5, atrMinPct: 0.004 },
  process.env.GENESIS_PARAMS ? JSON.parse(process.env.GENESIS_PARAMS) : {}
);
// P2: the hardcoded FEE_RT = 0.001 round trip is GONE. Fees now come from the
// real exchange fee schema via feeAccountant (loadFeeSchema), with a safe
// offline fallback when ccxt/markets are unavailable. Order lifecycle is
// tracked Hummingbot-style with ClientOrderTracker + InFlightOrder.
// NOTE: the tracker is instantiated PER SCAN (inside scan()), not as a module
// singleton: in --scan-users mode several bots run through the same process and
// a shared tracker would leak one bot's openOrders snapshot into another's
// saved state. Each scan restores its own tracking states from its own file.

// Telemetry: in-memory error counter for this process lifetime (resets every
// restart by design). Surfaced in the data/health.json heartbeat so healthCheck
// can report recent error pressure.
const ERRORS = { count: 0 };
function noteError(where, e) {
  ERRORS.count += 1;
  console.error(`[liveRunner] ${where}:`, e && e.message ? e.message : e);
}

// Atomic JSON write: temp file + rename so concurrent readers (healthCheck,
// API) never observe a torn file. Never throws into the caller's path.
function atomicWriteJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

// 'COTIUSDT' -> 'COTI-USDT' — InFlightOrder tradingPair format BASE-QUOTE.
function toTradingPair(pair) {
  const up = String(pair || '').toUpperCase();
  if (/[/-]/.test(up)) return up.replace('/', '-');
  const quotes = ['USDT', 'USDC', 'BUSD', 'FDUSD', 'TUSD', 'BTC', 'ETH', 'BNB'];
  for (const q of quotes) {
    if (up.endsWith(q) && up.length > q.length) return `${up.slice(0, -q.length)}-${q}`;
  }
  return up;
}

// Unified ccxt symbol for fee lookup, same convention as ccxtFeed.fetchOHLCV.
function ccxtSymbol(pair) {
  return String(pair).replace(/(USDT|USDC|BUSD|FDUSD|TUSD)$/i, '/$1');
}

/**
 * Real maker/taker fee schema for this market. NEVER throws: any failure
 * (ccxt missing, offline, unknown market) degrades to the accountant's
 * FALLBACK schema so paper trading always continues.
 */
async function resolveFeeSchema(pair) {
  try {
    const ex = getExchange({ real: false });
    try {
      await getSharedThrottler().acquire('ohlcv'); // draw from the shared Binance budget
      await ex.loadMarkets();
    } catch { /* offline / rate-limited: loadFeeSchema falls back below */ }
    return loadFeeSchema(ex, ccxtSymbol(pair));
  } catch {
    return loadFeeSchema(undefined, ccxtSymbol(pair));
  }
}

/** Taker fee in quote currency for one notional cost (SL/TP are taker fills). */
function takerFee(schema, cost) {
  return computeFee({ schema, isMaker: false, cost });
}

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

// State helpers are parametrized (stateFile/pair/tf/ownerHash) so the SAME
// logic serves both the legacy operator runner and --scan-users multi-bot
// iteration. Legacy callers pass nothing and get the env-derived defaults.
function loadState(stateFile = STATE_FILE, pair = PAIR, tf = TF, trk = new ClientOrderTracker()) {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (!Array.isArray(s.trades)) s.trades = [];
    if (typeof s.equity !== 'number' || !Number.isFinite(s.equity)) {
      // saved state with no usable equity: seed it (still only when flat/no history)
      if (s.trades.length === 0) s.equity = workingCapital();
      else s.equity = CAPITAL;
    }
    if (typeof s.initialEquity !== 'number' || !Number.isFinite(s.initialEquity)) s.initialEquity = s.equity;
    // P2: restore order-tracking from the additive openOrders snapshot if present.
    if (s.openOrders) {
      try { trk.restoreTrackingStates(s.openOrders); }
      catch (e) { console.error(`[liveRunner] openOrders restore failed (${e.message}) — tracker starts empty`); }
    }
    return s;
  } catch { const eq = workingCapital(); return { pair, tf, equity: eq, initialEquity: eq, position: null, trades: [], log: [], equityCurve: [] }; }
}
function saveState(s, stateFile = STATE_FILE, pair = PAIR, tf = TF, ownerHash = OWNER_HASH) {
  s.pair = pair;
  s.tf = tf;
  if (ownerHash) {
    // Tenant marker consumed by api/genesis/live.js for wallet-scoped reads.
    // Only the hash is stored, never the raw address.
    s.ownerHash = ownerHash;
  }
  s.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(s, null, 2));
  writeHeartbeat(s, pair, tf);
}

// Simple heartbeat: refreshed after every saveState() so healthCheck (and any
// cron) can tell at a glance whether the runner loop is alive. Atomic
// temp+rename; failures are logged but NEVER block paper trading.
function writeHeartbeat(s, pair = PAIR, tf = TF) {
  try {
    atomicWriteJson(HEALTH_FILE, {
      lastRunAt: new Date().toISOString(),
      pair,
      tf,
      equity: Number.isFinite(s.equity) ? +s.equity.toFixed(2) : null,
      openPosition: !!s.position,
      trades: Array.isArray(s.trades) ? s.trades.length : 0,
      errors24h: ERRORS.count,
      protectionsBlocked: !!(s.protections && s.protections.blocked),
    });
  } catch (e) {
    noteError('health.json heartbeat write failed', e);
  }
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

/**
 * One full scan cycle for ONE bot. Same validated logic (signals, protections,
 * fee accounting, treasury reservations) regardless of who owns the state.
 *
 * @param {object} [cfg]  explicit per-bot config (--scan-users mode). Omitted
 *   or empty => the legacy env-derived operator runner, byte-for-byte identical
 *   behavior to before this refactor.
 *   - cfg.stateFile: absolute path of THIS bot's state JSON (never derived
 *     from user input elsewhere — the caller passes the discovered path).
 *   - cfg.pair / cfg.tf: market of this bot.
 *   - cfg.ownerHash: tenant hash stamped into the saved state (null = operator).
 */
async function scan(cfg = {}) {
  const pair = cfg.pair || PAIR;
  const tf = cfg.tf || TF;
  const stateFile = cfg.stateFile || STATE_FILE;
  const ownerHash = cfg.ownerHash !== undefined ? cfg.ownerHash : OWNER_HASH;
  // Per-scan order tracker: keeps each bot's openOrders snapshot isolated.
  const tracker = new ClientOrderTracker();
  const state = loadState(stateFile, pair, tf, tracker);
  const candles = await fetchOHLCV(pair, tf, 400);
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
      // P2 fee accounting: both legs are taker (SL/TP are stop-market fills).
      // Entry cost + taker fee leaves the wallet on open; exit proceeds minus
      // taker fee come back on close. Short = sell entry, buy-back exit.
      const schema = pos.feeSchema || loadFeeSchema(undefined, ccxtSymbol(pair));
      const sizeBase = (typeof pos.size === 'number' && Number.isFinite(pos.size) ? pos.size : state.equity);
      const qty = (typeof pos.amount === 'number' && Number.isFinite(pos.amount) && pos.amount > 0)
        ? pos.amount
        : sizeBase / pos.entry; // legacy positions restored without `amount`
      const entryCost = pos.entry * qty;
      const exitCost = closed.exitPx * qty;
      const entryFee = (typeof pos.entryFee === 'number' && Number.isFinite(pos.entryFee))
        ? pos.entryFee
        : takerFee(schema, entryCost);
      const exitFee = takerFee(schema, exitCost);
      let pnl;
      if (pos.side === 'long') {
        const outflow = netProceeds({ side: 'BUY', cost: entryCost, fee: entryFee, schema });
        const inflow = netProceeds({ side: 'SELL', cost: exitCost, fee: exitFee, schema });
        pnl = inflow - outflow;
      } else {
        const shortProceeds = netProceeds({ side: 'SELL', cost: entryCost, fee: entryFee, schema });
        const buyBackOutflow = netProceeds({ side: 'BUY', cost: exitCost, fee: exitFee, schema });
        pnl = shortProceeds - buyBackOutflow;
      }
      const net = pnl / sizeBase; // fractional return relative to invested slice (legacy pnlPct convention)
      state.equity += pnl;
      removeTreasuryReservation(pos.reservationId);
      delete state.treasuryReservationId;
      state.trades.push({ openedAt: pos.openedAt, closedAt: new Date().toISOString(), side: pos.side, entry: pos.entry, exit: closed.exitPx, reason: closed.reason, pnlPct: +(net * 100).toFixed(3), pnlUsd: +pnl.toFixed(2), feeUsd: +(entryFee + exitFee).toFixed(2) });
      events.push(`CLOSE ${pos.side} @${closed.exitPx} (${closed.reason}) net=${(net * 100).toFixed(2)}% equity=${state.equity.toFixed(2)}`);
      // P2: complete the tracked order lifecycle — full fill at the exit price,
      // then the order retires itself to the tracker's TTL cache.
      if (pos.clientOrderId) {
        try { tracker.applyFill(pos.clientOrderId, { fillAmount: qty, fillPrice: closed.exitPx, fee: exitFee }); }
        catch (e) { noteError('order fill tracking failed', e); }
      }
      state.position = null;
      // equity curve: one point per closed position, capped at last 500
      state.equityCurve = [...(state.equityCurve || []), Number(state.equity.toFixed(2))].slice(-500);
    }
  }

  // P3: Freqtrade-style protections, evaluated AFTER closing a trade and
  // BEFORE any new entry signal (additive state field `protections`).
  const prot = evaluateProtections({
    trades: state.trades,
    equityNow: state.equity,
    initialEquity: state.initialEquity || CAPITAL,
    pair,
  });
  state.protections = prot;

  // 2) entry signal on last closed candle (only if flat, and only if no
  // protection blocks the entry this candle)
  if (!state.position && sig && !shouldBlockEntry(prot).blocked) {
    const a = ind.atr14[i] || px * 0.01;
    // Unified capital (P1): size the new trade on treasury's free allocation.
    // Never reject: scale down to what the 20% allocation still allows.
    const base = +tradeEquityBase(state).toFixed(2);
    // Reservation id carries the ownerHash so two tenants running the same
    // pair/tf never share (or collide on) a treasury slot. Without an owner
    // the id format is unchanged from the legacy operator runner.
    const reservationId = `rr_${pair}_${tf}${ownerHash ? `_${ownerHash}` : ''}_${Date.now()}`;
    // P2: resolve the real fee schema once per entry (offline-safe fallback).
    const feeSchema = await resolveFeeSchema(pair);
    const qty = px > 0 ? base / px : 0; // order amount in base asset
    const openPos = (side) => {
      upsertTreasuryReservation(reservationId, base, `liveRunner:${ownerHash || 'operator'}:${pair}:${tf}`);
      state.treasuryReservationId = reservationId;
      const sl = side === 'long' ? px - P.slMult * a : px + P.slMult * a;
      const tp = side === 'long' ? px + P.tpMult * a : px - P.tpMult * a;
      const clientOrderId = newClientOrderId(side === 'long' ? 'buy' : 'sell');
      state.position = { side, entry: px, sl, tp, size: base, openedAt: new Date().toISOString(), feeSchema, amount: qty, entryFee: qty > 0 ? takerFee(feeSchema, px * qty) : 0, clientOrderId };
      // P2: track the market entry as a Hummingbot-style InFlightOrder. Tracking
      // failures are logged but never block paper trading.
      if (qty > 0) {
        try {
          tracker.register(new InFlightOrder({
            clientOrderId,
            tradingPair: toTradingPair(pair),
            side: side === 'long' ? 'buy' : 'sell',
            type: 'MARKET',
            price: px,
            amount: qty,
          }));
          tracker.markOpen(clientOrderId);
        } catch (e) { noteError('order tracking failed', e); }
      }
      events.push(`OPEN ${side.toUpperCase()} @${px} size=$${base} SL=${sl.toFixed(6)} TP=${tp.toFixed(6)}${base < state.equity ? ' (scaled down to 20% treasury allocation)' : ''}`);
    };
    if (sig.long) {
      openPos('long');
    } else if (sig.short) {
      openPos('short');
    }
  }
  // A signal existed but a protection vetoed the entry this candle.
  const protVeto = !state.position && sig ? shouldBlockEntry(prot) : null;
  if (protVeto && protVeto.blocked) {
    events.push(`BLOCKED protection ${protVeto.reason}`);
  }

  const wins = state.trades.filter(t => t.pnlUsd > 0);
  const losses = state.trades.filter(t => t.pnlUsd <= 0);
  const gp = wins.reduce((s, t) => s + t.pnlUsd, 0);
  const gl = Math.abs(losses.reduce((s, t) => s + t.pnlUsd, 0));
  const summary = {
    pair, tf, price: px, equity: +state.equity.toFixed(2),
    openPosition: state.position,
    trades: state.trades.length, wins: wins.length,
    winRate: state.trades.length ? +(wins.length / state.trades.length * 100).toFixed(1) : null,
    profitFactor: gl > 0 ? +(gp / gl).toFixed(2) : (gp > 0 ? Infinity : null),
    returnPct: +((state.equity / (state.initialEquity || CAPITAL) - 1) * 100).toFixed(2),
  };
  if (events.length) { state.log.push(...events.map(e => `${new Date().toISOString()} ${e}`)); state.log = state.log.slice(-200); }
  // P2 additive field: plain-object snapshot of order tracking, written inside
  // the SAME saveState call as before (single JSON write per scan).
  try { state.openOrders = tracker.snapshotStates(); }
  catch (e) { noteError('openOrders snapshot failed', e); state.openOrders = {}; }
  saveState(state, stateFile, pair, tf, ownerHash);
  return { summary, events };
}

// ---------------------------------------------------------------------------
// MULTI-USER MODE (--scan-users)
//
// Iterates every user-created bot (POST /api/genesis/bots) living at
//   data/bots/<ownerHash>/<PAIR>_<TF>.json
// and runs the SAME validated scan cycle for each. Isolation rules:
//   - Each bot reads/writes ONLY its own discovered state file path (the
//     <ownerHash> directory is its whole world; nothing escapes it).
//   - Binance rate budget is shared via getSharedThrottler() — one fleet-wide
//     sliding window, so N bots cannot multiply the request pressure.
//   - A failing bot (bad JSON, network error, ...) is logged and SKIPPED; the
//     remaining users still get their scan.
//   - Archived bots (archived: true in their state) are skipped entirely.
// ---------------------------------------------------------------------------

const BOTS_DIR = path.join(__dirname, '../../data/bots');
// ownerHash dirs are sha256(addr).slice(0,16) hex — anything else is not a
// tenant directory and must never be touched.
const OWNER_HASH_RE = /^[0-9a-f]{16}$/i;
// State file names look like COTIUSDT_1h.json / BTCUSDT_15m.json.
const BOT_FILE_RE = /^([A-Z0-9]+)_([a-zA-Z0-9]+)\.json$/;

function discoverUserBots() {
  let owners;
  try { owners = fs.readdirSync(BOTS_DIR, { withFileTypes: true }); }
  catch { return []; } // no data/bots yet -> zero user bots, nothing to do
  const bots = [];
  for (const ent of owners) {
    if (!ent.isDirectory() || !OWNER_HASH_RE.test(ent.name)) continue;
    let files;
    try { files = fs.readdirSync(path.join(BOTS_DIR, ent.name)); }
    catch (e) { noteError(`scan-users: cannot list ${ent.name}`, e); continue; }
    for (const f of files) {
      const m = BOT_FILE_RE.exec(f);
      if (!m) continue; // stray file inside a tenant dir: ignore, never write
      const stateFile = path.join(BOTS_DIR, ent.name, f);
      try {
        const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        if (st && st.archived) continue; // archived bot: skip silently
      } catch (e) {
        // Corrupt/unreadable state: log it, skip this bot, keep going.
        noteError(`scan-users: unreadable bot state ${ent.name}/${f}`, e);
        continue;
      }
      bots.push({ ownerHash: ent.name, pair: m[1], tf: m[2], stateFile });
    }
  }
  return bots;
}

async function runScanUsers() {
  const bots = discoverUserBots();
  console.log(`[liveRunner] --scan-users: ${bots.length} active user bot(s) found under data/bots/`);
  let ok = 0, failed = 0;
  for (const b of bots) {
    const label = `${b.ownerHash}/${b.pair}_${b.tf}`;
    try {
      const { summary, events } = await scan({
        stateFile: b.stateFile, pair: b.pair, tf: b.tf, ownerHash: b.ownerHash,
      });
      for (const e of events) console.log(`[bot ${label}] EVENT: ${e}`);
      console.log(`[bot ${label}] OK px=${summary.price} equity=${summary.equity} trades=${summary.trades}`);
      ok += 1;
    } catch (e) {
      // One tenant's failure must never abort the rest of the fleet.
      noteError(`scan-users: bot ${label} failed — continuing with next`, e);
      failed += 1;
    }
  }
  console.log(`[liveRunner] --scan-users done: ${ok} ok, ${failed} failed`);
}

async function main() {
  // TAREA 3: `--health` re-exports the healthCheck logic (same module, same
  // table, same exit code) so the runner doubles as the telemetry entry point.
  if (process.argv.includes('--health')) {
    const { runHealthCheck } = await import('./healthCheck.mjs');
    const { rows, global } = await runHealthCheck({ pair: PAIR, tf: TF });
    const cw = Math.max(...rows.map(r => r.component.concat('COMPONENTE').length), 'COMPONENTE'.length) + 2;
    const sw = Math.max(...rows.map(r => r.status.concat('STATUS').length), 'STATUS'.length) + 2;
    console.log(`${'COMPONENTE'.padEnd(cw)}${'STATUS'.padEnd(sw)}DETALLE`);
    for (const r of rows) {
      console.log(`${r.component.padEnd(cw)}${r.status.padEnd(sw)}${r.detail}`);
    }
    console.log(`GLOBAL: ${global}`);
    process.exit(global === 'DOWN' ? 1 : 0);
  }
  if (process.argv.includes('--scan-users')) {
    await runScanUsers();
    return;
  }
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
      noteError('scan error', e);
    }
    await new Promise(r => setTimeout(r, 5 * 60 * 1000));
  }
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(1); });
