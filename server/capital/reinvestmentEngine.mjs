// reinvestmentEngine.mjs — Automated capital allocation per Genesis Constitution
// After every profitable trade, distribute PnL across 5 buckets:
//   - 40% reserve (emergency liquidity)
//   - 25% agent upgrade (training, skills)
//   - 15% experiments (new strategies)
//   - 10% expansion (market coverage)
//   - 10% liquidity (trading capital)

import db, { tx } from '../db/database.mjs';
import { getTreasury } from '../trading/treasury.mjs';

// REINVESTMENT fractions MUST match Genesis Constitution
export const REINVESTMENT = {
  reserve:      0.40,  // emergency buffer
  agentUpgrade: 0.25,  // agent training & skill development
  experiments:  0.15,  // new strategy research
  expansion:    0.10,  // geographic/market expansion
  liquidity:    0.10,  // available trading capital
};

// Validate the fractions sum to 1.0
const sum = Object.values(REINVESTMENT).reduce((a, b) => a + b, 0);
if (Math.abs(sum - 1.0) > 0.001) {
  throw new Error(`REINVESTMENT fractions must sum to 1.0, got ${sum}`);
}

/**
 * Compute reinvestment allocation for a profitable trade.
 * Returns distribution across 5 buckets based on PnL.
 */
export function computeReinvestment(pnl) {
  if (pnl <= 0) {
    return {
      pnl,
      isProfit: false,
      allocation: {
        reserve: 0,
        agentUpgrade: 0,
        experiments: 0,
        expansion: 0,
        liquidity: 0,
      },
      details: 'Loss or breakeven — no reinvestment',
    };
  }

  return {
    pnl,
    isProfit: true,
    allocation: {
      reserve:      pnl * REINVESTMENT.reserve,
      agentUpgrade: pnl * REINVESTMENT.agentUpgrade,
      experiments:  pnl * REINVESTMENT.experiments,
      expansion:    pnl * REINVESTMENT.expansion,
      liquidity:    pnl * REINVESTMENT.liquidity,
    },
    details: `Profit $${pnl.toFixed(2)} distributed across 5 buckets per Constitution`,
  };
}

/**
 * Apply reinvestment to capital buckets.
 * Called after trade close; updates capital_history with bucket breakdown.
 */
