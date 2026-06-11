// lpRecommendations.mjs — assembles final LP recommendations with reward overlay.
// Merges spread scan + reward data into actionable (non-executable) recommendations.

import { scanLPOpportunities } from './lpScanner.mjs';
import { fetchRewardPrograms } from './rewardScanner.mjs';
import { logEvent, SEVERITY } from '../../observability/eventTimeline.mjs';

/**
 * Get full LP recommendations including any reward overlays.
 *
 * @param {{ limit?: number }} opts
 */
export async function getLPRecommendations({ limit = 15 } = {}) {
  const [opportunities, rewardResult] = await Promise.allSettled([
    Promise.resolve(scanLPOpportunities({ limit })),
    fetchRewardPrograms(),
  ]);

  const ops = opportunities.status === 'fulfilled' ? opportunities.value : [];
  const rewards = rewardResult.status === 'fulfilled' && rewardResult.value.ok
    ? rewardResult.value.rewards
    : [];

  // Build reward lookup by marketId
  const rewardMap = new Map(rewards.map((r) => [r.marketId, r]));

  // Overlay reward info on opportunities
  const enriched = ops.map((op) => {
    const reward = rewardMap.get(op.marketId);
    return {
      ...op,
      hasRewardProgram: !!reward,
      rewardInfo: reward ?? null,
    };
  });

  logEvent(
    'PREDICTION', SEVERITY.INFO, 'lpRecommendations',
    'PREDICTION_OPPORTUNITY_FOUND',
    { count: enriched.length, withRewards: rewards.length }
  );

  return {
    ok: true,
    disclaimer: 'These are analytical recommendations only. No LP positions are executed automatically. Past spread patterns do not guarantee future LP profitability.',
    opportunities: enriched,
    rewardProgramsMode: rewardResult.status === 'fulfilled' ? rewardResult.value.mode : 'degraded',
    rewardProgramsError: (rewardResult.status === 'fulfilled' && !rewardResult.value.ok)
      ? rewardResult.value.reason
      : null,
    totalOpportunities: enriched.length,
    scannedAt: new Date().toISOString(),
  };
}
