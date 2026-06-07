// paperExecutionEngine.mjs — unified paper execution layer for Phase 6A engines.
// Wraps all paper fills with realistic simulation: slippage, fees, latency, partial fills.
//
// SAFETY CONTRACT:
//   isGlobalSafeMode() OR isSafeMode() → block ALL executions, no exceptions.
//   REAL_TRADING_ENABLED is NEVER set here. Paper only.

import db, { tx } from '../db/database.mjs';
import { nanoid } from '../utils.mjs';
import { isGlobalSafeMode } from '../risk/globalRiskEngine.mjs';
import { isSafeMode } from '../memory/reconciliationEngine.mjs';
import { reserveCapital, settleTradeCapital } from './treasury.mjs';
import { closeCryptoTrade } from '../crypto/cryptoExecution.mjs';
import { computeCryptoTargets } from '../crypto/cryptoMath.mjs';
import { cryptoSlippagePct, getCryptoFeePct, applyCryptoEntrySlippage } from './costs.mjs';
import { logEvent, CATEGORY, SEVERITY } from '../observability/eventTimeline.mjs';

const TRAINING_MODE = ['1', 'true', 'yes'].includes((process.env.TRAINING_MODE ?? '').toLowerCase());

// ── Simulation helpers ────────────────────────────────────────────────────────

// Realistic exchange latency: 10-80ms
function simulateLatencyMs() {
  return 10 + Math.floor(Math.random() * 70);
}

async function applyLatency() {
  await new Promise(r => setTimeout(r, simulateLatencyMs()));
}

// Partial fill: 85% chance of full fill, 15% chance 80-100% of requested size
function applyPartialFill(capitalUsed) {
  if (Math.random() > 0.15) return capitalUsed;
  const fillPct = 0.80 + Math.random() * 0.20;
  return Math.round(capitalUsed * fillPct * 100) / 100;
}

// ── Open a crypto paper position ──────────────────────────────────────────────

/**
 * @param {{
 *   asset: { symbol: string, pair: string, price: number, volume24h: number },
 *   side: 'LONG'|'SHORT',
 *   confidence: number,          // 0–1
 *   capitalUsed: number,         // USD, before partial fill
 *   reason: string,
 *   evidence?: string[],
 *   agentId: string,
 *   tradeType?: string,          // default 'fast_scalp'
 *   targetPct?: number,          // TP % from entry, e.g. 0.004 = 0.4%
 *   stopPct?: number,            // SL % from entry, e.g. 0.002 = 0.2%
 *   timeoutHours?: number,       // max hold time
 * }} opts
 */
export async function openCryptoPosition(opts) {
  const {
    asset, side, confidence, capitalUsed,
    reason, evidence = [],
    agentId, tradeType = 'fast_scalp',
    targetPct, stopPct,
    timeoutHours = 4,
  } = opts;

  // ── Safety gates — NEVER bypass ──
  if (isGlobalSafeMode()) {
    logEvent({ category: CATEGORY.EXECUTION, severity: SEVERITY.WARNING, subsystem: agentId,
      reason: `BLOCKED (global safe mode): ${side} ${asset.symbol}`, metadata: { asset: asset.symbol } });
    return { executed: false, reason: 'global_safe_mode', blocked: true };
  }
  if (isSafeMode()) {
    logEvent({ category: CATEGORY.EXECUTION, severity: SEVERITY.WARNING, subsystem: agentId,
      reason: `BLOCKED (reconciliation safe mode): ${side} ${asset.symbol}`, metadata: { asset: asset.symbol } });
    return { executed: false, reason: 'reconciliation_safe_mode', blocked: true };
  }

  // ── Simulate latency ──
  await applyLatency();

  // ── Partial fill ──
  const filledCapital = applyPartialFill(capitalUsed);

  // ── Reserve capital ──
  const reservation = reserveCapital(filledCapital);
  if (!reservation.ok) {
    return { executed: false, reason: reservation.reason };
  }

  // ── Realistic fill price with slippage ──
  const slippagePct = cryptoSlippagePct(filledCapital, asset.volume24h ?? 0);
  const effectiveEntryPrice = applyCryptoEntrySlippage(side, asset.price, slippagePct);
  const shares = Math.floor((filledCapital / effectiveEntryPrice) * 10000) / 10000;
  const effectiveCapital = Math.round(shares * effectiveEntryPrice * 100) / 100;

  // ── TP / SL prices ──
  let tp, sl;
  if (targetPct !== undefined && stopPct !== undefined) {
    tp = side === 'LONG'
      ? Math.round(effectiveEntryPrice * (1 + targetPct) * 100000) / 100000
      : Math.round(effectiveEntryPrice * (1 - targetPct) * 100000) / 100000;
    sl = side === 'LONG'
      ? Math.round(effectiveEntryPrice * (1 - stopPct) * 100000) / 100000
      : Math.round(effectiveEntryPrice * (1 + stopPct) * 100000) / 100000;
  } else {
    const targets = computeCryptoTargets(side, effectiveEntryPrice);
    tp = targets.targetPrice;
    sl = targets.stopPrice;
  }

  // ── Timeout: convert hours → days_to_close ──
  const daysToClose = Math.ceil(timeoutHours / 24);

  const id = `${tradeType}-${nanoid()}`;

  tx(() => {
    db.prepare(`
      INSERT INTO trades
        (id, agent_id, market_id, market_source, market_question, market_category,
         outcome, entry_price, shares, capital_used, confidence, reason, evidence,
         status, opened_at, asset_pair, trade_type, target_price, stop_price,
         entry_volume24h, days_to_close)
      VALUES
        (@id, @agent_id, @market_id, @market_source, @market_question, @market_category,
         @outcome, @entry_price, @shares, @capital_used, @confidence, @reason, @evidence,
         'open', @opened_at, @asset_pair, @trade_type, @target_price, @stop_price,
         @entry_volume24h, @days_to_close)
    `).run({
      id,
      agent_id:        agentId,
      market_id:       `${asset.pair}-${Date.now()}`,
      market_source:   'binance',
      market_question: `${side} ${asset.symbol} @ $${asset.price.toFixed(2)} [${tradeType}]`,
      market_category: 'crypto',
      outcome:         side,
      entry_price:     effectiveEntryPrice,
      shares,
      capital_used:    effectiveCapital,
      confidence,
      reason,
      evidence:        JSON.stringify(evidence),
      opened_at:       new Date().toISOString(),
      asset_pair:      asset.pair,
      trade_type:      tradeType,
      target_price:    tp,
      stop_price:      sl,
      entry_volume24h: asset.volume24h ?? null,
      days_to_close:   daysToClose,
    });
  });

  const msg = `OPEN ${side} ${asset.symbol} @ $${effectiveEntryPrice.toFixed(2)} → TP $${tp.toFixed ? tp.toFixed(2) : tp} | SL $${sl.toFixed ? sl.toFixed(2) : sl} | capital $${effectiveCapital.toFixed(2)}`;
  logEvent({ category: CATEGORY.EXECUTION, severity: SEVERITY.INFO, subsystem: agentId, reason: msg,
    metadata: { tradeId: id, confidence, asset: asset.symbol, side, tradeType, type: 'open' } });

  if (TRAINING_MODE) {
    console.log(`[paperExec][TRAINING] ${agentId}: ${msg} | conf=${(confidence * 100).toFixed(0)}% | slippage=${(slippagePct * 100).toFixed(2)}%`);
  }

  return {
    executed: true, tradeId: id, mode: 'paper',
    side, entryPrice: effectiveEntryPrice,
    targetPrice: tp, stopPrice: sl,
    shares, capitalUsed: effectiveCapital,
    slippagePct,
  };
}

