// lpScanner.mjs — scans normalized markets to identify LP opportunities.
// Produces LPOpportunity objects with risk classification and reasons.
// NEVER executes anything. Recommendations only.

import { getAllMarkets } from '../dataProvider.mjs';
import { findWideSpreadMarkets } from './spreadScanner.mjs';

/**
 * @typedef {Object} LPOpportunity
 * @property {string} marketId
 * @property {string} title
 * @property {'polymarket'|'kalshi'} source
 * @property {number|null} spread
 * @property {number|null} liquidity
 * @property {number|null} volume24h
 * @property {number|null} estimatedEdge
 * @property {'LOW'|'MEDIUM'|'HIGH'|'AVOID'} riskLevel
 * @property {string} recommendation
 * @property {string} reason
 */

const SPREAD_THRESHOLD_LOW    = 0.02; // 2%
const SPREAD_THRESHOLD_MEDIUM = 0.06; // 6%
const SPREAD_THRESHOLD_HIGH   = 0.12; // 12%

const LIQUIDITY_ADEQUATE  = 50_000;  // $50k
const LIQUIDITY_HIGH      = 200_000; // $200k
const VOLUME_ADEQUATE     = 10_000;  // $10k 24h

/**
 * Classify risk level for an LP opportunity.
 */
function classifyRisk(snap) {
  const liquidity = snap.liquidity ?? 0;
  const volume24h = snap.volume24h ?? 0;
  const spread = snap.spread ?? 0;

  // Avoid: insufficient liquidity or no volume
  if (liquidity < 5_000 || volume24h < 500) {
    return {
      riskLevel: 'AVOID',
      recommendation: 'Avoid — insufficient liquidity or volume for LP',
      reason: `Liquidity $${liquidity?.toFixed(0) ?? 0} and 24h volume $${volume24h?.toFixed(0) ?? 0} are too low for safe LP positioning`,
    };
  }

  // Very wide spread with low volume = HIGH risk (thin, illiquid)
  if (spread > SPREAD_THRESHOLD_HIGH && volume24h < VOLUME_ADEQUATE) {
    return {
      riskLevel: 'HIGH',
      recommendation: 'High risk — wide spread but thin market',
      reason: `Spread ${(spread * 100).toFixed(1)}% is wide but 24h volume $${volume24h.toFixed(0)} is too low. High risk of adverse selection.`,
    };
  }

  // Good spread + good liquidity = LOW risk
  if (spread >= SPREAD_THRESHOLD_MEDIUM && liquidity >= LIQUIDITY_HIGH && volume24h >= VOLUME_ADEQUATE) {
    return {
      riskLevel: 'LOW',
      recommendation: 'Good LP opportunity — wide spread with deep liquidity',
      reason: `Spread ${(spread * 100).toFixed(1)}% with $${(liquidity / 1000).toFixed(0)}k liquidity and $${(volume24h / 1000).toFixed(0)}k 24h volume. Favorable conditions.`,
    };
  }

  // Moderate spread + adequate liquidity = MEDIUM
  if (spread >= SPREAD_THRESHOLD_LOW && liquidity >= LIQUIDITY_ADEQUATE) {
    return {
      riskLevel: 'MEDIUM',
      recommendation: 'Moderate LP opportunity — monitor closely',
      reason: `Spread ${(spread * 100).toFixed(1)}% with adequate liquidity. Viable but watch for resolution risk.`,
    };
  }

  // Tight spread = LOW edge
  return {
    riskLevel: 'HIGH',
    recommendation: 'Avoid — spread too narrow for LP edge',
    reason: `Spread ${(spread * 100).toFixed(1)}% is below the ${(SPREAD_THRESHOLD_LOW * 100).toFixed(0)}% minimum needed to cover fees and slippage.`,
  };
}

/**
 * Estimate LP edge from spread (simplified).
 * LP earns half the spread per round-trip, minus fees.
 */
function estimateEdge(spread, feePct = 0.002) {
  if (spread == null) return null;
  const grossEdge = spread / 2;
  const netEdge = grossEdge - feePct * 2;
  return Math.round(Math.max(0, netEdge) * 10000) / 10000;
}

/**
 * Scan all available markets and return LP opportunities, ranked by estimated edge.
 *
 * @param {{ limit?: number, minSpread?: number }} opts
 * @returns {LPOpportunity[]}
 */
export function scanLPOpportunities({ limit = 20, minSpread = 0 } = {}) {
  const markets = getAllMarkets();

  // Use wide-spread scanner as primary filter
  const candidates = findWideSpreadMarkets(markets, minSpread);

  const opportunities = candidates
    .map((snap) => {
      const { riskLevel, recommendation, reason } = classifyRisk(snap);
      const estimatedEdge = estimateEdge(snap.spread);

      return {
        marketId:      snap.marketId,
        title:         snap.title,
        source:        snap.source,
        spread:        snap.spread,
        liquidity:     snap.liquidity,
        volume24h:     snap.volume24h,
        yesPrice:      snap.yesPrice,
        noPrice:       snap.noPrice,
        endDate:       snap.endDate,
        category:      snap.category,
        estimatedEdge,
        riskLevel,
        recommendation,
        reason,
        scannedAt: new Date().toISOString(),
      };
    })
    .sort((a, b) => {
      // Sort: LOW risk first, then by estimatedEdge desc
      const riskOrder = { LOW: 0, MEDIUM: 1, HIGH: 2, AVOID: 3 };
      const riskDiff = (riskOrder[a.riskLevel] ?? 3) - (riskOrder[b.riskLevel] ?? 3);
      if (riskDiff !== 0) return riskDiff;
      return (b.estimatedEdge ?? 0) - (a.estimatedEdge ?? 0);
    })
    .slice(0, limit);

  return opportunities;
}
