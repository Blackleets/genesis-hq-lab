// positionMonitor.mjs - multi-speed position lifecycle manager for Phase 6A engines.
//
// Monitors positions opened by:
//   scalpingEngine  (trade_type='scalp_v2')
//   swingEngine     (trade_type='swing_v1')
//   futures breakout profiles
//
// Exit conditions checked in priority order:
//   1. Risk close       -> global risk CRITICAL
//   2. Stop loss        -> current price crosses stop_price
//   3. Take profit      -> current price crosses target_price
//   4. Timeout          -> position older than days_to_close
//   5. Confidence drop  -> EMA9 crosses back against entry (momentum collapse)

import db from '../db/database.mjs';
import { getCurrentPrice } from '../crypto/priceFeeder.mjs';
import { closeCryptoPosition, getOpenPositions } from './paperExecutionEngine.mjs';
import { getGlobalRiskDiagnostics } from '../risk/globalRiskEngine.mjs';
import { logEvent, CATEGORY, SEVERITY } from '../observability/eventTimeline.mjs';
import { computeEma } from '../crypto/priceFeeder.mjs';
import { checkExitConditions as _checkExit } from './positionMonitorCore.mjs';

export { checkExitConditions } from './positionMonitorCore.mjs';

const TRADE_TYPES = [
  'scalp_v2',
  'swing_v1',
  'breakout_v1',
  'crypto_futures_breakout_short_micro',
  'crypto_futures_breakout_short',
  'crypto_futures_breakout_short_alt',
  'crypto_futures_breakout_long',
];
const FUTURES_BREAK_EVEN_TRIGGER_PCT = parseFloat(process.env.FUTURES_BREAK_EVEN_TRIGGER_PCT ?? '0.60');
const FUTURES_BREAK_EVEN_LOCK_PCT = parseFloat(process.env.FUTURES_BREAK_EVEN_LOCK_PCT ?? '0.002');

// Trade types whose edge depends on holding to TP/SL/timeout - exempt from the 1m
// momentum-collapse check, which would close a multi-hour position on intrabar noise.
const HOLD_TO_TARGET_TYPES = new Set([
  'breakout_v1',
  'crypto_futures_breakout_short_micro',
  'crypto_futures_breakout_short',
  'crypto_futures_breakout_short_alt',
  'crypto_futures_breakout_long',
]);

function maybeTightenFuturesStop(trade, currentPrice) {
  if (trade.instrument_type !== 'futures') return false;
  if (trade.entry_price == null || trade.target_price == null || trade.stop_price == null) return false;

  const isLong = trade.outcome === 'LONG';
  const entry = Number(trade.entry_price);
  const target = Number(trade.target_price);
  const stop = Number(trade.stop_price);
  const targetDistance = Math.abs(target - entry);
  if (!Number.isFinite(targetDistance) || targetDistance <= 0) return false;

  const favorableMove = isLong ? (currentPrice - entry) : (entry - currentPrice);
  const progressToTarget = favorableMove / targetDistance;
  if (!Number.isFinite(progressToTarget) || progressToTarget < FUTURES_BREAK_EVEN_TRIGGER_PCT) return false;

  const breakEvenStop = isLong
    ? entry * (1 + FUTURES_BREAK_EVEN_LOCK_PCT)
    : entry * (1 - FUTURES_BREAK_EVEN_LOCK_PCT);
  const shouldTighten = isLong ? breakEvenStop > stop : breakEvenStop < stop;
  if (!shouldTighten) return false;

  db.prepare(`UPDATE trades SET stop_price = ? WHERE id = ?`).run(breakEvenStop, trade.id);
  logEvent({
    category: CATEGORY.RISK,
    severity: SEVERITY.INFO,
    subsystem: trade.agent_id ?? 'position-monitor',
    reason: `BREAK-EVEN LOCK: ${trade.asset_pair} ${trade.outcome} stop moved to ${breakEvenStop.toFixed(5)}`,
    metadata: {
      tradeId: trade.id,
      fromStop: stop,
      toStop: breakEvenStop,
      progressToTarget: Math.round(progressToTarget * 1000) / 1000,
    },
  });
  trade.stop_price = breakEvenStop;
  return true;
}

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
    const closes = klines.map((k) => parseFloat(k[4]));

    const ema5 = computeEma(closes, 5);
    const ema13 = computeEma(closes, 13);

    const isLong = trade.outcome === 'LONG';
    if (isLong && ema5 < ema13 * 0.999) return true;
    if (!isLong && ema5 > ema13 * 1.001) return true;
    return false;
  } catch {
    return false;
  }
}

