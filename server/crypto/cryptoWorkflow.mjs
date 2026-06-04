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

export { manageCryptoPositions };

function qualifyAssets(assets) {
  return assets.filter(a =>
    Math.abs(a.change1h) >= 0.3 &&
    a.volume24h >= 1_000_000
  );
}

export async function runCryptoTradingCycle() {
  const results = { scanned: 0, qualified: 0, debated: 0, executed: 0, tradeId: null };

  const assets = await getAssetContexts();
  results.scanned = assets.length;
  if (assets.length === 0) return results;

  const qualified = qualifyAssets(assets);
  results.qualified = qualified.length;
  if (qualified.length === 0) return results;

  const ctx = getDecisionContext('crypto', 0, 1);

  for (const asset of qualified) {
    const debate = await runCryptoDebate(asset, ctx.lessons);
    results.debated++;

    if (debate.action !== 'TRADE') {
      console.log(`[cryptoWorkflow] SKIP ${asset.symbol}: ${debate.skipReason}`);
      continue;
    }

    const side = debate.outcome;
    console.log(`[cryptoWorkflow] DEBATE: ${side} ${asset.symbol} @ $${asset.price} (conf ${(debate.confidence * 100).toFixed(0)}%)`);

    const kellySizing = kellySize(debate.confidence, 0.5);
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
      confidence:     debate.confidence,
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
      confidence:   debate.confidence,
      reason:       debate.arbiterSummary,
      evidence:     [
        ...(debate.bull?.evidence ?? []),
        `Kelly: ${(kellySizing.fraction * 100).toFixed(1)}%`,
        `RSI: ${asset.rsi14}`,
        `Trend: ${asset.trend}`,
      ],
    });

    results.executed++;
    results.tradeId = execution.tradeId;
    break;
  }

  return results;
}
