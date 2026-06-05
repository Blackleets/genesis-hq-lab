// cryptoMath.mjs — pure target/stop and gross-PnL math for crypto scalps.
// DB-free on purpose: the backtest and optimizer import this without opening
// SQLite, while cryptoExecution.mjs re-exports it for the live path.

import { getParams } from './strategyParams.mjs';

// Round to N significant figures — keeps precision across price scales.
// (Rounding to 2 decimals worked for BTC ~$100k but collapsed low-priced alts
// like DOGE ~$0.12, where target/stop landed on the entry → fake instant wins.)
function roundSig(x, sig = 6) {
  if (!Number.isFinite(x) || x === 0) return 0;
  const digits = Math.ceil(Math.log10(Math.abs(x)));
  const power = sig - digits;
  const m = 10 ** power;
  return Math.round(x * m) / m;
}

export function computeCryptoTargets(side, entryPrice, params = getParams()) {
  const { targetPct, stopPct } = params;
  if (side === 'LONG') {
    return {
      targetPrice: roundSig(entryPrice * (1 + targetPct)),
      stopPrice:   roundSig(entryPrice * (1 - stopPct)),
    };
  }
  return {
    targetPrice: roundSig(entryPrice * (1 - targetPct)),
    stopPrice:   roundSig(entryPrice * (1 + stopPct)),
  };
}

/** Gross PnL (no fees/slippage). Net PnL lives in costs.cryptoNetPnl. */
export function computeCryptoPnl(side, entryPrice, exitPrice, shares) {
  if (side === 'LONG') return Math.round((exitPrice - entryPrice) * shares * 1000) / 1000;
  return Math.round((entryPrice - exitPrice) * shares * 1000) / 1000;
}
