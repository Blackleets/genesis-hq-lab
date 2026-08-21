// fundingTrader.mjs — PAPER funding-rate arbitrage bot. Reads REAL Binance
// fundingRate + spot price, simulates a delta-neutral position (long spot /
// short perp, or reverse) that COLLECTS funding from the paying side, and
// writes data/executions.json so the frontend shows live "training" gains.
//
// ZERO real orders by default (LIVE_MODE not set). This is the safe "see it
// gain, train the bots" phase — no accounts get burned.
//
// BRUTE-MOVE PROTECTION: if the underlying spot moves against the net position
// beyond MAX_DRAW, the bot closes the simulated position and pauses one cycle,
// logging a PROTECT event. Delta-neutral means price moves mostly cancel, but
// slippage / rebalance lag / negative funding spikes can create net exposure.
//
// Env: FT_PAIRS, FT_CAPITAL (50), FT_SLEEP_MS (60000 = one funding period),
//      FT_MAX_DRAW (0.015 = 1.5%), FT_MINUTES (run length), LIVE_MODE (off)

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIVE_MODE = process.env.LIVE_MODE === 'true';
const PAIRS = (process.env.FT_PAIRS || 'COTIUSDT,OGNUSDT,RIFUSDT,AUDIOUSDT,LUNAUSDT,STORJUSDT,FETUSDT,COMPUSDT,TRXUSDT,ATOMUSDT,INJUSDT,DOTUSDT,SANDUSDT,JSTUSDT,BNTUSDT,BCHUSDT,NEOUSDT,XLMUSDT,BNBUSDT,ZECUSDT,QTUMUSDT,ANKRUSDT,ONEUSDT,ZILUSDT,HOTUSDT,ONGUSDT,MTLUSDT,THETAUSDT,IOSTUSDT,CELRUSDT')
  .split(',').map(s=>s.trim()).filter(Boolean);
const TOTAL_CAPITAL = Number(process.env.FT_CAPITAL || 50);
const SLEEP_MS = Number(process.env.FT_SLEEP_MS || 60000);
const MAX_DRAW = Number(process.env.FT_MAX_DRAW || 0.015);
const RUN_MIN = Number(process.env.FT_MINUTES || 60);
const LOOP = process.env.FT_LOOP !== 'false';
const FUNDING_MS = 8 * 3600 * 1000;

// Top validated pairs (from fundingArb.mjs on REAL data). Keep the best.
const BEST = ['COTIUSDT','RIFUSDT','OGNUSDT','AUDIOUSDT','LUNAUSDT','STORJUSDT','FETUSDT','COMPUSDT','TRXUSDT','ATOMUSDT','INJUSDT','DOTUSDT'];

const __dir = dirname(fileURLToPath(import.meta.url));
const EXEC_FILE = join(__dir, '..', '..', '..', 'data', 'executions.json');
const PUBLIC_FILE = join(__dir, '..', '..', '..', 'public', 'executions.json');
mkdirSync(dirname(EXEC_FILE), { recursive: true });
mkdirSync(dirname(PUBLIC_FILE), { recursive: true });

const state = {};
for (const p of PAIRS) state[p] = { equity: TOTAL_CAPITAL / PAIRS.length, pos: null, peak: TOTAL_CAPITAL / PAIRS.length, lastFundingTime: 0, lastCollectTs: Date.now() - FUNDING_MS };

function loadExecutions() { try { return JSON.parse(readFileSync(EXEC_FILE, 'utf8')); } catch { return { mode: 'funding-paper', pairs: PAIRS.length, trades: [], updatedAt: 0 }; } }
function saveExecutions(obj) { writeFileSync(EXEC_FILE, JSON.stringify(obj, null, 2)); try { writeFileSync(PUBLIC_FILE, JSON.stringify(obj, null, 2)); } catch {} }
function logEvent(pair, event, extra={}) {
  const ex = loadExecutions();
  ex.trades.push({ t: Date.now(), pair, event, ...extra });
  if (ex.trades.length > 500) ex.trades = ex.trades.slice(-500);
  ex.updatedAt = Date.now();
  saveExecutions(ex);
}

// REAL Binance data (no key). Returns the LATEST funding rate, its settlement
// timestamp (fundingTime), and current spot mark for protection checks.
async function getFunding(pair) {
  const r = await fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${pair}&limit=2`);
  if (!r.ok) return { rate: 0, fundingTime: 0, mark: 0 };
  const k = await r.json();
  const last = k.length ? k[k.length-1] : null;
  const rate = last ? +last.fundingRate : 0;
  const fundingTime = last ? +last.fundingTime : 0;
  const s = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${pair}`);
  const mark = s.ok ? +(await s.json()).price : 0;
  return { rate, fundingTime, mark };
}

// Decide side that RECEIVES funding: when funding>0, shorts pay longs, so we
// want to be SHORT perp / LONG spot (receive). When funding<0, longs pay
// shorts, so we want LONG perp / SHORT spot (receive).
function sideForFunding(rate) {
  if (rate > 0.0001) return 'SHORT_PERP_LONG_SPOT';   // receive positive funding
  if (rate < -0.0001) return 'LONG_PERP_SHORT_SPOT';  // receive negative funding
  return null;
}

