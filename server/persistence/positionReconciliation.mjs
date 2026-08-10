// positionReconciliation.mjs — reconcile open positions on startup
// ═══════════════════════════════════════════════════════════════════════════════════════

import db from '../db/database.mjs';

// ─── Reconcile all open positions on startup ────────────────────────────────

export async function reconcilePositionsOnStartup() {
  console.log('[positionReconciliation] Starting position reconciliation...');

  try {
    const openTrades = db.prepare(`
      SELECT id, market_id, market_source, outcome, entry_price, status
      FROM trades
      WHERE status = 'open'
      ORDER BY opened_at ASC
    `).all();

    console.log(`[positionReconciliation] Found ${openTrades.length} open positions to check`);

    const results = {
      checked: 0,
      stillOpen: 0,
      closed: 0,
      expired: 0,
      errored: 0,
      summary: [],
    };

    for (const trade of openTrades) {
      const reconcileResult = await reconcileTradePosition(trade);
      results.checked++;

      if (reconcileResult.status === 'closed') results.closed++;
      else if (reconcileResult.status === 'expired') results.expired++;
      else if (reconcileResult.status === 'open') results.stillOpen++;
      else results.errored++;

      results.summary.push(reconcileResult);
    }

    console.log(`[positionReconciliation] Complete:`, results);
    return results;
  } catch (err) {
    console.error('[positionReconciliation] Error during reconciliation:', err.message);
    return {
      checked: 0,
      stillOpen: 0,
      closed: 0,
      expired: 0,
      errored: 1,
      summary: [{ tradeId: 'error', error: err.message }],
    };
  }
}

// ─── Reconcile a single trade position ───────────────────────────────────────

async function reconcileTradePosition(trade) {
  const logRecord = {
    tradeId: trade.id,
    marketId: trade.market_id,
    statusBefore: trade.status,
    statusAfter: null,
    marketStatus: null,
    resolvedOutcome: null,
    notes: null,
  };

  try {
    // Call market to get current status
    let marketStatus;

    if (trade.market_source === 'polymarket') {
      marketStatus = await getPolymarketStatus(trade.market_id);
    } else if (trade.market_source === 'kalshi') {
      marketStatus = await getKalshiStatus(trade.market_id);
    } else if (trade.market_source === 'crypto') {
      marketStatus = await getCryptoStatus(trade.market_id);
    } else {
      throw new Error(`Unknown market source: ${trade.market_source}`);
    }

    logRecord.marketStatus = marketStatus.status;

    if (marketStatus.status === 'resolved') {
      // Market resolved: close the trade
      const pnl = calculatePnL(trade, marketStatus.outcome);

      db.prepare(`
        UPDATE trades
        SET status = 'closed', resolved_outcome = ?, pnl = ?, closed_at = datetime('now'), exit_reason = 'reconciliation:market_resolved'
        WHERE id = ?
      `).run(marketStatus.outcome, pnl, trade.id);

      logRecord.statusAfter = 'closed';
      logRecord.resolvedOutcome = marketStatus.outcome;
      logRecord.notes = `Market resolved on ${marketStatus.outcome}. PnL: $${pnl.toFixed(2)}`;

      console.log(`[positionReconciliation] Trade ${trade.id} closed: ${logRecord.notes}`);
    } else if (marketStatus.status === 'open') {
      // Market still open: leave trade as-is
      logRecord.statusAfter = 'open';
      logRecord.notes = 'Market still open, position maintained';
    } else if (marketStatus.status === 'expired') {
      // Market expired without resolution: mark as expired
      db.prepare(`
        UPDATE trades
        SET status = 'expired', closed_at = datetime('now'), exit_reason = 'reconciliation:market_expired'
        WHERE id = ?
      `).run(trade.id);

      logRecord.statusAfter = 'expired';
      logRecord.notes = 'Market expired without resolution';

      console.log(`[positionReconciliation] Trade ${trade.id} expired`);
    } else {
      // Unknown status: leave as-is but log
      logRecord.statusAfter = trade.status;
      logRecord.notes = `Unknown market status: ${marketStatus.status}`;
    }
  } catch (err) {
    // Network error or API failure: leave position alone, log error
    logRecord.statusAfter = 'error';
    logRecord.notes = `Error checking market: ${err.message}`;

    console.error(`[positionReconciliation] Error reconciling ${trade.id}:`, err.message);
  }

  // Record reconciliation attempt in DB
  try {
    db.prepare(`
      INSERT INTO position_reconciliation_log
      (id, trade_id, reconciliation_ts, status_before, status_after, market_status, resolved_outcome, notes, created_at)
      VALUES (?, ?, datetime('now'), ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      `reconcile-${trade.id}-${Date.now()}`,
      trade.id,
      logRecord.statusBefore,
      logRecord.statusAfter,
      logRecord.marketStatus,
      logRecord.resolvedOutcome,
      logRecord.notes
    );
  } catch (err) {
    console.error(`[positionReconciliation] Error logging reconciliation for ${trade.id}:`, err.message);
  }

  return logRecord;
}

// ─── Market status checkers (stubs — integrate with real market APIs) ───────

async function getPolymarketStatus(marketId) {
  // TODO: Integrate with Polymarket API
  // For now, return stub
  return { status: 'open', outcome: null };
}

async function getKalshiStatus(marketId) {
  // TODO: Integrate with Kalshi API
  // For now, return stub
  return { status: 'open', outcome: null };
}

async function getCryptoStatus(marketId) {
  // TODO: Integrate with Crypto exchange APIs
  // For now, return stub
  return { status: 'open', outcome: null };
}

// ─── Calculate PnL on resolved position ───────────────────────────────────

function calculatePnL(trade, outcome) {
  const isWin = trade.outcome === outcome;

  if (isWin) {
    // Won: calculate profit based on odds movement
    const exitPrice = 1.0; // Won = full value
    const profit = (exitPrice - trade.entry_price) * trade.shares;
    return profit;
  } else {
    // Loss: calculate loss
    const exitPrice = 0.0; // Lost = zero
    const loss = (exitPrice - trade.entry_price) * trade.shares;
    return loss;
  }
}

// ─── Check reconciliation status ─────────────────────────────────────────────

export function getReconciliationStatus() {
  try {
    const latestLog = db.prepare(`
      SELECT reconciliation_ts, status_after, COUNT(*) as count
      FROM position_reconciliation_log
      WHERE date(reconciliation_ts) = date('now')
      GROUP BY reconciliation_ts
      ORDER BY reconciliation_ts DESC
      LIMIT 1
    `).get();

    if (!latestLog) {
      return { lastRun: null, positionsChecked: 0 };
    }

    return {
      lastRun: latestLog.reconciliation_ts,
      positionsChecked: latestLog.count,
    };
  } catch (err) {
    console.error('[positionReconciliation] getReconciliationStatus error:', err.message);
    return { lastRun: null, positionsChecked: 0 };
  }
}
