// rewardScanner.mjs — detects liquidity reward/incentive programs.
// Polymarket rewards API requires authentication — returns degraded if no key.
// No fabrication: if rewards data is unavailable, returns empty with explanation.

const POLYMARKET_REWARDS_ENDPOINT = 'https://gamma-api.polymarket.com/rewards/config';

/**
 * Attempt to fetch liquidity reward programs from Polymarket.
 * Returns empty + explanation if not available.
 */
export async function fetchRewardPrograms() {
  const apiKey = process.env.POLYMARKET_API_KEY;

  if (!apiKey) {
    return {
      ok: false,
      mode: 'degraded',
      rewards: [],
      reason: 'BLOCKED_BY_SECRET_OR_API: POLYMARKET_API_KEY not configured',
      note: 'Polymarket liquidity rewards data requires API authentication.',
    };
  }

  try {
    const res = await fetch(POLYMARKET_REWARDS_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      return {
        ok: false,
        mode: 'degraded',
        rewards: [],
        reason: `API returned HTTP ${res.status}`,
      };
    }

    const data = await res.json();
    const rewards = Array.isArray(data) ? data : data?.rewards ?? [];

    return {
      ok: true,
      mode: 'real',
      rewards: rewards.map((r) => ({
        marketId: r.conditionId ?? r.marketId ?? null,
        rewardType: r.type ?? r.rewardType ?? 'unknown',
        rewardRate: r.dailyRewardTokens ?? r.rate ?? null,
        token: r.token ?? 'USDC',
        active: r.active ?? true,
      })),
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      ok: false,
      mode: 'degraded',
      rewards: [],
      reason: err.message,
    };
  }
}
