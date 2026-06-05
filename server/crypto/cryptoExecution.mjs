// cryptoExecution.mjs — paper fill for crypto scalp trades.
// Saves a trade to the DB with target_price, stop_price, trade_type=crypto_scalp.

import db, { tx } from '../db/database.mjs';
import { nanoid } from '../utils.mjs';
import { cryptoNetPnl, cryptoSlippagePct } from '../trading/costs.mjs';
import { computeCryptoTargets, computeCryptoPnl } from './cryptoMath.mjs';

// Re-exported so existing importers (and tests) keep working.
export { computeCryptoTargets, computeCryptoPnl };

export function executeCryptoPaperTrade({ asset, side, entryPrice, capitalUsed, confidence, reason, evidence }) {
  const shares = Math.floor((capitalUsed / entryPrice) * 10000) / 10000;
  const effectiveCapital = Math.round(shares * entryPrice * 100) / 100;
  const { targetPrice, stopPrice } = computeCryptoTargets(side, entryPrice);
  const id = `crypto-${nanoid()}`;

  tx(() => {
    db.prepare(`
      INSERT INTO trades
        (id, agent_id, market_id, market_source, market_question, market_category,
         outcome, entry_price, shares, capital_used, confidence, reason, evidence,
         status, opened_at, asset_pair, trade_type, target_price, stop_price, entry_volume24h)
      VALUES
        (@id, @agent_id, @market_id, @market_source, @market_question, @market_category,
         @outcome, @entry_price, @shares, @capital_used, @confidence, @reason, @evidence,
         'open', @opened_at, @asset_pair, 'crypto_scalp', @target_price, @stop_price, @entry_volume24h)
    `).run({
      id,
      agent_id:        'crypto-scalper-1',
      market_id:       `${asset.pair}-${Date.now()}`,
      market_source:   'binance',
      market_question: `${side} ${asset.symbol} @ $${entryPrice}`,
      market_category: 'crypto',
      outcome:         side,
      entry_price:     entryPrice,
      shares,
      capital_used:    effectiveCapital,
      confidence,
      reason,
      evidence:        JSON.stringify(evidence ?? []),
      opened_at:       new Date().toISOString(),
      asset_pair:      asset.pair,
      target_price:    targetPrice,
      stop_price:      stopPrice,
      entry_volume24h: asset.volume24h ?? null,
    });
  });

  console.log(`[cryptoExecution] Paper ${side} ${asset.symbol} @ $${entryPrice} | target $${targetPrice} | stop $${stopPrice} | capital $${effectiveCapital.toFixed(2)}`);
  return { executed: true, tradeId: id, mode: 'paper', side, entryPrice, targetPrice, stopPrice, shares, capitalUsed: effectiveCapital };
}

export function closeCryptoTrade(tradeId, exitPrice, exitReason) {
  const trade = db.prepare('SELECT * FROM trades WHERE id = ?').get(tradeId);
  if (!trade) return null;

  // Net PnL: gross move minus taker fees (both sides) and slippage on both fills.
  // Same cost model the backtest uses, so live and validated results are comparable.
  const slippagePct = cryptoSlippagePct(trade.capital_used, trade.entry_volume24h ?? 0);
  const pnl = cryptoNetPnl({
    side: trade.outcome,
    entryPrice: trade.entry_price,
    exitPrice,
    shares: trade.shares,
    slippagePct,
  });
  const closedAt = new Date().toISOString();

  tx(() => {
    db.prepare(`
      UPDATE trades
      SET status = 'closed', exit_price = ?, pnl = ?, closed_at = ?,
          resolved_outcome = ?, exit_reason = ?
      WHERE id = ?
    `).run(exitPrice, pnl, closedAt, pnl >= 0 ? 'WIN' : 'LOSS', exitReason, tradeId);
  });

  console.log(`[cryptoExecution] Closed ${trade.outcome} ${trade.asset_pair ?? ''} @ $${exitPrice} | reason: ${exitReason} | PnL: $${pnl.toFixed(2)}`);
  return { ...trade, exitPrice, pnl, closedAt, exitReason };
}
