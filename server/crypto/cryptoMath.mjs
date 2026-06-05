// cryptoMath.mjs — pure target/stop and gross-PnL math for crypto scalps.
// DB-free on purpose: the backtest and optimizer import this without opening
// SQLite, while cryptoExecution.mjs re-exports it for the live path.

import { getParams } from './strategyParams.mjs';

export function computeCryptoTargets(side, entryPrice, params = getParams()) {
  const { targetPct, stopPct } = params;
  if (side === 'LONG') {
    return {
      targetPrice: Math.round(entryPrice * (1 + targetPct) * 100) / 100,
      stopPrice:   Math.round(entryPrice * (1 - stopPct)   * 100) / 100,
    };
  }
  return {
    targetPrice: Math.round(entryPrice * (1 - targetPct) * 100) / 100,
    stopPrice:   Math.round(entryPrice * (1 + stopPct)   * 100) / 100,
  };
}

/** Gross PnL (no fees/slippage). Net PnL lives in costs.cryptoNetPnl. */
export function computeCryptoPnl(side, entryPrice, exitPrice, shares) {
  if (side === 'LONG') return Math.round((exitPrice - entryPrice) * shares * 1000) / 1000;
  return Math.round((entryPrice - exitPrice) * shares * 1000) / 1000;
}
