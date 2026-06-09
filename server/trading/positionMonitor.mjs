// positionMonitor.mjs — multi-speed position lifecycle manager for Phase 6A engines.
//
// Monitors positions opened by:
//   scalpingEngine  (trade_type='scalp_v2')
//   swingEngine     (trade_type='swing_v1')
//
// (The existing positionManager.mjs handles trade_type='crypto_scalp' — no conflict.)
//
// Exit conditions checked in priority order:
//   1. Risk close       — global risk CRITICAL
//   2. Stop loss        — current price crosses stop_price
//   3. Take profit      — current price crosses target_price
//   4. Timeout          — position older than days_to_close
//   5. Confidence drop  — EMA9 crosses back against entry (momentum collapse)

import db from '../db/database.mjs';
import { getCurrentPrice } from '../crypto/priceFeeder.mjs';
import { closeCryptoPosition, getOpenPositions } from './paperExecutionEngine.mjs';
import { isGlobalSafeMode, getGlobalRiskDiagnostics } from '../risk/globalRiskEngine.mjs';
import { analyzeClosedTrade } from '../memory/learningEngine.mjs';
import { logEvent, CATEGORY, SEVERITY } from '../observability/eventTimeline.mjs';
import { computeEma } from '../crypto/priceFeeder.mjs';

const TRADE_TYPES = ['scalp_v2', 'swing_v1', 'breakout_v1', 'crypto_futures_breakout_short_micro', 'crypto_futures_breakout_short', 'crypto_futures_breakout_short_alt', 'crypto_futures_breakout_long'];

// Trade types whose edge depends on holding to TP/SL/timeout — exempt from the 1m
// momentum-collapse check, which would close a multi-hour position on intrabar noise.
const HOLD_TO_TARGET_TYPES = new Set(['breakout_v1', 'crypto_futures_breakout_short_micro', 'crypto_futures_breakout_short', 'crypto_futures_breakout_short_alt', 'crypto_futures_breakout_long']);

// ── Check exit conditions for a single position ───────────────────────────────

/**
 * Returns { shouldExit: boolean, reason: string | null, exitType: 'tp'|'sl'|'timeout'|'risk'|'momentum' | null }
 */
function checkExitConditions(trade, currentPrice, riskBand) {
  const isLong = trade.outcome === 'LONG';
  const ageMs  = Date.now() - new Date(trade.opened_at).getTime();
  const ageH   = ageMs / (1000 * 60 * 60);

  // 1. Risk close: CRITICAL system risk → force exit everything
  if (riskBand === 'CRITICAL') {
    return { shouldExit: true, reason: 'risk_close', exitType: 'risk' };
  }

  // 2. Stop loss
  if (trade.stop_price != null) {
    const slHit = isLong
      ? currentPrice <= trade.stop_price
      : currentPrice >= trade.stop_price;
    if (slHit) {
      return { shouldExit: true, reason: 'stop_loss', exitType: 'sl' };
    }
  }

  // 3. Take profit
  if (trade.target_price != null) {
    const tpHit = isLong
      ? currentPrice >= trade.target_price
      : currentPrice <= trade.target_price;
    if (tpHit) {
      return { shouldExit: true, reason: 'take_profit', exitType: 'tp' };
    }
  }

  // 4. Timeout
  if (trade.days_to_close != null) {
    const maxHours = trade.days_to_close * 24;
    if (ageH >= maxHours) {
      return { shouldExit: true, reason: 'timeout', exitType: 'timeout' };
    }
  }

  return { shouldExit: false, reason: null, exitType: null };
}

// ── Monitor confidence collapse (EMA momentum check) ─────────────────────────

/**
 * Fetch recent 1m closes and check if momentum has reversed against position direction.
 * Uses 10 recent closes to compute EMA5 vs EMA13 (fast proxy for momentum).
 */
