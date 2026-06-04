// cryptoExecution.mjs — paper fill for crypto scalp trades.
// Saves a trade to the DB with target_price, stop_price, trade_type=crypto_scalp.

import db, { tx } from '../db/database.mjs';
import { nanoid } from '../utils.mjs';

const TARGET_PCT = 0.015;
const STOP_PCT   = 0.0075;

export function computeCryptoTargets(side, entryPrice) {
  if (side === 'LONG') {
    return {
      targetPrice: Math.round(entryPrice * (1 + TARGET_PCT) * 100) / 100,
      stopPrice:   Math.round(entryPrice * (1 - STOP_PCT)   * 100) / 100,
    };
  }
  return {
    targetPrice: Math.round(entryPrice * (1 - TARGET_PCT) * 100) / 100,
    stopPrice:   Math.round(entryPrice * (1 + STOP_PCT)   * 100) / 100,
  };
}

export function computeCryptoPnl(side, entryPrice, exitPrice, shares) {
  if (side === 'LONG') return Math.round((exitPrice - entryPrice) * shares * 1000) / 1000;
  return Math.round((entryPrice - exitPrice) * shares * 1000) / 1000;
}

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
         status, opened_at, asset_pair, trade_type, target_price, stop_price)
      VALUES
        (@id, @agent_id, @market_id, @market_source, @market_question, @market_category,
         @outcome, @entry_price, @shares, @capital_used, @confidence, @reason, @evidence,
         'open', @opened_at, @asset_pair, 'crypto_scalp', @target_price, @stop_price)
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
    });
  });

  console.log(`[cryptoExecution] Paper ${side} ${asset.symbol} @ $${entryPrice} | target $${targetPrice} | stop $${stopPrice} | capital $${effectiveCapital.toFixed(2)}`);
  return { executed: true, tradeId: id, mode: 'paper', side, entryPrice, targetPrice, stopPrice, shares, capitalUsed: effectiveCapital };
}

export function closeCryptoTrade(tradeId, exitPrice, exitReason) {
  const trade = db.prepare('SELECT * FROM trades WHERE id = ?').get(tradeId);
  if (!trade) return null;

  const pnl = computeCryptoPnl(trade.outcome, trade.entry_price, exitPrice, trade.shares);
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
