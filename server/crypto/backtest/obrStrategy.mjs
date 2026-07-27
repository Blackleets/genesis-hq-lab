// obrStrategy.mjs — Ortogonal Breakout Reversal (1m intrabar version).
//
// Idea: usar 1m candles para detectar rupturas intrabares de ranges de 15m.
// Si el precio toca (high/low) un nivel de resistencia/support del rango 15m
// pero CIERRA dentro del rango en la misma barra, es señal de agotamiento.
//
// Esto atrapa micro-reversiones dentro de trends: el precio hace un spike
// (FOMO) pero no logra sostenerse → reversión rápida.
//
// Config:
// - Range de 15m (20 barras de 15m = 5h) para definir resistencia/support
// - Señal en 1m: si high > rangeHigh pero close < rangeHigh → SHORT
//                si low < rangeLow pero close > rangeLow → LONG
// - TP en el otro extremo del rango 15m
// - SL fuera del spike (más allá del high/low de la barra de señal)
// - Timeout: 60 barras de 1m (1h)

import { fetchKlines } from './historicalData.mjs';
import { computeMetrics } from './metrics.mjs';

const PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'];
const RANGE_BARS_15M = 20;  // 20 x 15m = 5h
const TIMEOUT_BARS_1M = 60; // 60 x 1m = 1h
const SL_SPIKE_BUFFER = 0.001; // 0.1% de buffer sobre el spike para SL

function computeAtr15m(klines15m, period) {
  if (klines15m.length < period + 1) return 0;
  let sum = 0;
  for (let i = klines15m.length - period; i < klines15m.length; i++) {
    const high = parseFloat(klines15m[i][2]);
    const low = parseFloat(klines15m[i][3]);
    const prevClose = parseFloat(klines15m[i - 1][4]);
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    sum += tr;
  }
  return sum / period;
}

export async function runObrBacktest({ pair = 'BTCUSDT', days = 365, positionUsd = 100 } = {}) {
  // Fetch 1m klines for trading
  const klines1m = await fetchKlines(pair, { days, interval: '1m' });
  // Fetch 15m klines for range detection (downsample from 1m)
  const klines15m = [];
  for (let i = 14; i < klines1m.length; i += 15) {
    const bar15m = klines1m.slice(i - 14, i + 1);
    const open = parseFloat(bar15m[0][1]);
    const high = Math.max(...bar15m.map(b => parseFloat(b[2])));
    const low = Math.min(...bar15m.map(b => parseFloat(b[3])));
    const close = parseFloat(bar15m[bar15m.length - 1][4]);
    const volume = bar15m.reduce((s, b) => s + parseFloat(b[5]), 0);
    const quoteVolume = bar15m.reduce((s, b) => s + (parseFloat(b[7]) || 0), 0);
    klines15m.push([bar15m[0][0], open, high, low, close, volume, bar15m[bar15m.length - 1][6], quoteVolume]);
  }

  const trades = [];
  let position = null;
  const feePct = 0.001;

  // Map 1m index to 15m index
  const bar15mIndex = (i1m) => Math.floor(i1m / 15);

  const WARMUP_1M = RANGE_BARS_15M * 15 + 15; // enough 15m bars + buffer

  for (let i = WARMUP_1M; i < klines1m.length; i++) {
    const candle = klines1m[i];
    const high = parseFloat(candle[2]);
    const low = parseFloat(candle[3]);
    const close = parseFloat(candle[4]);
    const openTime = candle[0];

    if (position) {
      let exitReason = null;
      let exitPrice = null;

      if (i - position.openBar >= TIMEOUT_BARS_1M) {
        exitReason = 'timeout';
        exitPrice = close;
      } else if (position.side === 'LONG') {
        if (low <= position.stop) { exitReason = 'stop_loss'; exitPrice = position.stop; }
        else if (high >= position.target) { exitReason = 'target_hit'; exitPrice = position.target; }
      } else {
        if (high >= position.stop) { exitReason = 'stop_loss'; exitPrice = position.stop; }
        else if (low <= position.target) { exitReason = 'target_hit'; exitPrice = position.target; }
      }

      if (exitReason) {
        const pnl = position.side === 'LONG'
          ? (exitPrice - position.entryPrice) * position.shares - (position.entryPrice * position.shares * feePct * 2)
          : (position.entryPrice - exitPrice) * position.shares - (position.entryPrice * position.shares * feePct * 2);

        trades.push({
          side: position.side,
          entryPrice: position.entryPrice,
          exitPrice,
          exitReason,
          pnl,
          openTime: position.openTime,
          closeTime: openTime,
        });
        position = null;
      }
      continue;
    }

    // Get current 15m range
    const idx15 = bar15mIndex(i);
    if (idx15 < RANGE_BARS_15M + 1) continue;

    const range15m = klines15m.slice(idx15 - RANGE_BARS_15M, idx15);
    const rangeHigh = Math.max(...range15m.map(c => parseFloat(c[2])));
    const rangeLow = Math.min(...range15m.map(c => parseFloat(c[3])));
    const atr15 = computeAtr15m(klines15m.slice(idx15 - RANGE_BARS_15M - 1, idx15 + 1), RANGE_BARS_15M);

    if (atr15 <= 0) continue;

    // OBR signal: price touched range boundary but closed inside
    const touchedUp = high > rangeHigh;
    const touchedDown = low < rangeLow;
    const closedInside = close <= rangeHigh && close >= rangeLow;

    if (!closedInside) continue;

    let side = null;
    let targetPrice, stopPrice;

    if (touchedUp && close < rangeHigh) {
      // Spike up but closed below rangeHigh → SHORT
      side = 'SHORT';
      targetPrice = rangeLow;
      stopPrice = high * (1 + SL_SPIKE_BUFFER);
    } else if (touchedDown && close > rangeLow) {
      // Spike down but closed above rangeLow → LONG
      side = 'LONG';
      targetPrice = rangeHigh;
      stopPrice = low * (1 - SL_SPIKE_BUFFER);
    }

    if (!side) continue;

    const entryPrice = close;
    const shares = positionUsd / entryPrice;

    position = {
      side,
      entryPrice,
      target: targetPrice,
      stop: stopPrice,
      shares,
      openTime,
      openBar: i,
    };
  }

  return { trades, metrics: computeMetrics(trades, { startCapital: 10000 }) };
}

export async function runObrMultiPair({ pairs = PAIRS, days = 365, positionUsd = 100 } = {}) {
  const allTrades = [];
  const results = {};

  for (const pair of pairs) {
    try {
      const { trades, metrics } = await runObrBacktest({ pair, days, positionUsd });
      results[pair] = { trades: trades.length, metrics };
      allTrades.push(...trades.map(t => ({ ...t, pair })));
      console.log(`${pair}: ${trades.length} trades | PF:${metrics.profitFactor?.toFixed(2) || 'N/A'} | Exp:${metrics.expectancy?.toFixed(2) || 'N/A'} | Net:${metrics.netPnL?.toFixed(2) || 'N/A'} | WR:${(metrics.winRate * 100).toFixed(1)}%`);
    } catch (err) {
      console.error(`${pair}: ${err.message}`);
      results[pair] = { error: err.message };
    }
  }

  const combinedMetrics = computeMetrics(allTrades, { startCapital: 10000 });
  return { results, combinedTrades: allTrades, combinedMetrics };
}