// ── Close a crypto paper position ─────────────────────────────────────────────

/**
 * @param {string} tradeId
 * @param {number} currentPrice
 * @param {string} exitReason  — 'take_profit' | 'stop_loss' | 'timeout' | 'confidence_collapse' | 'momentum_reversal' | 'risk_close'
 * @param {string} [agentId]
 */
export async function closeCryptoPosition(tradeId, currentPrice, exitReason, agentId) {
  await applyLatency();

  const trade = db.prepare('SELECT * FROM trades WHERE id = ?').get(tradeId);
  if (!trade) return null;

  const closedTrade = closeCryptoTrade(tradeId, currentPrice, exitReason);
  if (!closedTrade) return null;

  settleTradeCapital(trade.capital_used, closedTrade.pnl ?? 0);

  const won = (closedTrade.pnl ?? 0) > 0;
  const exitLabel = {
    take_profit:        'TP HIT',
    stop_loss:          'SL HIT',
    timeout:            'TIMEOUT CLOSE',
    confidence_collapse:'CONFIDENCE DROP EXIT',
    momentum_reversal:  'MOMENTUM REVERSAL EXIT',
    risk_close:         'RISK CLOSE',
  }[exitReason] ?? exitReason.toUpperCase();

  logEvent({
    category: won ? CATEGORY.EXECUTION : CATEGORY.RISK,
    severity: won ? SEVERITY.INFO : SEVERITY.WARNING,
    subsystem: agentId ?? trade.agent_id,
    reason: `${exitLabel}: ${trade.outcome} ${trade.asset_pair ?? ''} @ $${currentPrice.toFixed(2)} | PnL $${(closedTrade.pnl ?? 0).toFixed(2)}`,
    metadata: { tradeId, pnl: closedTrade.pnl, exitReason, asset: trade.asset_pair, won, type: 'close' },
  });

  if (TRAINING_MODE) {
    console.log(`[paperExec][TRAINING] ${agentId ?? trade.agent_id}: ${exitLabel} ${trade.outcome} ${trade.asset_pair ?? ''} @ $${currentPrice.toFixed(2)} | PnL=$${(closedTrade.pnl ?? 0).toFixed(2)}`);
  }

  return closedTrade;
}

// ── Check if an open position already exists for a given asset + engine ───────

export function hasOpenPosition(assetPair, tradeType) {
  const row = db.prepare(`
    SELECT id FROM trades
    WHERE status = 'open' AND asset_pair = ? AND trade_type = ?
    LIMIT 1
  `).get(assetPair, tradeType);
  return row != null;
}

// ── Get all open positions for a given trade type ─────────────────────────────

export function getOpenPositions(tradeType) {
  return db.prepare(`
    SELECT * FROM trades
    WHERE status = 'open' AND trade_type = ?
    ORDER BY opened_at ASC
  `).all(tradeType);
}