export async function monitorPositions({ checkMomentum = false } = {}) {
  const result = { checked: 0, closed: 0, tp: 0, sl: 0, timeout: 0, risk: 0, momentum: 0 };

  const risk = getGlobalRiskDiagnostics();
  const riskBand = risk.band;

  const allOpen = [];
  for (const type of TRADE_TYPES) {
    allOpen.push(...getOpenPositions(type));
  }

  if (allOpen.length === 0) return result;

  result.checked = allOpen.length;

  const pairs = [...new Set(allOpen.map((trade) => trade.asset_pair).filter(Boolean))];
  const priceMap = {};

  await Promise.all(pairs.map(async (pair) => {
    const price = await getCurrentPrice(pair);
    if (price != null) priceMap[pair] = price;
  }));

  for (const trade of allOpen) {
    const currentPrice = priceMap[trade.asset_pair];
    if (!currentPrice) continue;
    maybeTightenFuturesStop(trade, currentPrice);

    let { shouldExit, reason } = _checkExit(trade, currentPrice, riskBand);

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
    if (reason === 'take_profit') result.tp++;
    else if (reason === 'stop_loss') result.sl++;
    else if (reason === 'timeout') result.timeout++;
    else if (reason === 'risk_close') result.risk++;
    else if (reason === 'confidence_collapse') result.momentum++;

    const eng = trade.trade_type === 'scalp_v2' ? 'SCALP_V2' : trade.trade_type === 'swing_v1' ? 'SWING_V1' : null;
    if (eng) {
      const pnlStr = closed.pnl != null ? `$${closed.pnl.toFixed(2)}` : '?';
      const evtLabel = reason === 'take_profit' ? `${eng}_TP_HIT` : reason === 'stop_loss' ? `${eng}_SL_HIT` : `${eng}_EXITED`;
      logEvent({
        category: reason === 'stop_loss' ? CATEGORY.RISK : CATEGORY.EXECUTION,
        severity: reason === 'stop_loss' ? SEVERITY.WARNING : SEVERITY.INFO,
        subsystem: trade.agent_id ?? 'position-monitor',
        reason: `${evtLabel} - ${trade.outcome} ${trade.asset_pair} pnl=${pnlStr} exit=${reason}`,
        metadata: { id: trade.id, pair: trade.asset_pair, side: trade.outcome, pnl: closed.pnl, exitType: reason },
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (result.closed > 0) {
    console.log(
      `[positionMonitor] Closed ${result.closed}: `
      + `TP=${result.tp} SL=${result.sl} timeout=${result.timeout} risk=${result.risk} momentum=${result.momentum}`
    );
  }

  return result;
}

export function getTrainingMetrics() {
  const tradeTypes = `('${TRADE_TYPES.join("','")}')`;

  const total = db.prepare(`SELECT COUNT(*) as n FROM trades WHERE trade_type IN ${tradeTypes}`).get()?.n ?? 0;
  const open = db.prepare(`SELECT COUNT(*) as n FROM trades WHERE trade_type IN ${tradeTypes} AND status='open'`).get()?.n ?? 0;
  const closed = db.prepare(`SELECT COUNT(*) as n FROM trades WHERE trade_type IN ${tradeTypes} AND status='closed'`).get()?.n ?? 0;
  const wins = db.prepare(`SELECT COUNT(*) as n FROM trades WHERE trade_type IN ${tradeTypes} AND status='closed' AND pnl > 0`).get()?.n ?? 0;
  const totalPnl = db.prepare(`SELECT COALESCE(SUM(pnl), 0) as s FROM trades WHERE trade_type IN ${tradeTypes} AND status='closed'`).get()?.s ?? 0;

  const winRate = closed > 0 ? wins / closed : null;

  const byType = TRADE_TYPES.map((type) => {
    const n = db.prepare(`SELECT COUNT(*) as n FROM trades WHERE trade_type = ? AND status='closed'`).get(type)?.n ?? 0;
    const w = db.prepare(`SELECT COUNT(*) as n FROM trades WHERE trade_type = ? AND status='closed' AND pnl > 0`).get(type)?.n ?? 0;
    const p = db.prepare(`SELECT COALESCE(SUM(pnl), 0) as s FROM trades WHERE trade_type = ? AND status='closed'`).get(type)?.s ?? 0;
    return {
      tradeType: type,
      trades: n,
      wins: w,
      winRate: n > 0 ? Math.round((w / n) * 100) / 100 : null,
      pnl: Math.round(p * 100) / 100,
    };
  });

  return {
    total,
    open,
    closed,
    wins,
    winRate: winRate !== null ? Math.round(winRate * 100) / 100 : null,
    totalPnl: Math.round(totalPnl * 100) / 100,
    byType,
  };
}
