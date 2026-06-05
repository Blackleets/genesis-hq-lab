// metrics.mjs — pure performance statistics for a list of closed backtest trades.
// A trade is { pnl: number, capitalUsed: number }. No I/O — trivially testable.

export function computeMetrics(trades, { startCapital = 10_000 } = {}) {
  const n = trades.length;
  if (n === 0) {
    return {
      trades: 0, wins: 0, losses: 0, winRate: 0,
      netPnl: 0, roi: 0, totalRisked: 0,
      grossProfit: 0, grossLoss: 0, profitFactor: null,
      avgWin: 0, avgLoss: 0, expectancy: 0, maxDrawdown: 0,
    };
  }

  let wins = 0, losses = 0, netPnl = 0, totalRisked = 0, grossProfit = 0, grossLoss = 0;
  let equity = startCapital, peak = startCapital, maxDrawdown = 0;

  for (const t of trades) {
    const pnl = t.pnl ?? 0;
    netPnl += pnl;
    totalRisked += t.capitalUsed ?? 0;
    if (pnl > 0) { wins++; grossProfit += pnl; }
    else if (pnl < 0) { losses++; grossLoss += -pnl; }

    equity += pnl;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? (peak - equity) / peak : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  return {
    trades: n,
    wins,
    losses,
    winRate: wins / n,
    netPnl: round(netPnl),
    roi: totalRisked > 0 ? netPnl / totalRisked : 0,
    totalRisked: round(totalRisked),
    grossProfit: round(grossProfit),
    grossLoss: round(grossLoss),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : null,
    avgWin: wins > 0 ? round(grossProfit / wins) : 0,
    avgLoss: losses > 0 ? round(grossLoss / losses) : 0,
    expectancy: round(netPnl / n),
    maxDrawdown,
  };
}

function round(x) {
  return Math.round(x * 1e6) / 1e6;
}