export function applyReinvestment(pnl, notes = '') {
  if (pnl <= 0) {
    return { applied: false, reason: 'no profit to reinvest' };
  }

  const allocation = computeReinvestment(pnl);
  const treasury = getTreasury();

  try {
    tx(() => {
      // Get latest values from capital_history
      const latest = db.prepare('SELECT * FROM capital_history ORDER BY rowid DESC LIMIT 1').get();

      // Insert capital history record with bucket updates
      db.prepare(`
        INSERT INTO capital_history
          (total, available, in_trades, bucket_reserve, bucket_upgrade,
           bucket_exp, bucket_expand, bucket_liquid, note, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        (latest?.total ?? 0) + pnl,                                  // total increases by PnL
        (latest?.available ?? 0) + allocation.allocation.liquidity,  // available increases by liquidity portion
        latest?.in_trades ?? 0,
        (latest?.bucket_reserve ?? 0) + allocation.allocation.reserve,
        (latest?.bucket_upgrade ?? 0) + allocation.allocation.agentUpgrade,
        (latest?.bucket_exp ?? 0) + allocation.allocation.experiments,
        (latest?.bucket_expand ?? 0) + allocation.allocation.expansion,
        (latest?.bucket_liquid ?? 0) + allocation.allocation.liquidity,
        `[reinvest] ${notes} | reserve:$${allocation.allocation.reserve.toFixed(2)} upgrade:$${allocation.allocation.agentUpgrade.toFixed(2)} exp:$${allocation.allocation.experiments.toFixed(2)} expand:$${allocation.allocation.expansion.toFixed(2)} liquid:$${allocation.allocation.liquidity.toFixed(2)}`
      );
    });

    console.log(`[reinvest] Applied $${pnl.toFixed(2)} across buckets:`, allocation.allocation);
    return { applied: true, allocation: allocation.allocation };
  } catch (err) {
    console.error('[reinvest] Failed to apply reinvestment:', err.message);
    throw err;
  }
}

/**
 * Get current bucket state
 */
export function getBuckets() {
  const latest = db.prepare('SELECT * FROM capital_history ORDER BY rowid DESC LIMIT 1').get();
  if (!latest) return {
    total: 0,
    reserve: 0,
    agentUpgrade: 0,
    experiments: 0,
    expansion: 0,
    liquidity: 0,
  };

  return {
    total: latest.total ?? 0,
    reserve: latest.bucket_reserve ?? 0,
    agentUpgrade: latest.bucket_upgrade ?? 0,
    experiments: latest.bucket_exp ?? 0,
    expansion: latest.bucket_expand ?? 0,
    liquidity: latest.bucket_liquid ?? 0,
  };
}

/**
 * Unlock money from a bucket for spending.
 * Example: "unlock $1000 from experiments bucket to train new strategy"
 */
export function unlockFromBucket(bucket, amount, reason) {
  if (!REINVESTMENT.hasOwnProperty(bucket)) {
    throw new Error(`unknown bucket: ${bucket}`);
  }

  const buckets = getBuckets();
  const bucketKey = bucket === 'agentUpgrade' ? 'agentUpgrade' :
                    bucket === 'experiments' ? 'experiments' :
                    bucket === 'expansion' ? 'expansion' :
                    bucket === 'reserve' ? 'reserve' : 'liquidity';
  const available = buckets[bucketKey] ?? 0;

  if (amount > available) {
    throw new Error(`insufficient funds in ${bucket} bucket ($${available.toFixed(2)} < $${amount.toFixed(2)})`);
  }

  const columnMap = {
    reserve: 'bucket_reserve',
    agentUpgrade: 'bucket_upgrade',
    experiments: 'bucket_exp',
    expansion: 'bucket_expand',
    liquidity: 'bucket_liquid',
  };

  try {
    tx(() => {
      const latest = db.prepare('SELECT * FROM capital_history ORDER BY rowid DESC LIMIT 1').get();
      const updates = {
        bucket_reserve: latest?.bucket_reserve ?? 0,
        bucket_upgrade: latest?.bucket_upgrade ?? 0,
        bucket_exp: latest?.bucket_exp ?? 0,
        bucket_expand: latest?.bucket_expand ?? 0,
        bucket_liquid: latest?.bucket_liquid ?? 0,
      };

      // Decrement the specified bucket
      updates[columnMap[bucket]] -= amount;

      db.prepare(`
        INSERT INTO capital_history
          (total, available, in_trades, bucket_reserve, bucket_upgrade,
           bucket_exp, bucket_expand, bucket_liquid, note, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        latest?.total ?? 0,
        (latest?.available ?? 0) + amount,  // freed money goes to available
        latest?.in_trades ?? 0,
        updates.bucket_reserve,
        updates.bucket_upgrade,
        updates.bucket_exp,
        updates.bucket_expand,
        updates.bucket_liquid,
        `[unlock] $${amount.toFixed(2)} from ${bucket}: ${reason}`
      );
    });

    console.log(`[unlock] Freed $${amount.toFixed(2)} from ${bucket}: ${reason}`);
    return { unlocked: true, amount, reason };
  } catch (err) {
    console.error('[unlock] Failed:', err.message);
    throw err;
  }
}

/**
 * Monthly budget review: show bucket allocations and unlock recommendations
 */
export function getBudgetReview() {
  const buckets = getBuckets();
  const review = {
    timestamp: new Date().toISOString(),
    totalCapital: buckets.total,
    bucketsJson: buckets,
    recommendations: [],
  };

  // If reserve bucket is < 10% of total, flag
  if (buckets.reserve < buckets.total * 0.10) {
    review.recommendations.push({
      bucket: 'reserve',
      action: 'INCREASE',
      reason: 'Emergency buffer below 10% of total',
      suggested: buckets.total * 0.10 - buckets.reserve,
    });
  }

  // If liquidity bucket is > 30% of total, suggest rebalancing
  if (buckets.liquidity > buckets.total * 0.30) {
    review.recommendations.push({
      bucket: 'liquidity',
      action: 'REBALANCE',
      reason: 'Too much sitting in liquidity; consider investing',
      excess: buckets.liquidity - (buckets.total * 0.10),
    });
  }

  // If experiments bucket is > $5000, suggest allocation
  if (buckets.experiments > 5000) {
    review.recommendations.push({
      bucket: 'experiments',
      action: 'ALLOCATE',
      reason: 'Substantial budget available for new strategy research',
      available: buckets.experiments,
    });
  }

  return review;
}
