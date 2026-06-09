// eventAlphaEngine.mjs — EVENT_ALPHA engine. Prediction market EV hunting.
//
// Markets: Kalshi + Polymarket
// Logic:
//   1. Scan active markets
//   2. Estimate Genesis probability (from debate/signals)
//   3. Compare vs market implied probability
//   4. Trade only when Expected Value > EV_THRESHOLD (e.g. 8%)
//
// EV formula:
//   EV = P_genesis × (1 - entryPrice) - (1 - P_genesis) × entryPrice
//   where P_genesis is estimated win probability (0-1)
//
// Filters:
//   - Min volume: $5,000
//   - Max days to close: 45
//   - Price range: 0.10 – 0.90 (not near certain)
//   - EV > EV_THRESHOLD
//   - Passes existing veto system
//
// This engine reuses the existing debate system for probability estimation.
// It does NOT bypass confidence engine or veto checks.

import { scanMarkets } from '../marketScanner.mjs';
import { runDebate } from '../trading/debateRoom.mjs';
import { checkVeto, logVeto } from '../memory/mistakePrevention.mjs';
import { getDecisionContext } from '../memory/learningEngine.mjs';
import { executeTrade } from '../trading/execution.mjs';
import { kellySize, reserveCapital } from '../trading/treasury.mjs';
import { preTradeCheck } from '../trading/riskManager.mjs';
import { isGlobalSafeMode, getGlobalRiskDiagnostics } from '../risk/globalRiskEngine.mjs';
import { isSafeMode } from '../memory/reconciliationEngine.mjs';
import { logEvent, CATEGORY, SEVERITY } from '../observability/eventTimeline.mjs';
import { isDeptActive } from '../command/orgState.mjs';

const AGENT_ID = 'event-alpha-1';
const ENABLED = !['0', 'false', 'no', 'off'].includes((process.env.EVENT_ALPHA_ENABLED ?? 'true').toLowerCase());

// Training-mode gates: 4% EV is a realistic positive edge for prediction markets
// (8% rejected nearly everything); genesisProb ≥ 0.62 still requires the model to
// favour the outcome. See trainingTuning.test.mjs. Risk/safe-mode gates unchanged.
const EV_THRESHOLD    = parseFloat(process.env.EVENT_EV_THRESHOLD ?? '0.04');  // 4% min EV
const MIN_CONFIDENCE  = parseFloat(process.env.EVENT_MIN_CONF ?? '0.62');
const MAX_TRADES_PER_CYCLE = parseInt(process.env.EVENT_MAX_TRADES ?? '2', 10);

const TRAINING_MODE = ['1', 'true', 'yes'].includes((process.env.TRAINING_MODE ?? '').toLowerCase());

/** Effective event-alpha engine config (used by diagnostics + tuning tests). */
export function eventConfig() {
  return { enabled: ENABLED, evThreshold: EV_THRESHOLD, minConfidence: MIN_CONFIDENCE, maxTradesPerCycle: MAX_TRADES_PER_CYCLE };
}

// ── EV calculation ────────────────────────────────────────────────────────────

/**
 * Compute expected value for a position.
 * @param {number} genesisProb — estimated win probability from Genesis
 * @param {number} entryPrice  — market price (0-1)
 * @returns {number} EV in cents per dollar risked (e.g. 0.12 = +12%)
 */
export function computeEV(genesisProb, entryPrice) {
  if (entryPrice <= 0 || entryPrice >= 1) return -1;
  const winPayoff  = 1 - entryPrice;   // net gain if won
  const lossCost   = entryPrice;       // net loss if lost
  return (genesisProb * winPayoff) - ((1 - genesisProb) * lossCost);
}

/**
 * Compute the EV edge: difference between Genesis probability and market implied.
 * Positive = Genesis thinks market is underpriced (opportunity).
 */
export function computeEdge(genesisProb, marketProb) {
  return genesisProb - marketProb;
}

// ── Main cycle ────────────────────────────────────────────────────────────────

/**
 * Run one event alpha cycle. Called every 30s (MID loop).
 * Returns { scanned, qualified, evPositive, executed, rejected }
 */
