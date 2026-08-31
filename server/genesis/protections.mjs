// server/genesis/protections.mjs
// Trade-protection guards, modeled on Freqtrade's protection plugins
// (StoplossGuard, CooldownPeriod, MaxDrawdown, LowProfitPairs).
//
// Pure functions over the runner's closed-trade history — no I/O, no clock
// dependency except Date.now() for recency windows. Evaluated by liveRunner
// after closing a trade and before evaluating a new entry signal.
//
// CLI self-test: node protections.mjs   -> runs 4 synthetic scenarios,
// prints PASS/FAIL per scenario, exits 0 only if all pass.

const HOUR_MS = 60 * 60 * 1000;
// Default candle duration for recency windows (liveRunner default TF = 1h).
const DEFAULT_CANDLE_MS = HOUR_MS;

function parseTime(ts) {
  const t = typeof ts === 'number' ? ts : Date.parse(ts);
  return Number.isFinite(t) ? t : null;
}

/**
 * Equity curve including the starting point: [initialEquity, eq after t1, ...].
 * Falls back to initialEquity-only when trades carry no usable pnlUsd.
 */
function buildEquityCurve(trades, initialEquity) {
  let equity = initialEquity;
  const curve = [equity];
  for (const t of trades) {
    const pnl = Number(t && t.pnlUsd);
    if (Number.isFinite(pnl)) equity += pnl;
    curve.push(equity);
  }
  return curve;
}

/** Current drawdown of equityNow vs the running peak of the accumulated curve, relative to initialEquity. */
function currentDrawdown({ trades = [], equityNow, initialEquity }) {
  const base = Number.isFinite(initialEquity) && initialEquity > 0 ? initialEquity : 0;
  if (!(base > 0) || !Number.isFinite(equityNow)) return 0;
  const curve = buildEquityCurve(trades, base);
  const peak = Math.max(base, ...curve.map(v => (Number.isFinite(v) ? v : base)));
  return Math.max(0, (peak - equityNow) / base);
}

/** Profit factor of a trade list: gross profit / |gross loss|. Infinity if no losses yet, null if no profit either. */
export function profitFactor(trades = []) {
  let gp = 0;
  let gl = 0;
  for (const t of trades) {
    const pnl = Number(t && t.pnlUsd);
    if (!Number.isFinite(pnl)) continue;
    if (pnl > 0) gp += pnl;
    else gl += Math.abs(pnl);
  }
  if (gl > 0) return gp / gl;
  return gp > 0 ? Infinity : null;
}

/**
 * Longest run of consecutive losing trades (pnl <= 0) among trades whose
 * close time falls inside the last `candles` candles before now.
 */
function consecutiveRecentLosses(trades, { now, candleMs, candles }) {
  const cutoff = now - candles * candleMs;
  const recent = trades
    .map(t => ({ t, ct: parseTime(t && (t.closedAt || t.closeDate)) }))
    .filter(x => x.ct !== null && x.ct >= cutoff)
    .sort((a, b) => a.ct - b.ct); // oldest -> newest
  let run = 0;
  let worst = 0;
  for (const { t } of recent) {
    const pnl = Number(t.pnlUsd);
    if (Number.isFinite(pnl) && pnl <= 0) {
      run += 1;
      worst = Math.max(worst, run);
    } else {
      run = 0;
    }
  }
  return worst;
}

/**
 * Evaluate all protections against the runner state.
 *
 * @param {object} args
 * @param {Array<{pnlUsd:number, closedAt:string|number, reason?:string}>} [args.trades=[]]
 *        Closed trades, oldest first (liveRunner pushes chronologically).
 * @param {number} args.equityNow       Current paper equity.
 * @param {number} args.initialEquity   Equity base the run started from.
 * @param {string} [args.pair]          Pair being considered for entry.
 * @param {number} [args.candleMs]      Candle duration for recency windows (default 1h).
 *
 * @returns {{blocked:boolean, reason:string|null, activeProtections:Array<{name:string, detail:string}>}}
 */
