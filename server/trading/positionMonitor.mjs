// positionMonitor.mjs — real-time stop-loss & take-profit engine.
//
// THIS IS THE CORE OF SCALPING DISCIPLINE.
// Without this, positions sit passively until binary resolution.
// With this, the system actively manages every open trade:
//   - TAKE_PROFIT: exit when price moves +% in our favor (bank the gain)
//   - STOP_LOSS:   exit when price moves -% against us (cut the loss)
//
// Runs every 2 minutes via agentRunner.
// Uses fetchCurrentPrice() from marketScanner — real Polymarket/Kalshi APIs.

import db, { tx } from '../db/database.mjs';
import { fetchCurrentPrice } from '../marketScanner.mjs';
import { settleTradeCapital } from './treasury.mjs';

// ─── Exit thresholds ──────────────────────────────────────────────────────────

const THRESHOLDS = {
  scalp: {
    takeProfit: 0.28,  // +28% price move → take profits, done
    stopLoss:   0.20,  // -20% price move → cut loss, protect capital
  },
  swing: {
    takeProfit: 0.45,  // +45% move → take early on swings too
    stopLoss:   0.28,  // -28% on swing — more room to breathe
  },
};

// ─── Check all open trades for exit triggers ──────────────────────────────────

export async function runPositionMonitor(broadcast) {
  const openTrades = db.prepare(
    `SELECT * FROM trades WHERE status = 'open' ORDER BY opened_at ASC`
  ).all();

  if (openTrades.length === 0) return { checked: 0, closed: 0, details: [] };

  let closed = 0;
  const details = [];

  for (const trade of openTrades) {
    try {
      const priceData = await fetchCurrentPrice(trade.market_source, trade.market_id);
      if (!priceData) continue;

      const { yesPrice, noPrice } = priceData;
      const currentPrice = trade.outcome === 'YES' ? yesPrice : noPrice;
      if (currentPrice == null || isNaN(currentPrice)) continue;

      const entryPrice  = trade.entry_price;
      const priceChange = (currentPrice - entryPrice) / entryPrice; // fraction

      const isScalp = (trade.trade_type ?? 'swing') === 'scalp';
      const thresh  = isScalp ? THRESHOLDS.scalp : THRESHOLDS.swing;

      let exitReason = null;
      if (priceChange >= thresh.takeProfit) exitReason = 'TAKE_PROFIT';
      if (priceChange <= -thresh.stopLoss)  exitReason = 'STOP_LOSS';
      if (!exitReason) continue;

      // Calculate PnL at current price (paper settlement)
      const pnl = (currentPrice - entryPrice) * trade.shares;
      const pnlPct = (priceChange * 100).toFixed(1);

      // Close the trade in DB
      tx(() => {
        db.prepare(`
          UPDATE trades
          SET status          = 'closed',
              exit_price      = ?,
              pnl             = ?,
              closed_at       = datetime('now'),
              resolved_outcome = ?
          WHERE id = ?
        `).run(currentPrice, pnl, exitReason, trade.id);
      });

      // Return capital to treasury
      settleTradeCapital(trade.capital_used, pnl);

      const label = exitReason === 'TAKE_PROFIT' ? '✅ TAKE PROFIT' : '🛑 STOP LOSS';
      console.log(
        `[positionMonitor] ${label}: ${trade.market_question?.slice(0, 45)}` +
        ` | PnL: $${pnl.toFixed(2)} (${pnlPct}%) | Entry: ${entryPrice.toFixed(3)} → Exit: ${currentPrice.toFixed(3)}`
      );

      details.push({ tradeId: trade.id, reason: exitReason, pnl, priceChange, currentPrice });
      closed++;

      // Broadcast to WebSocket clients
      if (typeof broadcast === 'function') {
        broadcast({
          type:         'position_closed',
          reason:       exitReason,
          tradeId:      trade.id,
          question:     trade.market_question,
          pnl:          Math.round(pnl * 100) / 100,
          priceChange:  Math.round(priceChange * 10000) / 100,
          isScalp,
        });
      }

    } catch (err) {
      console.error(`[positionMonitor] Error checking trade ${trade.id}:`, err.message);
    }

    // 250ms between API calls — be a good citizen to Polymarket/Kalshi
    await new Promise(r => setTimeout(r, 250));
  }

  return { checked: openTrades.length, closed, details };
}

// ─── Circuit breaker — pause scalping if too many stop-losses in a row ────────

export function getScalpingCircuitBreaker() {
  const recentScalps = db.prepare(`
    SELECT resolved_outcome, closed_at, pnl
    FROM trades
    WHERE trade_type = 'scalp'
      AND status     = 'closed'
      AND closed_at IS NOT NULL
    ORDER BY closed_at DESC
    LIMIT 5
  `).all();

  // Count consecutive STOP_LOSS exits at the head of the list
  let consecutiveStopLosses = 0;
  for (const t of recentScalps) {
    if (t.resolved_outcome === 'STOP_LOSS') consecutiveStopLosses++;
    else break;
  }

  const tripped = consecutiveStopLosses >= 3;

  if (tripped) {
    // Check if it tripped in the last 60 minutes
    const lastStopAt  = recentScalps[0]?.closed_at;
    const minutesAgo  = lastStopAt
      ? (Date.now() - new Date(lastStopAt).getTime()) / 60000
      : 999;
    const cooldownMin = 60;  // 1-hour pause after 3 consecutive stop-losses
    if (minutesAgo < cooldownMin) {
      return {
        tripped: true,
        reason:  `${consecutiveStopLosses} consecutive stop-losses. Scalping paused for ${(cooldownMin - minutesAgo).toFixed(0)} more minutes.`,
      };
    }
  }

  return { tripped: false, consecutiveStopLosses };
}
