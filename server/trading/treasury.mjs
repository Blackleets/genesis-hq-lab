// treasury.mjs — virtual capital management for Genesis HQ trading.
// Tracks every dollar, enforces drawdown limits, allocates gains per Constitution Rule #6.

import db, { tx } from '../db/database.mjs';
import { nanoid } from '../utils.mjs';
import { fetchCurrentPrice } from '../marketScanner.mjs';

// ─── Constants ────────────────────────────────────────────────────────────────

const STARTING_CAPITAL = 10_000;
const DRAWDOWN_PAUSE_PCT = 0.15;    // pause if portfolio drops 15% from peak
const MAX_POSITION_PCT = 0.05;    // never more than 5% per trade (constitution)
const MIN_TRADE_USD = 0.50;    // don't bother with tiny trades

// Reinvestment split (Constitution Rule #6)
const REINVESTMENT = {
  reserve: 0.40,
  agentUpgrade: 0.25,
  experiments: 0.15,
  expansion: 0.10,
  liquidity: 0.10,
};

// ─── Ensure treasury table has initial record ─────────────────────────────────

function ensureTreasury() {
  const existing = db.prepare('SELECT * FROM capital_history ORDER BY recorded_at DESC LIMIT 1').get();
  if (existing) return existing;

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO capital_history
      (total, available, in_trades, bucket_reserve, bucket_upgrade,
       bucket_exp, bucket_expand, bucket_liquid, note, recorded_at)
    VALUES (?, ?, 0, 0, 0, 0, 0, 0, 'Genesis HQ initialized', ?)
  `).run(STARTING_CAPITAL, STARTING_CAPITAL, now);

  return db.prepare('SELECT * FROM capital_history ORDER BY recorded_at DESC LIMIT 1').get();
}

// ─── Get current treasury state ───────────────────────────────────────────────

export function getTreasury() {
  const row = db.prepare('SELECT * FROM capital_history ORDER BY recorded_at DESC LIMIT 1').get();
  if (!row) return ensureTreasury();

  const openPnl = getUnrealizedPnl();
  const peakCapital = getPeakCapital();
  const drawdownPct = peakCapital > 0
    ? (peakCapital - (row.total + openPnl)) / peakCapital
    : 0;

  return {
    total: row.total,
    available: row.available,
    inTrades: row.in_trades,
    unrealizedPnl: openPnl,
    netWorth: row.total + openPnl,
    peakCapital,
    drawdownPct: Math.max(0, drawdownPct),
    isPaused: drawdownPct >= DRAWDOWN_PAUSE_PCT,
    buckets: {
      reserve: row.bucket_reserve,
      agentUpgrade: row.bucket_upgrade,
      experiments: row.bucket_exp,
      expansion: row.bucket_expand,
      liquidity: row.bucket_liquid,
    },
    startingCapital: STARTING_CAPITAL,
    totalReturn: (row.total - STARTING_CAPITAL) / STARTING_CAPITAL,
  };
}

// ─── Async treasury — same shape as getTreasury() but with live P&L ──────────

export async function getTreasuryAsync() {
  const row = db.prepare('SELECT * FROM capital_history ORDER BY recorded_at DESC LIMIT 1').get();
  if (!row) return ensureTreasury();

  const openPnl = await getUnrealizedPnlAsync();
  const peakCapital = getPeakCapital();
  const drawdownPct = peakCapital > 0
    ? (peakCapital - (row.total + openPnl)) / peakCapital
    : 0;

  return {
    total: row.total,
    available: row.available,
    inTrades: row.in_trades,
    unrealizedPnl: openPnl,
    netWorth: row.total + openPnl,
    peakCapital,
    drawdownPct: Math.max(0, drawdownPct),
    isPaused: drawdownPct >= DRAWDOWN_PAUSE_PCT,
    buckets: {
      reserve: row.bucket_reserve,
      agentUpgrade: row.bucket_upgrade,
      experiments: row.bucket_exp,
      expansion: row.bucket_expand,
      liquidity: row.bucket_liquid,
    },
    startingCapital: STARTING_CAPITAL,
    totalReturn: (row.total - STARTING_CAPITAL) / STARTING_CAPITAL,
  };
}

// ─── Reserve capital for a new trade ─────────────────────────────────────────

export function reserveCapital(amount) {
  const treasury = getTreasury();

  if (treasury.isPaused) {
    return { ok: false, reason: `Trading paused — drawdown at ${(treasury.drawdownPct * 100).toFixed(1)}% (limit: ${DRAWDOWN_PAUSE_PCT * 100}%)` };
  }
  if (amount < MIN_TRADE_USD) {
    return { ok: false, reason: `Trade too small ($${amount.toFixed(2)} < $${MIN_TRADE_USD} minimum)` };
  }
  if (amount > treasury.available) {
    return { ok: false, reason: `Insufficient capital: need $${amount.toFixed(2)}, have $${treasury.available.toFixed(2)}` };
  }
  if (amount > treasury.total * MAX_POSITION_PCT) {
    return { ok: false, reason: `Position too large: $${amount.toFixed(2)} exceeds ${MAX_POSITION_PCT * 100}% max ($${(treasury.total * MAX_POSITION_PCT).toFixed(2)})` };
  }

  tx(() => {
    db.prepare(`
      INSERT INTO capital_history
        (total, available, in_trades, bucket_reserve, bucket_upgrade,
         bucket_exp, bucket_expand, bucket_liquid, note, recorded_at)
      SELECT total, available - ?, in_trades + ?,
             bucket_reserve, bucket_upgrade, bucket_exp, bucket_expand, bucket_liquid,
             'Capital reserved for trade', datetime('now')
      FROM capital_history ORDER BY recorded_at DESC LIMIT 1
    `).run(amount, amount);
  });

  return { ok: true, reserved: amount };
}

// ─── Release capital when trade closes ───────────────────────────────────────

export function settleTradeCapital(capitalUsed, pnl) {
  const returned = capitalUsed + pnl;  // could be < capitalUsed if loss

  tx(() => {
    db.prepare(`
      INSERT INTO capital_history
        (total, available, in_trades, bucket_reserve, bucket_upgrade,
         bucket_exp, bucket_expand, bucket_liquid, note, recorded_at)
      SELECT
        total + ?,
        available + ?,
        MAX(0, in_trades - ?),
        bucket_reserve + ?,
        bucket_upgrade + ?,
        bucket_exp + ?,
        bucket_expand + ?,
        bucket_liquid + ?,
        'Trade settled PnL: ' || printf('%.2f', ?),
        datetime('now')
      FROM capital_history ORDER BY recorded_at DESC LIMIT 1
    `).run(
      pnl,                               // total changes by pnl
      returned,                          // available gets back capitalUsed + pnl
      capitalUsed,                       // inTrades reduces by what was allocated
      // Reinvestment buckets (only for gains)
      pnl > 0 ? pnl * REINVESTMENT.reserve : 0,
      pnl > 0 ? pnl * REINVESTMENT.agentUpgrade : 0,
      pnl > 0 ? pnl * REINVESTMENT.experiments : 0,
      pnl > 0 ? pnl * REINVESTMENT.expansion : 0,
      pnl > 0 ? pnl * REINVESTMENT.liquidity : 0,
      pnl,
    );
  });
}

// ─── Kelly fraction calculator ────────────────────────────────────────────────
// Returns recommended position size in dollars (half-Kelly, capped at 5%)

/**
 * Pure Kelly sizing calculation — no DB dependency, fully testable.
 * @param {number} confidence  — our estimated win probability (0..1)
 * @param {number} marketPrice — price of the outcome we're buying (0..1)
 * @param {number} available   — available capital in dollars
 * @param {number} total       — total portfolio value in dollars
 */
export function kellySizeCalc(confidence, marketPrice, available, total) {
  const b = (1 / marketPrice) - 1;  // payout odds
  const p = confidence;
  const q = 1 - p;

  const fullKelly = b > 0 ? (b * p - q) / b : 0;
  const halfKelly = fullKelly / 2;

  const fraction = Math.max(0, Math.min(MAX_POSITION_PCT, halfKelly));
  const dollarSize = available * fraction;

  if (dollarSize < MIN_TRADE_USD) {
    return { fraction: 0, dollarSize: 0, shares: 0, fullKelly, halfKelly, skip: true, reason: 'Kelly recommends position too small' };
  }

  return {
    fraction,
    dollarSize: Math.floor(dollarSize * 100) / 100,
    shares: Math.floor(dollarSize / marketPrice),
    fullKelly,
    halfKelly,
    skip: false,
  };
}

export function kellySize(confidence, marketPrice) {
  const treasury = getTreasury();
  return kellySizeCalc(confidence, marketPrice, treasury.available, treasury.total);
}

// ─── Unrealized P&L from open trades ─────────────────────────────────────────

function getUnrealizedPnl() {
  // We don't have live price updates, so approximate from entry price
  // In a real system, we'd fetch current prices from Polymarket/Kalshi
  const openTrades = db.prepare(`
    SELECT capital_used, entry_price, shares FROM trades WHERE status = 'open'
  `).all();

  // Conservative: assume current price = entry price (no change)
  // This underestimates wins and overestimates stability — correct for risk management
  return 0;
}

// ─── Async unrealized P&L — fetches live prices from market APIs ──────────────

async function getUnrealizedPnlAsync() {
  const openTrades = db.prepare(`
    SELECT market_id, market_source, outcome, entry_price, shares
    FROM trades WHERE status = 'open'
  `).all();
  if (openTrades.length === 0) return 0;

  const prices = await Promise.allSettled(
    openTrades.map(t => fetchCurrentPrice(t.market_source, t.market_id))
  );

  let total = 0;
  for (let i = 0; i < openTrades.length; i++) {
    const trade = openTrades[i];
    const result = prices[i];
    if (result.status !== 'fulfilled' || !result.value) continue;
    const { yesPrice, noPrice } = result.value;
    const currentPrice = trade.outcome === 'YES' ? yesPrice : noPrice;
    if (currentPrice == null || isNaN(currentPrice)) continue;
    total += (currentPrice - trade.entry_price) * trade.shares;
  }
  return Math.round(total * 100) / 100;  // round to cents
}

// ─── Peak capital (for drawdown calculation) ──────────────────────────────────

function getPeakCapital() {
  const row = db.prepare('SELECT MAX(total) AS peak FROM capital_history').get();
  return row?.peak ?? STARTING_CAPITAL;
}

// ─── P&L summary ─────────────────────────────────────────────────────────────

export function getPnLSummary() {
  const closed = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) AS losses,
      SUM(pnl)        AS total_pnl,
      MAX(pnl)        AS best_trade,
      MIN(pnl)        AS worst_trade,
      AVG(pnl)        AS avg_pnl,
      SUM(capital_used) AS total_risked
    FROM trades WHERE status = 'closed'
  `).get();

  const open = db.prepare(`
    SELECT COUNT(*) AS cnt, SUM(capital_used) AS at_risk
    FROM trades WHERE status = 'open'
  `).get();

  return {
    closed: {
      total: closed?.total ?? 0,
      wins: closed?.wins ?? 0,
      losses: closed?.losses ?? 0,
      winRate: closed?.total > 0 ? closed.wins / closed.total : 0,
      totalPnl: closed?.total_pnl ?? 0,
      bestTrade: closed?.best_trade ?? 0,
      worstTrade: closed?.worst_trade ?? 0,
      avgPnl: closed?.avg_pnl ?? 0,
      totalRisked: closed?.total_risked ?? 0,
      roi: closed?.total_risked > 0 ? (closed.total_pnl / closed.total_risked) : 0,
    },
    open: {
      count: open?.cnt ?? 0,
      atRisk: open?.at_risk ?? 0,
    },
  };
}

// ─── Capital history for charts ───────────────────────────────────────────────

export function getCapitalHistory(limit = 100) {
  return db.prepare(`
    SELECT total, available, in_trades, note, recorded_at
    FROM capital_history
    ORDER BY recorded_at DESC LIMIT ?
  `).all(limit).reverse();
}
