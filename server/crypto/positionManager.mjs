// positionManager.mjs — checks open crypto_scalp trades every minute.
// Closes positions that hit their target_price, stop_price, or 4h timeout.

import db from '../db/database.mjs';
import { getCurrentPrice } from './priceFeeder.mjs';
import { closeCryptoTrade } from './cryptoExecution.mjs';
import { settleTradeCapital } from '../trading/treasury.mjs';
import { analyzeClosedTrade } from '../memory/learningEngine.mjs';
import { getParams } from './strategyParams.mjs';

export async function manageCryptoPositions() {
  const TIMEOUT_HOURS = getParams().timeoutHours;
  const openTrades = db.prepare(`
    SELECT * FROM trades
    WHERE status = 'open' AND trade_type = 'crypto_scalp'
    ORDER BY opened_at ASC
  `).all();

  if (openTrades.length === 0) return { checked: 0, closed: 0 };

  let closed = 0;

  for (const trade of openTrades) {
    const currentPrice = await getCurrentPrice(trade.asset_pair);
    if (!currentPrice) continue;

    const ageHours = (Date.now() - new Date(trade.opened_at).getTime()) / (1000 * 60 * 60);
    const isLong   = trade.outcome === 'LONG';

    let exitReason = null;
    if (ageHours >= TIMEOUT_HOURS) {
      exitReason = 'timeout';
    } else if (isLong) {
      if (currentPrice >= trade.target_price) exitReason = 'target_hit';
      else if (currentPrice <= trade.stop_price) exitReason = 'stop_loss';
    } else {
      if (currentPrice <= trade.target_price) exitReason = 'target_hit';
      else if (currentPrice >= trade.stop_price) exitReason = 'stop_loss';
    }

    if (!exitReason) continue;

    const closedTrade = closeCryptoTrade(trade.id, currentPrice, exitReason);
    if (!closedTrade) continue;
    closed++;

    settleTradeCapital(trade.capital_used, closedTrade.pnl ?? 0);

    try { await analyzeClosedTrade(closedTrade); } catch { /* best-effort */ }
    await new Promise(r => setTimeout(r, 300));
  }

  if (closed > 0) console.log(`[positionManager] Closed ${closed} crypto position(s)`);
  return { checked: openTrades.length, closed };
}