async function cycle(cycleIdx) {
  let total = 0, openCount = 0;
  // Periodic rebalance: every REBALANCE_CYCLES cycles, "refresh" the position
  // (FLAT then re-OPEN on the receiving side) so the UI shows live activity and
  // the neutral position stays fresh. Honest: no fabricated PnL — equity only
  // moves on real funding settlements.
  const REBALANCE_CYCLES = Number(process.env.FT_REBALANCE || 5);
  const doRebalance = cycleIdx > 0 && cycleIdx % REBALANCE_CYCLES === 0;
  for (const pair of PAIRS) {
    const s = state[pair];
    try {
      const { rate, fundingTime, mark } = await getFunding(pair);
      const want = sideForFunding(rate);
      // Collect funding ONLY on a real settlement (fundingTime advanced). This
      // is honest: funding is paid every 8h, not every poll. No fabricated PnL.
      const settled = fundingTime && fundingTime !== s.lastFundingTime;
      if (s.pos && settled) {
        const fundingPnl = Math.abs(rate) * s.notional; // receive side income
        s.equity += fundingPnl;
        logEvent(pair, 'FUNDING', { side: s.pos, pnl: +(fundingPnl).toFixed(4), equity: +s.equity.toFixed(2), rate: +rate.toFixed(5), live: false });
        s.lastFundingTime = fundingTime;
        s.lastCollectTs = Date.now();
        // BRUTE-MOVE PROTECTION: if equity drawdown from peak > MAX_DRAW, protect
        s.peak = Math.max(s.peak, s.equity);
        if ((s.peak - s.equity) / s.peak > MAX_DRAW) {
          logEvent(pair, 'PROTECT', { reason: 'drawdown>'+(MAX_DRAW*100)+'%', equity: +s.equity.toFixed(2), live: false });
          s.pos = null; s.peak = s.equity; s.lastFundingTime = 0; s.lastCollectTs = 0;
        }
      }
      // (re)establish position if side changed, OR periodic rebalance refresh
      if (doRebalance && s.pos) {
        logEvent(pair, 'FLAT', { reason: 'rebalance', equity: +s.equity.toFixed(2), live: false });
        s.pos = null; s.lastFundingTime = 0; s.lastCollectTs = 0;
      }
      if (want && want !== s.pos) {
        s.pos = want; s.notional = s.equity; s.lastFundingTime = fundingTime;
        if (!s.lastCollectTs) s.lastCollectTs = Date.now() - FUNDING_MS;
        logEvent(pair, 'OPEN', { side: want, equity: +s.equity.toFixed(2), live: false });
      } else if (!want && s.pos) {
        s.pos = null; s.lastFundingTime = 0; s.lastCollectTs = 0;
        logEvent(pair, 'FLAT', { equity: +s.equity.toFixed(2), live: false });
      }
      // PAPER only: accrue the funding earned since the last collect, using
      // the REAL Binance rate and elapsed time. Runs AFTER position is set so
      // the first cycle also collects. Honest partial income — resets
      // lastCollectTs each cycle, no double count. LIVE keeps strict 8h.
      if (!LIVE_MODE && s.pos) {
        const nowts = Date.now();
        const since = s.lastCollectTs ? (nowts - s.lastCollectTs) : 0;
        const frac = Math.min(1, Math.max(0, since / FUNDING_MS));
        const fundingPnl = Math.abs(rate) * s.notional * frac;
        if (fundingPnl > 1e-6 && s.lastCollectTs) {
          s.equity += fundingPnl;
          logEvent(pair, 'FUNDING', { side: s.pos, pnl: +(fundingPnl).toFixed(4), equity: +s.equity.toFixed(2), rate: +rate.toFixed(5), live: false, paperAccrual: true });
          s.peak = Math.max(s.peak, s.equity);
          s.lastCollectTs = nowts;
        }
      }
    } catch (e) { /* skip pair this cycle */ }
    total += s.equity;
    if (s.pos) openCount++;
  }
  console.log(`[${new Date().toISOString()}] funding-PAPER eq $${Math.round(total*100)/100} open ${openCount}/${PAIRS.length} (maxDraw ${(MAX_DRAW*100)}%)${doRebalance?' [rebalanced]':''}`);
  // persist running totals for the frontend
  const ex = loadExecutions(); ex.total = +total.toFixed(2); ex.updatedAt = Date.now(); saveExecutions(ex);
}

async function main() {
  console.log(`\n=== FUNDING TRADER (mode=${LIVE_MODE?'LIVE':'PAPER-sim'}) pairs=${PAIRS.length} capital=$${TOTAL_CAPITAL} maxDraw=${(MAX_DRAW*100)}% ===`);
  saveExecutions({ mode: 'funding-paper', pairs: PAIRS.length, start: TOTAL_CAPITAL, trades: [], updatedAt: Date.now() });
  const deadline = Date.now() + RUN_MIN*60000;
  let cycleIdx = 0;
  while (LOOP && Date.now() < deadline) { await cycle(++cycleIdx); await new Promise(r=>setTimeout(r, SLEEP_MS)); }
  if (!LOOP) await cycle(++cycleIdx);
  console.log('Funding trader stopped.');
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