export async function runEventAlphaCycle() {
  const result = { scanned: 0, qualified: 0, evPositive: 0, executed: 0, rejected: 0, blocked: false };
  if (!ENABLED) return result;

  // Safety gates
  if (isGlobalSafeMode() || isSafeMode()) {
    logEvent({ category: CATEGORY.EXECUTION, severity: SEVERITY.WARNING, subsystem: AGENT_ID, reason: 'EVENT ALPHA BLOCKED — safe mode' });
    result.blocked = true;
    return result;
  }

  if (!isDeptActive('prediction_markets')) {
    return result;
  }

  const risk = getGlobalRiskDiagnostics();
  if (risk.band === 'CRITICAL') {
    return result;
  }

  // Scan markets
  let markets;
  try {
    markets = await scanMarkets();
  } catch (err) {
    console.warn('[eventAlpha] Market scan error:', err.message);
    return result;
  }

  result.scanned = markets.length;

  // Qualify: liquidity + price range + time horizon
  const qualified = markets.filter(m =>
    m.volumeTotal >= 5000 &&
    m.volume24h   >= 200  &&
    m.yesPrice    >= 0.10 &&
    m.yesPrice    <= 0.90 &&
    m.daysToClose >= 1    &&
    m.daysToClose <= 45
  );

  result.qualified = qualified.length;

  if (qualified.length === 0) {
    logEvent({ category: CATEGORY.SCAN, severity: SEVERITY.INFO, subsystem: AGENT_ID,
      reason: `ANALYZING KALSHI/POLYMARKET: ${markets.length} scanned, none qualify` });
    return result;
  }

  logEvent({ category: CATEGORY.SCAN, severity: SEVERITY.INFO, subsystem: AGENT_ID,
    reason: `ANALYZING KALSHI/POLYMARKET: ${result.scanned} scanned, ${result.qualified} qualify for EV check` });

  let tradesThisCycle = 0;

  for (const market of qualified) {
    if (tradesThisCycle >= MAX_TRADES_PER_CYCLE) break;

    // Veto check
    const proposal = {
      marketId: market.id, marketSource: market.source,
      marketQuestion: market.question,
      marketCategory: market.category ?? 'general',
      outcome: 'YES', yesPrice: market.yesPrice, noPrice: market.noPrice,
      volumeTotal: market.volumeTotal, daysToClose: market.daysToClose,
      confidence: 0.65, entryPrice: market.yesPrice,
      agentId: AGENT_ID,
    };

    const veto = checkVeto(proposal);
    if (veto.vetoed) {
      logVeto(proposal, veto);
      result.rejected++;
      continue;
    }

    if (TRAINING_MODE) {
      console.log(`[eventAlpha][TRAINING] Evaluating: "${market.question?.slice(0, 60)}" | price=${market.yesPrice}`);
    }

    // Get debate result (Genesis probability estimate)
    let debateResult;
    try {
      const ctx = getDecisionContext(market.category ?? 'general', market.yesPrice - 0.1, market.yesPrice + 0.1);
      debateResult = await runDebate(market, ctx.lessons, ctx.rules, []);
    } catch (err) {
      console.warn(`[eventAlpha] Debate failed for ${market.question?.slice(0, 40)}:`, err.message);
      result.rejected++;
      continue;
    }

    if (debateResult.action === 'SKIP') {
      result.rejected++;
      continue;
    }

    // Genesis estimated probability
    const betOnYes = debateResult.outcome === 'YES';
    const genesisProb = debateResult.confidence;
    const marketProb  = betOnYes ? market.yesPrice : market.noPrice;
    const entryPrice  = marketProb;

    const ev = computeEV(genesisProb, entryPrice);
    const edge = computeEdge(genesisProb, marketProb);

    logEvent({ category: CATEGORY.SCAN, severity: SEVERITY.INFO, subsystem: AGENT_ID,
      reason: `EV CHECK: ${market.question?.slice(0, 50)} | Genesis=${(genesisProb*100).toFixed(0)}% vs Market=${(marketProb*100).toFixed(0)}% | EV=${(ev*100).toFixed(1)}%`,
      metadata: { ev, edge, genesisProb, marketProb, market: market.question } });

    if (ev < EV_THRESHOLD) {
      result.rejected++;
      continue;
    }

    if (genesisProb < MIN_CONFIDENCE) {
      result.rejected++;
      continue;
    }

    result.evPositive++;

    // Size and execute
    const kellySizing = kellySize(genesisProb, entryPrice);
    if (kellySizing.skip) {
      result.rejected++;
      continue;
    }

    const riskCheck = preTradeCheck({ ...proposal, confidence: genesisProb, capitalUsed: kellySizing.dollarSize });
    if (!riskCheck.approved) {
      result.rejected++;
      continue;
    }

    const reservation = reserveCapital(kellySizing.dollarSize);
    if (!reservation.ok) {
      result.rejected++;
      continue;
    }

    const execution = await executeTrade({
      agentId: AGENT_ID,
      marketId: market.id, marketSource: market.source,
      marketQuestion: market.question,
      marketCategory: market.category ?? 'general',
      outcome: debateResult.outcome,
      entryPrice,
      shares: kellySizing.shares,
      capitalUsed: kellySizing.dollarSize,
      confidence: genesisProb,
      volume24hUsd: market.volume24h ?? 0,
      reason: `EV=${(ev*100).toFixed(1)}% | Genesis ${(genesisProb*100).toFixed(0)}% vs Market ${(marketProb*100).toFixed(0)}% | edge=${(edge*100).toFixed(1)}%`,
      evidence: [
        `EV: ${(ev*100).toFixed(1)}%`,
        `Genesis prob: ${(genesisProb*100).toFixed(0)}%`,
        `Market prob:  ${(marketProb*100).toFixed(0)}%`,
        `Edge: ${(edge*100).toFixed(1)}%`,
        ...(debateResult.bull?.evidence ?? []),
      ],
      openedAt: new Date().toISOString(),
      daysToClose: market.daysToClose,
    });

    if (execution.executed) {
      result.executed++;
      tradesThisCycle++;
      logEvent({ category: CATEGORY.EXECUTION, severity: SEVERITY.INFO, subsystem: AGENT_ID,
        reason: `OPEN EVENT ALPHA: ${debateResult.outcome} "${market.question?.slice(0, 50)}" | EV=${(ev*100).toFixed(1)}%`,
        metadata: { tradeId: execution.tradeId, ev, genesisProb, marketProb } });
      console.log(`[eventAlpha] ✓ ${debateResult.outcome} "${market.question?.slice(0, 50)}" | EV ${(ev*100).toFixed(1)}% | $${kellySizing.dollarSize.toFixed(2)}`);
    }
  }

  return result;
}