async function checkMomentumCollapse(trade) {
  try {
    const pair = trade.asset_pair;
    if (!pair) return false;

    const BINANCE_BASE = process.env.BINANCE_BASE || 'https://data-api.binance.vision/api/v3';
    const res = await fetch(`${BINANCE_BASE}/klines?symbol=${pair}&interval=1m&limit=20`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return false;
    const klines = await res.json();
    const closes = klines.map(k => parseFloat(k[4]));

    const ema5  = computeEma(closes, 5);
    const ema13 = computeEma(closes, 13);

    const isLong = trade.outcome === 'LONG';
    // Momentum collapsed if short-term EMA reversed against our direction
    if (isLong  && ema5 < ema13 * 0.999) return true;
    if (!isLong && ema5 > ema13 * 1.001) return true;
    return false;
  } catch {
    return false; // don't exit on failed check
  }
}

// ── Main monitor function ─────────────────────────────────────────────────────

/**
 * Check and close all open positions from Phase 6A engines.
 * @param {{ checkMomentum?: boolean }} opts — momentum check is slow (network call), skip on fast runs
 */
export async function monitorPositions({ checkMomentum = false } = {}) {
  const result = { checked: 0, closed: 0, tp: 0, sl: 0, timeout: 0, risk: 0, momentum: 0 };

  const risk = getGlobalRiskDiagnostics();
  const riskBand = risk.band;

  // Load all open positions from Phase 6A engines
  const allOpen = [];
  for (const type of TRADE_TYPES) {
    allOpen.push(...getOpenPositions(type));
  }

  if (allOpen.length === 0) return result;

  result.checked = allOpen.length;

  // Group by asset pair to batch price fetches
  const pairs = [...new Set(allOpen.map(t => t.asset_pair).filter(Boolean))];
  const priceMap = {};

  await Promise.all(pairs.map(async (pair) => {
    const price = await getCurrentPrice(pair);
    if (price != null) priceMap[pair] = price;
  }));

  for (const trade of allOpen) {
    const currentPrice = priceMap[trade.asset_pair];
    if (!currentPrice) continue;

    let { shouldExit, reason } = checkExitConditions(trade, currentPrice, riskBand);

    // Momentum collapse check (only on mid/slow runs — network overhead). Exempt
    // hold-to-target strategies (e.g. breakout_v1) — their edge needs the full hold.
    if (!shouldExit && checkMomentum && !HOLD_TO_TARGET_TYPES.has(trade.trade_type)) {
      const collapsed = await checkMomentumCollapse(trade);
      if (collapsed) {
        shouldExit = true;
        reason = 'confidence_collapse';
      }
    }

    if (!shouldExit) continue;

    const closed = await closeCryptoPosition(trade.id, currentPrice, reason, trade.agent_id);
    if (!closed) continue;

    result.closed++;
    if (reason === 'take_profit')       result.tp++;
    else if (reason === 'stop_loss')    result.sl++;
    else if (reason === 'timeout')      result.timeout++;
    else if (reason === 'risk_close')   result.risk++;
    else if (reason === 'confidence_collapse') result.momentum++;

    // Trigger learning on close
    try {
      await analyzeClosedTrade({ ...trade, pnl: closed.pnl, closedAt: closed.closedAt, exitReason: reason });
    } catch { /* best-effort — don't block */ }

    // Throttle to avoid overwhelming DB
    await new Promise(r => setTimeout(r, 100));
  }

  if (result.closed > 0) {
    console.log(
      `[positionMonitor] Closed ${result.closed}: ` +
      `TP=${result.tp} SL=${result.sl} timeout=${result.timeout} risk=${result.risk} momentum=${result.momentum}`
    );
  }

  return result;
}

// ── Training metrics snapshot ─────────────────────────────────────────────────

/**
 * Returns current training metrics for operator visibility.
 */
export function getTrainingMetrics() {
  const tradeTypes = `('${TRADE_TYPES.join("','")}')`;

  const total = db.prepare(`SELECT COUNT(*) as n FROM trades WHERE trade_type IN ${tradeTypes}`).get()?.n ?? 0;
  const open  = db.prepare(`SELECT COUNT(*) as n FROM trades WHERE trade_type IN ${tradeTypes} AND status='open'`).get()?.n ?? 0;
  const closed = db.prepare(`SELECT COUNT(*) as n FROM trades WHERE trade_type IN ${tradeTypes} AND status='closed'`).get()?.n ?? 0;
  const wins   = db.prepare(`SELECT COUNT(*) as n FROM trades WHERE trade_type IN ${tradeTypes} AND status='closed' AND pnl > 0`).get()?.n ?? 0;
  const totalPnl = db.prepare(`SELECT COALESCE(SUM(pnl), 0) as s FROM trades WHERE trade_type IN ${tradeTypes} AND status='closed'`).get()?.s ?? 0;

  const winRate = closed > 0 ? wins / closed : null;

  const byType = TRADE_TYPES.map(type => {
    const n = db.prepare(`SELECT COUNT(*) as n FROM trades WHERE trade_type = ? AND status='closed'`).get(type)?.n ?? 0;
    const w = db.prepare(`SELECT COUNT(*) as n FROM trades WHERE trade_type = ? AND status='closed' AND pnl > 0`).get(type)?.n ?? 0;
    const p = db.prepare(`SELECT COALESCE(SUM(pnl), 0) as s FROM trades WHERE trade_type = ? AND status='closed'`).get(type)?.s ?? 0;
    return { tradeType: type, trades: n, wins: w, winRate: n > 0 ? Math.round(w / n * 100) / 100 : null, pnl: Math.round(p * 100) / 100 };
  });

  return {
    total, open, closed, wins,
    winRate: winRate !== null ? Math.round(winRate * 100) / 100 : null,
    totalPnl: Math.round(totalPnl * 100) / 100,
    byType,
  };
}
