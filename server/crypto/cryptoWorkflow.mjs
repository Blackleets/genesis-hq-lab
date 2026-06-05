// cryptoWorkflow.mjs — orchestrates the 1-minute crypto scalping cycle.
// SCAN → QUALIFY → DEBATE → SIZE → EXECUTE
// Reuses the shared treasury (same $10k, same risk limits) as Polymarket.

import { getAssetContexts } from './priceFeeder.mjs';
import { runCryptoDebate }  from './cryptoDebate.mjs';
import { executeCryptoPaperTrade } from './cryptoExecution.mjs';
import { manageCryptoPositions } from './positionManager.mjs';
import { kellySize, reserveCapital } from '../trading/treasury.mjs';
import { preTradeCheck } from '../trading/riskManager.mjs';
import { getDecisionContext } from '../memory/learningEngine.mjs';
import { evaluateSignal } from './signal.mjs';
import { getParams } from './strategyParams.mjs';
import { dailyLossHalt, assetCooldown } from './cryptoRisk.mjs';

export { manageCryptoPositions };

export async function runCryptoTradingCycle() {
  const results = { scanned: 0, qualified: 0, debated: 0, executed: 0, tradeId: null, halted: false };

  // Circuit breaker: stop opening new crypto positions once the daily loss cap is hit.
  const halt = dailyLossHalt();
  if (halt.halt) {
    console.log(`[cryptoWorkflow] 🛑 ${halt.reason} — no new entries today`);
    results.halted = true;
    return results;
  }

  const assets = await getAssetContexts();
  results.scanned = assets.length;
  if (assets.length === 0) {
    console.log('[cryptoWorkflow] No assets from Binance');
    return results;
  }

  // Primary edge: confluence signal decides direction. Debate is confirmation only.
  const params = getParams();
  const candidates = assets
    .map(a => ({ asset: a, signal: evaluateSignal(a, params) }))
    .filter(c => c.signal.action === 'TRADE')
    .sort((a, b) => b.signal.score - a.signal.score); // strongest setup first

  results.qualified = candidates.length;
  if (candidates.length === 0) {
    const summary = assets.map(a => `${a.symbol}:${a.change1h > 0 ? '+' : ''}${a.change1h}%`).join(' ');
    console.log(`[cryptoWorkflow] No signal — moves: ${summary}`);
    return results;
  }

  const ctx = getDecisionContext('crypto', 0, 1);

  for (const { asset, signal } of candidates) {
    const side = signal.side;

    // Per-asset circuit breaker: skip an asset that's cooling down after a loss.
    const cooldown = assetCooldown(asset.pair);
    if (cooldown.cooling) {
      console.log(`[cryptoWorkflow] SKIP ${asset.symbol}: ${cooldown.reason}`);
      continue;
    }

    const debate = await runCryptoDebate(asset, ctx.lessons, side);
    results.debated++;

    if (debate.action !== 'TRADE') {
      console.log(`[cryptoWorkflow] SKIP ${asset.symbol} (${side}): ${debate.skipReason}`);
      continue;
    }

    // Confidence: debate (Claude) is primary, but never below the signal's prior.
    const confidence = Math.max(debate.confidence ?? 0, signal.score);
    console.log(`[cryptoWorkflow] SIGNAL+DEBATE: ${side} ${asset.symbol} @ $${asset.price} (conf ${(confidence * 100).toFixed(0)}%, score ${signal.score})`);

    const kellySizing = kellySize(confidence, 0.5);
    if (kellySizing.skip) {
      console.log(`[cryptoWorkflow] SIZE skip: ${kellySizing.reason}`);
      continue;
    }

    const proposal = {
      marketId:       `${asset.pair}-${Date.now()}`,
      marketSource:   'binance',
      marketQuestion: `${side} ${asset.symbol} @ $${asset.price}`,
      marketCategory: 'crypto',
      outcome:        side,
      yesPrice:       0.5,
      noPrice:        0.5,
      volumeTotal:    asset.volume24h,
      daysToClose:    1,
      confidence:     confidence,
      entryPrice:     asset.price,
      capitalUsed:    kellySizing.dollarSize,
      agentId:        'crypto-scalper-1',
    };

    const riskCheck = preTradeCheck(proposal);
    if (!riskCheck.approved) {
      console.log(`[cryptoWorkflow] RISK BLOCK: ${riskCheck.errors[0]}`);
      continue;
    }

    const reservation = reserveCapital(kellySizing.dollarSize);
    if (!reservation.ok) {
      console.log(`[cryptoWorkflow] CAPITAL: ${reservation.reason}`);
      continue;
    }

    const execution = executeCryptoPaperTrade({
      asset,
      side,
      entryPrice:   asset.price,
      capitalUsed:  kellySizing.dollarSize,
      confidence:   confidence,
      reason:       debate.arbiterSummary,
      evidence:     [
        ...signal.reasons,
        ...(debate.bull?.evidence ?? []),
        `Signal score: ${signal.score}`,
        `Kelly: ${(kellySizing.fraction * 100).toFixed(1)}%`,
      ],
    });

    results.executed++;
    results.tradeId = execution.tradeId;
    break;
  }

  return results;
}
