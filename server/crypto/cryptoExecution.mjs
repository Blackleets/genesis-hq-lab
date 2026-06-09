// cryptoExecution.mjs — paper fill for crypto scalp trades.
// Saves a trade to the DB with target_price, stop_price, trade_type=crypto_scalp.

import db, { tx } from '../db/database.mjs';
import { nanoid } from '../utils.mjs';
import {
  cryptoNetPnl,
  cryptoSlippagePct,
  cryptoFuturesNetPnl,
  cryptoFuturesSlippagePct,
  estimateFundingFeeUsd,
} from '../trading/costs.mjs';
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
  const closedAt = new Date().toISOString();
  const openedMs = new Date(trade.opened_at).getTime();
  const closedMs = new Date(closedAt).getTime();
  const holdingHours = Number.isFinite(openedMs) && Number.isFinite(closedMs)
    ? Math.max(0, (closedMs - openedMs) / 3_600_000)
    : 0;
  const instrumentType = trade.instrument_type ?? 'spot';
  const notionalUsd = trade.notional_usd ?? Math.round((trade.entry_price ?? 0) * (trade.shares ?? 0) * 100) / 100;
  const slippagePct = instrumentType === 'futures'
    ? cryptoFuturesSlippagePct(notionalUsd, trade.entry_volume24h ?? 0)
    : cryptoSlippagePct(trade.capital_used, trade.entry_volume24h ?? 0);
  const fundingPaid = instrumentType === 'futures'
    ? estimateFundingFeeUsd({ notionalUsd, fundingRate: trade.funding_rate ?? undefined, holdingHours })
    : 0;
  const pnl = instrumentType === 'futures'
    ? cryptoFuturesNetPnl({
      side: trade.outcome,
      entryPrice: trade.entry_price,
      exitPrice,
      shares: trade.shares,
      slippagePct,
      fundingFeeUsd: fundingPaid,
    })
    : cryptoNetPnl({
      side: trade.outcome,
      entryPrice: trade.entry_price,
      exitPrice,
      shares: trade.shares,
      slippagePct,
    });

  tx(() => {
    db.prepare(`
      UPDATE trades
      SET status = 'closed', exit_price = ?, pnl = ?, closed_at = ?,
          resolved_outcome = ?, exit_reason = ?, funding_paid = ?
      WHERE id = ?
    `).run(exitPrice, pnl, closedAt, pnl >= 0 ? 'WIN' : 'LOSS', exitReason, fundingPaid, tradeId);
  });

  console.log(`[cryptoExecution] Closed ${trade.outcome} ${trade.asset_pair ?? ''} @ $${exitPrice} | reason: ${exitReason} | PnL: $${pnl.toFixed(2)}`);
  return { ...trade, exitPrice, pnl, closedAt, exitReason, fundingPaid };
}