export function evaluateProtections({
  trades = [],
  equityNow,
  initialEquity,
  pair,
  candleMs = DEFAULT_CANDLE_MS,
} = {}) {
  const now = Date.now();
  const active = [];
  const safeTrades = Array.isArray(trades)
    ? trades.filter(t => t && Number.isFinite(Number(t.pnlUsd)))
    : [];

  // --- MaxDrawdown: permanent block. Current DD over the accumulated equity
  // curve, relative to the initial equity. >15% locks trading entirely.
  const dd = currentDrawdown({ trades: safeTrades, equityNow, initialEquity });
  if (dd > 0.15) {
    active.push({
      name: 'MaxDrawdown',
      detail: `drawdown ${(dd * 100).toFixed(2)}% > 15% limit (equity=${Number(equityNow).toFixed(2)}, initial=${Number(initialEquity).toFixed(2)})`,
    });
  }

  // --- StoplossGuard: >=3 consecutive losses closed within the last 5 candles
  // (Freqtrade-style frequent-stop guard, tightened from its default count of
  // stop exits to any consecutive loss run).
  const lossRun = consecutiveRecentLosses(safeTrades, { now, candleMs, candles: 5 });
  if (lossRun >= 3) {
    active.push({
      name: 'StoplossGuard',
      detail: `${lossRun} consecutive losses within the last 5 candles`,
    });
  }

  // --- LowProfitPairs: pair-specific lock. Enough samples (>=20 trades on this
  // pair) and a profit factor below 0.8 means the strategy loses on this market.
  if (pair) {
    const pairTrades = safeTrades.filter(
      t => !t.pair || String(t.pair).toUpperCase() === String(pair).toUpperCase()
    );
    if (pairTrades.length >= 20) {
      const pf = profitFactor(pairTrades);
      if (pf !== null && pf !== Infinity && pf < 0.8) {
        active.push({
          name: 'LowProfitPairs',
          detail: `${pair}: ${pairTrades.length} trades, profit factor ${pf.toFixed(2)} < 0.80`,
        });
      }
    }
  }

  // --- CooldownPeriod: temporary block. Last trade closed less than an hour
  // ago -> let the market settle before re-entering.
  let lastClose = null;
  for (const t of safeTrades) {
    const ct = parseTime(t.closedAt || t.closeDate);
    if (ct !== null && (lastClose === null || ct > lastClose)) lastClose = ct;
  }
  if (lastClose !== null && now - lastClose < HOUR_MS) {
    const minsAgo = ((now - lastClose) / 60000).toFixed(1);
    active.push({
      name: 'CooldownPeriod',
      detail: `last trade closed ${minsAgo} min ago (< 60 min cooldown)`,
    });
  }

  // Priority: permanent (MaxDrawdown, LowProfitPairs) before temporary guards.
  // Reason codes match the spec / runner event log.
  const priority = [
    ['MaxDrawdown', 'MAX_DD'],
    ['StoplossGuard', 'STOPLOSS'],
    ['LowProfitPairs', 'LOW_PF'],
    ['CooldownPeriod', 'COOLDOWN'],
  ];
  let reason = null;
  for (const [name, code] of priority) {
    if (active.some(p => p.name === name)) { reason = code; break; }
  }
  return { blocked: active.length > 0, reason, activeProtections: active };
}

/**
 * Gate helper for the entry path: true when no new position may be opened.
 * Accepts an already-evaluated result; tolerates null/undefined (no block).
 */
export function shouldBlockEntry(protectionsResult) {
  const res = protectionsResult || {};
  const blocked = res.blocked === true && typeof res.reason === 'string' && res.reason.length > 0;
  return { blocked, reason: blocked ? res.reason : null };
}

// ---------------------------------------------------------------------------
// CLI self-test: node protections.mjs
// ---------------------------------------------------------------------------
import path from 'node:path';
import url from 'node:url';

function isMain() {
  try {
    if (!process.argv[1]) return false;
    return path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url);
  } catch { return false; }
}

