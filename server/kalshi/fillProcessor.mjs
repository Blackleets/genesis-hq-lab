// fillProcessor.mjs — Process Kalshi WebSocket fills and close trades.
//
// Listens to WS 'order_filled' events, matches to open trades,
// closes them with real fill data, and generates lessons.

import db from '../db/database.mjs';
import { closeTrade } from '../memory/tradingMemory.mjs';
import { settleTradeCapital } from '../trading/treasury.mjs';
import { updateAfterTrade } from '../memory/agentScoring.mjs';
import { processMarketResolution } from '../memory/decisionAccuracyEngine.mjs';

const FILL_TIMEOUT_MS = 60_000; // wait 60s for fill to settle before timing out

// In-memory tracking of pending fills (orderId → timeoutHandle)
const _pendingFills = new Map();

/**
 * Process a Kalshi WebSocket fill event.
 * Matches orderId to open trade, closes it with real fill price + quantity.
 */
export function processFill(fillEvent) {
  try {
    const { orderId, ticker, side, count, price, ts } = fillEvent;

    if (!orderId) {
      console.warn('[kalshi:fill] ignoring fill without orderId');
      return;
    }

    // Find trade by external_order_id (Kalshi orderId)
    const trade = db.prepare(`
      SELECT * FROM trades
      WHERE external_order_id = ? AND status = 'open'
    `).get(orderId);

    if (!trade) {
      console.warn(`[kalshi:fill] no open trade found for Kalshi order ${orderId}`);
      return;
    }

    console.log(`[kalshi:fill] FILL: trade ${trade.id}, ${side}, ${count} @ ${price.toFixed(4)}`);

    // Clear any timeout for this orderId
    if (_pendingFills.has(orderId)) {
      clearTimeout(_pendingFills.get(orderId));
      _pendingFills.delete(orderId);
    }

    // Close trade with real fill price
    const fillPrice = price; // Kalshi price already normalized to 0-1 by WS
    const outcome = side?.toUpperCase() === 'YES' ? 'YES' : 'NO';

    // Compute realized PnL
    const shares = trade.shares ?? 1;
    const fillProceeds = fillPrice * 100 * shares; // Kalshi prices in cents
    const entryCapital = trade.capital_used ?? 100;
    const realizedPnL = fillProceeds - entryCapital;

    console.log('[kalshi:fill] Calling closeTrade with:', {exitPrice: fillPrice, exitReason: `Kalshi real fill: ${outcome}`, pnl: realizedPnL});
    closeTrade(trade.id, {
      filledAt: ts || new Date().toISOString(),
      exitPrice: fillPrice,
      exitReason: `Kalshi real fill: ${outcome} ${count} @ ${price.toFixed(4)}`,
      pnl: realizedPnL,
    });
    console.log('[kalshi:fill] closeTrade returned OK');

    // Settle capital (return to available bucket)
    console.log('[kalshi:fill] Calling settleTradeCapital with:', {capitalUsed: entryCapital, pnl: realizedPnL});
    const treasury = settleTradeCapital(entryCapital, realizedPnL);
    console.log('[kalshi:fill] settleTradeCapital returned:', treasury);

    // Score update on agent (optional — might not exist for all agents)
    try {
      updateAfterTrade(trade.agent_id, realizedPnL);
    } catch (e) {
      // Silent fail — agent update is optional
    }

    console.log(`[kalshi:fill] ✓ closed trade ${trade.id}, PnL: $${realizedPnL.toFixed(2)}`);
  } catch (err) {
    console.error('[kalshi:fill] processFill error:', err.message);
    console.error('[kalshi:fill] stack:', err.stack?.split('\n').slice(0, 3).join(' | '));
  }
}

/**
 * Process position update from Kalshi WebSocket.
 * Validates that positions match open trades.
 */
export function processPosition(positionEvent) {
  try {
    const { ticker, position, value } = positionEvent;

    if (position == null) {
      console.warn('[kalshi:pos] ignoring position without count');
      return;
    }

    // If position is 0, check for orphaned trades (should have closed by now)
    if (position === 0) {
      const orphaned = db.prepare(`
        SELECT id FROM trades
        WHERE market_source = 'kalshi' AND market_id = ? AND status = 'open'
        AND opened_at < datetime('now', '-1 hour')
      `).all(ticker);

      if (orphaned.length > 0) {
        console.warn(`[kalshi:pos] ${orphaned.length} orphaned trades on ${ticker} (position now 0)`);
      }
      return;
    }

    // If position > 0, verify there's an open trade
    const openTrade = db.prepare(`
      SELECT id, shares FROM trades
      WHERE market_source = 'kalshi' AND market_id = ? AND status = 'open'
      LIMIT 1
    `).get(ticker);

    if (!openTrade) {
      console.warn(`[kalshi:pos] WARNING: Kalshi position ${position} on ${ticker} but no open trade in DB`);
      return;
    }

    console.log(`[kalshi:pos] ✓ verified: ${ticker} position ${position} (trade ${openTrade.id})`);
  } catch (err) {
    console.error('[kalshi:pos] processPosition error:', err.message);
  }
}

/**
 * Set a timeout for a pending fill.
 * If fill doesn't arrive within FILL_TIMEOUT_MS, log as ghost order.
 */
export function trackPendingFill(orderId) {
  if (_pendingFills.has(orderId)) return; // already tracking

  const timeout = setTimeout(() => {
    _pendingFills.delete(orderId);
    const trade = db.prepare(
      `SELECT id FROM trades WHERE external_order_id = ? AND status = 'open'`
    ).get(orderId);

    if (trade) {
      console.warn(`[kalshi:fill] TIMEOUT: no fill for Kalshi order ${orderId} (trade ${trade.id}) within 60s`);
      // Could set a flag on trade for manual review, but don't auto-close
    }
  }, FILL_TIMEOUT_MS);

  _pendingFills.set(orderId, timeout);
  console.log(`[kalshi:fill] tracking pending fill: ${orderId}`);
}

/**
 * Clear all pending fill timeouts (for shutdown).
 */
export function clearPendingFills() {
  for (const timeout of _pendingFills.values()) {
    clearTimeout(timeout);
  }
  _pendingFills.clear();
}
