// backtestEngine.mjs — replays the EXACT live strategy (signal.mjs + targets +
// costs) candle-by-candle over historical 1m klines. One position per series at
// a time, mirroring the live engine. Pure: no network, no DB.
//
// Kline format (Binance): [openTime, open, high, low, close, volume, closeTime, quoteVolume, ...]

import { computeEma, computeRsi } from '../priceFeeder.mjs';
import { computeCryptoTargets } from '../cryptoMath.mjs';
import { cryptoNetPnl, cryptoSlippagePct, getCryptoFeePct } from '../../trading/costs.mjs';
import { evaluateSignal } from '../signal.mjs';
import { computeMetrics } from './metrics.mjs';

const VOLUME_WINDOW = 1440; // candles (~24h of 1m bars) for the volume estimate
const CTX_WINDOW = 120;     // trailing closes used per candle — keeps the loop O(n), not O(n²)

/** Build a priceFeeder-shaped context from a trailing window of closes + 24h volume. */
function buildCtx(closes, volume24h) {
  const price = closes[closes.length - 1];
  // Mirror priceFeeder.buildAssetContext: 1h change uses the close 60 bars back.
  const change1h = closes.length >= 60
    ? ((closes[closes.length - 1] - closes[closes.length - 60]) / closes[closes.length - 60]) * 100
    : 0;
  return {
    price,
    change1h: Math.round(change1h * 100) / 100,
    volume24h,
    ema9:  Math.round(computeEma(closes, 9) * 100) / 100,
    ema21: Math.round(computeEma(closes, 21) * 100) / 100,
    rsi14: computeRsi(closes, 14),
  };
}

export function runBacktest(klines, params, opts = {}) {
  const signalFn   = opts.signalFn ?? evaluateSignal;
  const warmup     = opts.warmup ?? 60;
  const positionUsd = opts.positionUsd ?? 100;
  const startCapital = opts.startCapital ?? 10_000;
  const feePct     = opts.feePct ?? getCryptoFeePct();
  const timeoutMs  = (params.timeoutHours ?? 4) * 3600_000;

  const closesAll = klines.map(c => parseFloat(c[4]));

  // Prefix sums of quote volume → O(1) trailing 24h volume per candle.
  const quoteVols = klines.map(c => parseFloat(c[7]) || 0);
  const prefix = new Array(quoteVols.length + 1).fill(0);
  for (let j = 0; j < quoteVols.length; j++) prefix[j + 1] = prefix[j] + quoteVols[j];
  const volumeAt = (i) => {
    const start = Math.max(0, i - VOLUME_WINDOW + 1);
    const span = i - start + 1;
    const sum = prefix[i + 1] - prefix[start];
    return span > 0 ? sum * (VOLUME_WINDOW / span) : 0;
  };

  const trades = [];
  let position = null;

  for (let i = warmup; i < klines.length; i++) {
    const candle = klines[i];
    const high = parseFloat(candle[2]);
    const low  = parseFloat(candle[3]);
    const close = parseFloat(candle[4]);
    const openTime = candle[0];

    if (position) {
      const isLong = position.side === 'LONG';
      let exitReason = null;
      let exitPrice = null;

      // Timeout takes priority if the candle is past the horizon.
      if (openTime - position.openTime >= timeoutMs) {
        exitReason = 'timeout';
        exitPrice = close;
      } else if (isLong) {
        // Conservative: assume stop is touched before target within the same candle.
        if (low <= position.stop)        { exitReason = 'stop_loss';  exitPrice = position.stop; }
        else if (high >= position.target) { exitReason = 'target_hit'; exitPrice = position.target; }
      } else {
        if (high >= position.stop)       { exitReason = 'stop_loss';  exitPrice = position.stop; }
        else if (low <= position.target)  { exitReason = 'target_hit'; exitPrice = position.target; }
      }

      if (exitReason) {
        const pnl = cryptoNetPnl({
          side: position.side,
          entryPrice: position.entryPrice,
          exitPrice,
          shares: position.shares,
          feePct,
          slippagePct: position.slippagePct,
        });
        trades.push({
          side: position.side,
          entryPrice: position.entryPrice,
          exitPrice,
          exitReason,
          pnl,
          capitalUsed: position.capitalUsed,
          shares: position.shares,
          openTime: position.openTime,
          closeTime: openTime,
        });
        position = null;
      }
      continue; // never open and close in the same candle
    }

    // No position: look for a fresh signal on a trailing window of closes.
    const closes = closesAll.slice(Math.max(0, i - CTX_WINDOW + 1), i + 1);
    const volume24h = volumeAt(i);
    const ctx = buildCtx(closes, volume24h);
    const sig = signalFn(ctx, params);

    if (sig.action === 'TRADE' && (sig.side === 'LONG' || sig.side === 'SHORT')) {
      const entryPrice = close;
      const { targetPrice, stopPrice } = computeCryptoTargets(sig.side, entryPrice, params);
      const shares = positionUsd / entryPrice;
      position = {
        side: sig.side,
        entryPrice,
        target: targetPrice,
        stop: stopPrice,
        shares,
        capitalUsed: positionUsd,
        slippagePct: cryptoSlippagePct(positionUsd, volume24h),
        openTime,
      };
    }
  }

  return { trades, metrics: computeMetrics(trades, { startCapital }) };
}
