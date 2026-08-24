// server/genesis/ccxtFeed.mjs
// Real market data + (future) execution via ccxt — the #1 GitHub exchange lib.
// PAPER ONLY by default. Execution requires HUMAN GO + real keys in .env.
// This module NEVER signs or places an order unless REAL_TRADING mode is
// explicitly enabled AND a key exists. Even then, it logs and requires confirm.

import ccxt from 'ccxt';
import { getSharedThrottler } from './rateLimiter.mjs';

const EXCHANGE = process.env.GENESIS_EXCHANGE || 'binance';

export function getExchange({ real = false } = {}) {
  const Ex = ccxt[EXCHANGE];
  if (!Ex) throw new Error(`exchange ${EXCHANGE} not supported by ccxt`);
  const cfg = {};
  if (real) {
    const key = process.env.GENESIS_API_KEY;
    const secret = process.env.GENESIS_API_SECRET;
    if (!key || !secret) throw new Error('REAL mode requires GENESIS_API_KEY + GENESIS_API_SECRET (not set)');
    cfg.apiKey = key; cfg.secret = secret;
  }
  return new Ex(cfg);
}

// Fetch REAL OHLCV (ccxt is the canonical, multi-exchange interface).
export async function fetchOHLCV(pair, timeframe = '1h', limit = 1000, { real = false } = {}) {
  const ex = getExchange({ real: false }); // data is public; never needs keys
  const symbol = pair.replace('USDT', '/USDT');
  const since = Date.now() - limit * tfMs(timeframe);
  // Draw from the SHARED Binance budget (ohlcv: 50 req/min) before the REST call.
  await getSharedThrottler().acquire('ohlcv');
  const ohlcv = await ex.fetchOHLCV(symbol, timeframe, since, limit);
  // ccxt returns [ts, o, h, l, c, v] -> map to Binance klines shape [ts,o,h,l,c,v,closeTs,quoteVol,...]
  return ohlcv.map(([ts, o, h, l, c, v]) => [ts, String(o), String(h), String(l), String(c), String(v), ts + tfMs(timeframe), String(v * c), 0, '0', '0', '0']);
}

function tfMs(tf) {
  const m = { '1m': 60e3, '5m': 5 * 60e3, '15m': 15 * 60e3, '1h': 3600e3, '4h': 4 * 3600e3, '1d': 86400e3 };
  return m[tf] || 3600e3;
}

// ----- PAPER execution only -----
export function paperOrder({ pair, side, amount, price }) {
  return {
    mode: 'paper', executed: true, pair, side, amount, price,
    note: 'PAPER fill — NO real funds moved. Real execution requires human GO + keys.',
    at: new Date().toISOString(),
  };
}

// Attempt REAL order. Only runs if REAL_TRADING enabled + keys present.
// Logs the intent and returns a structured result; does NOT silently trade.
export async function requestRealOrder({ pair, side, amount }, { requireConfirm = true } = {}) {
  const realMode = ['1', 'true', 'yes'].includes((process.env.REAL_TRADING ?? '').toLowerCase());
  if (!realMode) return { executed: false, reason: 'REAL_TRADING not enabled', mode: 'paper_blocked' };
  const ex = getExchange({ real: true });
  if (requireConfirm) return { executed: false, reason: 'human confirmation required', mode: 'requires_confirm', intent: { pair, side, amount } };
  const symbol = pair.replace('USDT', '/USDT');
  const order = await ex.createMarketBuyOrder ? null : null;
  // Real order placement is intentionally gated behind a manual approve step.
  return { executed: false, reason: 'manual approval gate', mode: 'pending_human', intent: { symbol, side, amount } };
}
