import db from '../db/database.mjs';
import { CRYPTO_FUTURES_TRADE_TYPES } from './cryptoTradeUniverse.mjs';

const FUTURES_DESK_START_CAPITAL = parseFloat(process.env.FUTURES_DESK_START_CAPITAL ?? '10000');
const MIN_TRADE_USD = 0.50;
const FUTURES_TYPES_SQL = `('${CRYPTO_FUTURES_TRADE_TYPES.join("','")}')`;

function round2(value) {
  return value == null ? null : Math.round(value * 100) / 100;
}

export function getFuturesCapitalState({ unrealizedPnl = 0 } = {}) {
  const openRow = db.prepare(`
    SELECT COUNT(*) AS open_count,
           COALESCE(SUM(capital_used), 0) AS reserved_margin
    FROM trades
    WHERE status = 'open' AND trade_type IN ${FUTURES_TYPES_SQL}
  `).get();

  const closedRow = db.prepare(`
    SELECT COALESCE(SUM(pnl), 0) AS realized_pnl
    FROM trades
    WHERE status = 'closed' AND trade_type IN ${FUTURES_TYPES_SQL}
  `).get();

  const reservedMargin = round2(openRow?.reserved_margin ?? 0) ?? 0;
  const realizedPnl = round2(closedRow?.realized_pnl ?? 0) ?? 0;
  const markPnl = round2(unrealizedPnl ?? 0) ?? 0;
  const equity = round2(FUTURES_DESK_START_CAPITAL + realizedPnl + markPnl) ?? FUTURES_DESK_START_CAPITAL;
  const available = round2(equity - reservedMargin) ?? 0;

  return {
    startCapital: round2(FUTURES_DESK_START_CAPITAL),
    reservedMargin,
    realizedPnl,
    unrealizedPnl: markPnl,
    netPnl: round2(realizedPnl + markPnl) ?? 0,
    equity,
    available,
    openPositions: openRow?.open_count ?? 0,
  };
}

export function reserveFuturesCapital(amount) {
  const marginRequired = round2(amount) ?? 0;
  const capital = getFuturesCapitalState();

  if (marginRequired < MIN_TRADE_USD) {
    return { ok: false, reason: `Trade too small ($${marginRequired.toFixed(2)} < $${MIN_TRADE_USD.toFixed(2)} minimum)` };
  }
  if (marginRequired > capital.available) {
    return {
      ok: false,
      reason: `Insufficient futures capital: need $${marginRequired.toFixed(2)}, have $${capital.available.toFixed(2)}`,
    };
  }

  return {
    ok: true,
    reserved: marginRequired,
    capital,
  };
}
