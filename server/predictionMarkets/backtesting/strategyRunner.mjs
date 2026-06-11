// strategyRunner.mjs — named strategy functions for prediction market backtesting.
// Each strategy receives a priceHistory array and returns entry/exit decisions.
// Add new strategies here; they auto-appear in the backtest engine.

/**
 * @typedef {Object} HistoricalTick
 * @property {string} ts
 * @property {number} yesPrice
 * @property {number} noPrice
 * @property {number} volume24h
 * @property {number} liquidity
 */

/**
 * @typedef {Object} TradeSignal
 * @property {'YES'|'NO'|null} side - null means no trade
 * @property {number} entryPrice
 * @property {string} reason
 */

// ── Strategy: buy YES when implied probability < 0.4 (contrarian low) ─────────

function strategyYesLow(ticks) {
  const signals = [];
  for (let i = 1; i < ticks.length; i++) {
    const t = ticks[i];
    if (t.yesPrice < 0.40 && t.volume24h > 5000) {
      signals.push({ side: 'YES', entryPrice: t.yesPrice, reason: 'yesPrice_below_0.40_with_volume' });
    } else {
      signals.push({ side: null, entryPrice: t.yesPrice, reason: 'no_signal' });
    }
  }
  return signals;
}

// ── Strategy: buy NO when YES price > 0.80 (fade the consensus) ──────────────

function strategyFadeConsensus(ticks) {
  const signals = [];
  for (let i = 1; i < ticks.length; i++) {
    const t = ticks[i];
    if (t.yesPrice > 0.80 && t.liquidity > 50000) {
      signals.push({ side: 'NO', entryPrice: t.noPrice, reason: 'fading_high_consensus_yesPrice_over_0.80' });
    } else {
      signals.push({ side: null, entryPrice: t.yesPrice, reason: 'no_signal' });
    }
  }
  return signals;
}

// ── Strategy: momentum — buy YES if yesPrice rising 3 ticks in a row ─────────

function strategyMomentum(ticks) {
  const signals = [];
  for (let i = 3; i < ticks.length; i++) {
    const rising = ticks[i].yesPrice > ticks[i - 1].yesPrice &&
                   ticks[i - 1].yesPrice > ticks[i - 2].yesPrice &&
                   ticks[i - 2].yesPrice > ticks[i - 3].yesPrice;
    if (rising) {
      signals.push({ side: 'YES', entryPrice: ticks[i].yesPrice, reason: 'momentum_3_ticks_up' });
    } else {
      signals.push({ side: null, entryPrice: ticks[i].yesPrice, reason: 'no_signal' });
    }
  }
  // Pad leading ticks with no-signal
  while (signals.length < ticks.length - 1) signals.unshift({ side: null, entryPrice: ticks[0].yesPrice, reason: 'warmup' });
  return signals;
}

// ── Strategy: spread hunter — buy side with lower price on wide spread ────────

function strategySpreadHunter(ticks) {
  const signals = [];
  for (let i = 1; i < ticks.length; i++) {
    const t = ticks[i];
    const spread = Math.abs(t.noPrice - t.yesPrice);
    if (spread > 0.08) {
      const side = t.yesPrice < t.noPrice ? 'YES' : 'NO';
      const entryPrice = side === 'YES' ? t.yesPrice : t.noPrice;
      signals.push({ side, entryPrice, reason: `wide_spread_${spread.toFixed(3)}_buy_${side}` });
    } else {
      signals.push({ side: null, entryPrice: t.yesPrice, reason: 'spread_too_narrow' });
    }
  }
  return signals;
}

// ── Registry ──────────────────────────────────────────────────────────────────

export const STRATEGIES = {
  simple_yes_low:    { fn: strategyYesLow,       description: 'Buy YES when implied probability < 0.40 with volume' },
  fade_consensus:    { fn: strategyFadeConsensus, description: 'Buy NO when YES > 0.80 with liquidity (fade the crowd)' },
  momentum:          { fn: strategyMomentum,      description: 'Buy YES on 3 consecutive up-ticks' },
  spread_hunter:     { fn: strategySpreadHunter,  description: 'Buy cheapest side when spread > 8%' },
};

export function getStrategyNames() {
  return Object.keys(STRATEGIES);
}

/**
 * Run a named strategy on a price history array.
 *
 * @param {string} strategyName
 * @param {HistoricalTick[]} ticks
 * @returns {TradeSignal[]}
 */
export function runStrategy(strategyName, ticks) {
  const entry = STRATEGIES[strategyName];
  if (!entry) throw new Error(`Unknown strategy: "${strategyName}". Available: ${Object.keys(STRATEGIES).join(', ')}`);
  if (!Array.isArray(ticks) || ticks.length < 2) return [];
  return entry.fn(ticks);
}
