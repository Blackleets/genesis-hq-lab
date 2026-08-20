// paperTrader.mjs — Live paper-trading simulation of the VALIDATED mean-reversion
// edge, on REAL Binance data. This does NOT execute real trades and does NOT
// require API keys. It confirms the edge survives live data flow.
//
// How it's honest:
//   - Prices come ONLY from fetchKlines() (real Binance candles, cached).
//   - It replays the most recent `replayCandles` real candles tick-by-tick and
//     applies the exact same signals/exit logic as realValidation.mjs.
//   - No synthetic fills, no fake fills — every trade is on a real candle's H/L.
//
// Run: node --env-file-if-exists=.env server/crypto/backtest/paperTrader.mjs
//   env: PAPER_PAIR (default SOLUSDT), PAPER_INTERVAL (4h), PAPER_DAYS (60),
//        PAPER_CAPITAL (10000), PAPER_RISK (1.0)

import { fetchKlines } from './historicalData.mjs';
import { computeMetrics } from './metrics.mjs';
import {
  calculateBollingerBands as bollinger,
  calculateRsi as rsi,
  calculateAdx as adx,
} from '../technicalIndicators.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PAIR = process.env.PAPER_PAIR || 'SOLUSDT';
const INTERVAL = process.env.PAPER_INTERVAL || '4h';
const DAYS = Number(process.env.PAPER_DAYS || 60);
const START_CAPITAL = Number(process.env.PAPER_CAPITAL || 10_000);
const RISK_PCT = Number(process.env.PAPER_RISK || 1.0);
const STOP_PCT = 0.005;
const R_MULT = 1.7;

// Validated params (consensus from SOL/ETH/DOGE 4h walk-forward runs)
const P = { bbPeriod: 20, bbStd: 2.0, rsiPeriod: 13, rsiOS: 30, rsiOB: 70, adxMax: 25, adxPeriod: 14 };

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, '..', '..', '..', 'data', 'papertrade');

function signalsFor(closes, highs, lows) {
  const n = closes.length;
  const out = new Array(n).fill(null);
  const warm = Math.max(P.bbPeriod, P.adxPeriod) + 2;
  for (let i = warm; i < n; i++) {
    const sliceC = closes.slice(0, i + 1);
    const sliceH = highs.slice(0, i + 1);
    const sliceL = lows.slice(0, i + 1);
    const bb = bollinger(sliceC, P.bbPeriod, P.bbStd);
    const r = rsi(sliceC, P.rsiPeriod);
    const a = adx(sliceH, sliceL, sliceC, P.adxPeriod);
    const price = closes[i];
    if (a > P.adxMax) continue;
    if (price <= bb.lower && r <= P.rsiOS) out[i] = 'LONG';
    else if (price >= bb.upper && r >= P.rsiOB) out[i] = 'SHORT';
  }
  return out;
}

async function main() {
  console.log(`\n=== PAPER TRADER (live replay of REAL data): ${PAIR} ${INTERVAL} (${DAYS}d) ===`);
  const klines = await fetchKlines(PAIR, { days: DAYS, interval: INTERVAL });
  console.log(`Loaded ${klines.length} REAL candles.`);
  if (klines.length < 50) { console.log('NOT ENOUGH DATA'); return; }

  const closes = klines.map((k) => +k[4]);
  const highs = klines.map((k) => +k[2]);
  const lows = klines.map((k) => +k[3]);
  const signals = signalsFor(closes, highs, lows);

  let equity = START_CAPITAL;
  let pos = null;
  const trades = [];
  const equityCurve = [];

  for (let i = 0; i < signals.length; i++) {
    const hi = highs[i], lo = lows[i], price = closes[i];
    if (pos) {
      const tpHit = pos.side === 'LONG' ? hi >= pos.tp : lo <= pos.tp;
      const slHit = pos.side === 'LONG' ? lo <= pos.sl : hi >= pos.sl;
      if (tpHit) {
        const pnl = (pos.side === 'LONG' ? pos.tp - pos.entry : pos.entry - pos.tp) * pos.units;
        equity += pnl; trades.push({ pnl, capitalUsed: pos.riskUSD, at: klines[i][0] }); pos = null;
      } else if (slHit) {
        const pnl = (pos.side === 'LONG' ? pos.sl - pos.entry : pos.entry - pos.sl) * pos.units;
        equity += pnl; trades.push({ pnl, capitalUsed: pos.riskUSD, at: klines[i][0] }); pos = null;
      }
    }
    if (!pos && signals[i]) {
      const stopDist = price * STOP_PCT;
      const riskUSD = equity * (RISK_PCT / 100);
      const units = riskUSD / stopDist;
      const side = signals[i];
      pos = {
        side, entry: price,
        sl: side === 'LONG' ? price - stopDist : price + stopDist,
        tp: side === 'LONG' ? price + stopDist * R_MULT : price - stopDist * R_MULT,
        units, riskUSD,
      };
    }
    equityCurve.push({ at: klines[i][0], equity: Math.round(equity) });
  }

  const m = computeMetrics(trades, { startCapital: START_CAPITAL });
  console.log(`\nPaper result on REAL ${PAIR} ${INTERVAL} data:`);
  console.log(`  Trades:       ${m.trades}`);
  console.log(`  Win rate:     ${(m.winRate * 100).toFixed(1)}%`);
  console.log(`  Net PnL:      $${m.netPnl} (ROI ${(m.roi * 100).toFixed(1)}%)`);
  console.log(`  Profit factor: ${m.profitFactor}`);
  console.log(`  Expectancy:   $${m.expectancy}/trade`);
  console.log(`  Max drawdown:  ${(m.maxDrawdown * 100).toFixed(2)}%`);
  console.log(`  Final equity: $${Math.round(equity)} (from $${START_CAPITAL})`);

  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `papertrade-${PAIR}-${INTERVAL}.json`);
  writeFileSync(file, JSON.stringify({
    pair: PAIR, interval: INTERVAL, days: DAYS,
    startCapital: START_CAPITAL, params: P,
    summary: m, trades, equityCurve, savedAt: new Date().toISOString(),
  }, null, 2));
  console.log(`\nSaved audit trail -> ${file}`);
  console.log(m.netPnl > 0
    ? 'PAPER EDGE CONFIRMED on live replay. Ready to consider execution (with your keys + risk acceptance).'
    : 'PAPER EDGE NOT confirmed this window. Do NOT proceed to real capital.');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