function runSelfTest() {
  const H = HOUR_MS;
  const iso = ms => new Date(ms).toISOString();
  const results = [];
  const check = (id, cond, extra) => {
    results.push({ id, pass: !!cond, extra });
    console.log(`${cond ? 'PASS' : 'FAIL'} ${id}${extra ? ` — ${extra}` : ''}`);
  };

  // E1: 3 consecutive stop-losses just now -> STOPLOSS block.
  const now = Date.now();
  const e1 = evaluateProtections({
    trades: [
      { pnlUsd: -12, reason: 'SL', closedAt: iso(now - 3 * H) },
      { pnlUsd: -11, reason: 'SL', closedAt: iso(now - 2 * H) },
      { pnlUsd: -13, reason: 'SL', closedAt: iso(now - 0.5 * H) },
    ],
    equityNow: 964, initialEquity: 1000, pair: 'COTIUSDT',
  });
  check('E1 stoploss streak blocks',
    e1.blocked === true && e1.reason === 'STOPLOSS'
    && e1.activeProtections.some(p => p.name === 'StoplossGuard'),
    `reason=${e1.reason}`);

  // E2: equity 1000 -> 800 (two big losses, only 2-consecutive) -> MAX_DD block.
  const e2 = evaluateProtections({
    trades: [
      { pnlUsd: -90, reason: 'SL', closedAt: iso(now - 30 * H) },
      { pnlUsd: -110, reason: 'SL', closedAt: iso(now - 29 * H) },
    ],
    equityNow: 800, initialEquity: 1000, pair: 'COTIUSDT',
  });
  check('E2 max drawdown blocks',
    e2.blocked === true && e2.reason === 'MAX_DD'
    && e2.activeProtections.some(p => p.name === 'MaxDrawdown'),
    `reason=${e2.reason}`);

  // E3: 25 old trades on the pair, PF ~= 0.6 -> LOW_PF block (interleaved
  // wins/losses and small pnl so neither stoploss nor drawdown fires first).
  const e3Trades = [];
  for (let k = 0; k < 25; k++) {
    const win = k % 2 === 0; // never 2 losses in a row
    const pnl = win ? 30 : -49.95; // gp=375, gl=624.38 -> PF~0.6005
    e3Trades.push({ pnlUsd: pnl, reason: win ? 'TP' : 'SL', closedAt: iso(now - (200 - k) * H) });
  }
  const e3 = evaluateProtections({
    trades: e3Trades, equityNow: 1875, initialEquity: 2000, pair: 'COTIUSDT',
  });
  check('E3 low profit factor pair blocks',
    e3.blocked === true && e3.reason === 'LOW_PF'
    && e3.activeProtections.some(p => p.name === 'LowProfitPairs'),
    `reason=${e3.reason}`);

  // E4: healthy mixed history -> nothing blocks.
  const e4 = evaluateProtections({
    trades: [
      { pnlUsd: 40, reason: 'TP', closedAt: iso(now - 10 * H) },
      { pnlUsd: -18, reason: 'SL', closedAt: iso(now - 9 * H) },
      { pnlUsd: 55, reason: 'TP', closedAt: iso(now - 8 * H) },
      { pnlUsd: 32, reason: 'TP', closedAt: iso(now - 7 * H) },
      { pnlUsd: -14, reason: 'SL', closedAt: iso(now - 5 * H) },
      { pnlUsd: 61, reason: 'TP', closedAt: iso(now - 4 * H) },
    ],
    equityNow: 1156, initialEquity: 1000, pair: 'COTIUSDT',
  });
  check('E4 healthy trades do not block',
    e4.blocked === false && e4.reason === null && e4.activeProtections.length === 0,
    `reason=${e4.reason}, active=${e4.activeProtections.length}`);

  const failed = results.filter(r => !r.pass);
  console.log(`\nSelf-test: ${results.length - failed.length}/${results.length} passed`);
  return failed.length === 0 ? 0 : 1;
}

if (isMain()) process.exit(runSelfTest());
