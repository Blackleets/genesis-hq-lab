// metrics.mjs — backtest performance metrics for prediction markets.
// All metrics are computed from a list of trade results.
// No fabrication — returns INSUFFICIENT_DATA when trade count is too low.

export const MIN_TRADES_FOR_METRICS = 5;

/**
 * @typedef {Object} TradeResult
 * @property {number} entryPrice    - 0..1 fraction (probability paid)
 * @property {number} exitPrice     - 0 (loss) or 1 (win)
 * @property {number} size          - USD notional
 * @property {number} feePaid       - USD fees paid
 * @property {number} slippage      - USD slippage estimate
 * @property {boolean} won          - resolved YES
 */

/**
 * Compute full metrics from a trade result array.
 *
 * @param {TradeResult[]} trades
 * @param {{ feePct?: number, slippagePct?: number }} opts
 * @returns {{ ok: boolean, error?: string, metrics?: object }}
 */
export function computeMetrics(trades, { feePct = 0.002, slippagePct = 0.005 } = {}) {
  if (!Array.isArray(trades) || trades.length < MIN_TRADES_FOR_METRICS) {
    return { ok: false, error: 'INSUFFICIENT_DATA', minRequired: MIN_TRADES_FOR_METRICS, got: trades?.length ?? 0 };
  }

  let wins = 0;
  let totalPnL = 0;
  let totalFees = 0;
  let totalSlippage = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let runningCapital = 0;
  let peakCapital = 0;
  let maxDrawdown = 0;
  const pnlSeries = [];

  for (const t of trades) {
    const rawPnL = (t.exitPrice - t.entryPrice) * t.size;
    const fees = t.feePaid ?? t.size * feePct * 2; // entry + exit
    const slip = t.slippage ?? t.size * slippagePct;
    const netPnL = rawPnL - fees - slip;

    totalPnL += netPnL;
    totalFees += fees;
    totalSlippage += slip;
    runningCapital += netPnL;
    pnlSeries.push(netPnL);

    if (netPnL > 0) {
      wins++;
      grossProfit += netPnL;
    } else {
      grossLoss += Math.abs(netPnL);
    }

    if (runningCapital > peakCapital) peakCapital = runningCapital;
    const drawdown = peakCapital > 0 ? (peakCapital - runningCapital) / peakCapital : 0;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  const totalTrades = trades.length;
  const winRate = wins / totalTrades;
  const avgPnL = totalPnL / totalTrades;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Expected Value: probability-weighted average outcome
  const ev = avgPnL;

  // Sharpe-like ratio (annualized — simplified, no risk-free rate)
  const mean = pnlSeries.reduce((a, b) => a + b, 0) / pnlSeries.length;
  const variance = pnlSeries.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / pnlSeries.length;
  const stddev = Math.sqrt(variance);
  const sharpeProxy = stddev > 0 ? mean / stddev : 0;

  return {
    ok: true,
    metrics: {
      totalTrades,
      wins,
      losses: totalTrades - wins,
      winRate:          round(winRate, 4),
      EV:               round(ev, 4),
      avgPnL:           round(avgPnL, 4),
      totalPnL:         round(totalPnL, 4),
      grossProfit:      round(grossProfit, 4),
      grossLoss:        round(grossLoss, 4),
      profitFactor:     round(profitFactor, 4),
      maxDrawdown:      round(maxDrawdown, 4),
      fees:             round(totalFees, 4),
      slippageEstimate: round(totalSlippage, 4),
      sharpeProxy:      round(sharpeProxy, 4),
    },
  };
}

function round(n, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}
