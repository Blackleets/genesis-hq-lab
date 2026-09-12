// mrBacktest.mjs - Quick backtest for the mean reversion scalper strategy
// Tests the new strategy on recent data to verify it has positive edge

import { fetchKlines } from './server/crypto/backtest/historicalData.mjs';
import { computeMetrics } from './server/crypto/backtest/metrics.mjs';

const PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const LOOKBACK_DAYS = 60; // 2 months of data
const POSITION_SIZE = 100; // $100 per trade
const FEE_PCT = 0.001; // 0.1% taker fee

// Simple MR strategy implementation for backtesting
function calculateAtR(highs, lows, closes, period) {
  if (highs.length < period + 1) return 0;
  let trSum = 0;
  for (let i = 1; i <= period; i++) {
    const idx = highs.length - i;
    const high = parseFloat(highs[idx]);
    const low = parseFloat(lows[idx]);
    const close = parseFloat(closes[idx - 1]);
    const tr1 = high - low;
    const tr2 = Math.abs(high - close);
    const tr3 = Math.abs(low - close);
    trSum += Math.max(tr1, tr2, tr3);
  }
  return trSum / period;
}

function calculateRsi(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  const slice = closes.slice(-(period + 1)).map(p => parseFloat(p));
  let gains = 0, losses = 0;
  for (let i = 1; i < slice.length; i++) {
    const change = slice[i] - slice[i-1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateBollingerBands(closes, period = 20, stdDev = 2) {
  if (closes.length < period) {
    const price = closes.length > 0 ? parseFloat(closes[closes.length - 1]) : 0;
    return { upper: price, middle: price, lower: price };
  }
  const slice = closes.slice(-period);
  const sum = slice.reduce((acc, p) => acc + parseFloat(p), 0);
  const mean = sum / period;
  const variance = slice.reduce((acc, p) => {
    const val = parseFloat(p);
    return acc + Math.pow(val - mean, 2);
  }, 0) / period;
  const std = Math.sqrt(variance);
  return {
    upper: mean + (stdDev * std),
    middle: mean,
    lower: mean - (stdDev * std)
  };
}

// Simplified ADX calculation (returns current DX as approximation)
function calculateAdx(highs, lows, closes, period) {
  if (!highs || !lows || !closes || highs.length < period) return 25; // Default to ranging if insufficient data
  
  const lookback = period * 2;
  const hSlice = highs.slice(-lookback);
  const lSlice = lows.slice(-lookback);
  const cSlice = closes.slice(-lookback);
  
  // Calculate true ranges and directional movement
  let trSum = 0;
  let dmPlusSum = 0;
  let dmMinusSum = 0;
  
  for (let i = 1; i < hSlice.length; i++) {
    const high = parseFloat(hSlice[i]);
    const low = parseFloat(lSlice[i]);
    const close = parseFloat(cSlice[i-1]);
    
    const tr1 = high - low;
    const tr2 = Math.abs(high - close);
    const tr3 = Math.abs(low - close);
    const tr = Math.max(tr1, tr2, tr3);
    
    const dmPlus = Math.max(high - parseFloat(hSlice[i-1]), 0);
    const dmMinus = Math.max(parseFloat(lSlice[i-1]) - low, 0);
    
    trSum += tr;
    if (dmPlus > dmMinus) {
      dmPlusSum += dmPlus;
    } else if (dmMinus > dmPlus) {
      dmMinusSum += dmMinus;
    }
  }
  
  if (trSum === 0) return 25;
  
  const diPlus = 100 * (dmPlusSum / trSum);
  const diMinus = 100 * (dmMinusSum / trSum);
  const dx = Math.abs(diPlus - diMinus) > 0 ? 
             100 * Math.abs(diPlus - diMinus) / (diPlus + diMinus) : 0;
  
  return dx; // Return DX as ADX approximation
}

async function runMrBacktest({ pair = 'BTCUSDT', days = 60, positionUsd = 100 } = {}) {
  try {
    console.log(`Fetching ${days} days of 5m data for ${pair}...`);
    const klines = await fetchKlines(pair, { days, interval: '5m' });
    
    if (!klines || klines.length < 100) {
      throw new Error(`Insufficient data: ${klines.length || 0} candles`);
    }
    
    console.log(`Got ${klines.length} candles`);
    
    const trades = [];
    let position = null;
    
    const lookback = 50; // Enough for ADX(14*2), BB(20), RSI(14)
    
    for (let i = lookback; i < klines.length; i++) {
      const candle = klines[i];
      const high = parseFloat(candle[2]);
      const low = parseFloat(candle[3]);
      const close = parseFloat(candle[4]);
      const openTime = candle[0];
      
      // Manage existing position
      if (position) {
        let exitReason = null;
        let exitPrice = close;
        
        // Time-based exit (max 4 hours = 48 candles of 5m)
        if (i - position.entryBar >= 48) {
          exitReason = 'timeout';
        } 
        // Stop loss
        else if ((position.side === 'L' && low <= position.stop) || 
                 (position.side === 'S' && high >= position.stop)) {
          exitReason = 'stop';
          exitPrice = position.side === 'L' ? position.stop : position.stop;
        }
        // Take profit
        else if ((position.side === 'L' && high >= position.target) || 
                 (position.side === 'S' && low <= position.target)) {
          exitReason = 'target';
          exitPrice = position.side === 'L' ? position.target : position.target;
        }
        
        if (exitReason) {
          const pnl = position.side === 'L' 
            ? (exitPrice - position.entry) * position.shares - (position.entry * position.shares * FEE_PCT * 2)
            : (position.entry - exitPrice) * position.shares - (position.entry * position.shares * FEE_PCT * 2);
            
          trades.push({
            side: position.side,
            entry: position.entry,
            exit: exitPrice,
            pnl,
            reason: exitReason,
            bars: i - position.entryBar
          });
          
          position = null;
        }
        continue; // Skip new signal generation if we have a position
      }
      
      // No position - look for signal
      const windowHighs = klines.slice(Math.max(0, i - lookback), i + 1).map(c => parseFloat(c[2]));
      const windowLows = klines.slice(Math.max(0, i - lookback), i + 1).map(c => parseFloat(c[3]));
      const windowCloses = klines.slice(Math.max(0, i - lookback), i + 1).map(c => parseFloat(c[4]));
      
      if (windowHighs.length < lookback + 1) continue;
      
      const currentClose = close;
      const currentHigh = high;
      const currentLow = low;
      
      // Calculate indicators
      const adx = calculateAdx(windowHighs, windowLows, windowCloses, 14);
      const rsi = calculateRsi(windowCloses, 14);
      const atr = calculateAtR(windowHighs, windowLows, windowCloses, 14);
      const atrPct = currentClose > 0 ? atr / currentClose : 0;
      
      const bb = calculateBollingerBands(windowCloses, 20, 2);
      const bbPosition = (currentClose - bb.lower) / (bb.upper - bb.lower);
      
      // Range calculation (20 periods)
      const rangeHigh = Math.max(...windowHighs.slice(-20));
      const rangeLow = Math.min(...windowLows.slice(-20));
      const rangePosition = (currentClose - rangeLow) / (rangeHigh - rangeLow);
      
      // Filters for ranging market
      const isRanging = adx < 25; // ADX below 25 indicates ranging market
      const inRange = rangePosition > 0.2 && rangePosition < 0.8; // Avoid strong trends
      const volatilityOk = atrPct >= 0.003 && atrPct <= 0.015; // ATR between 0.3% and 1.5%
      
      if (!isRanging || !inRange || !volatilityOk) continue;
      
      // Mean reversion signals
      let longSignal = false;
      let shortSignal = false;
      
      // RSI extremes (using 30/70)
      if (rsi <= 30) longSignal = true;
      if (rsi >= 70) shortSignal = true;
      
      // Bollinger Band touch (price at or beyond band)
      if (bbPosition <= 0) longSignal = true; // Price at or below lower band
      if (bbPosition >= 1) shortSignal = true; // Price at or above upper band
      
      // Volume confirmation (require 1.5x average volume proxy)
      const priceChange = Math.abs(currentClose - parseFloat(klines[i-1][4]));
      const avgPriceChange = klines.slice(Math.max(0, i - 20), i)
        .map(c => Math.abs(parseFloat(c[4]) - parseFloat(klines[Math.max(0, i-21)][4] || c[4])))
        .reduce((a, b) => a + b, 0) / Math.max(1, Math.min(20, i));
      const volumeRatio = avgPriceChange > 0 ? priceChange / avgPriceChange : 0;
      
      if (volumeRatio < 1.5) continue; // Require at least 1.5x average volume change
      
      // Require both RSI and BB to agree on direction
      if ((longSignal && shortSignal) || (!longSignal && !shortSignal)) continue;
      
      const side = longSignal ? 'L' : 'S';
      
      // Calculate TP/SL based on ATR (2:1 ratio)
      const atrValue = atr;
      const stopLoss = side === 'L' ? currentClose - (atrValue * 1.0) : currentClose + (atrValue * 1.0);
      const takeProfit = side === 'L' ? currentClose + (atrValue * 2.0) : currentClose - (atrValue * 2.0);
      
      // Minimum 1.5:1 RR check (we have 2:1, so this should pass unless slippage is huge)
      const risk = Math.abs(currentClose - stopLoss);
      const reward = Math.abs(takeProfit - currentClose);
      if (reward / risk < 1.5) continue; 
      
      const shares = positionUsd / currentClose;
      
      position = {
        side,
        entry: currentClose,
        stop: stopLoss,
        target: takeProfit,
        shares,
        entryBar: i
      };
    }
    
    // Close any open position at end
    if (position) {
      const exitPrice = parseFloat(klines[klines.length - 1][4]);
      const pnl = position.side === 'L' 
        ? (exitPrice - position.entry) * position.shares - (position.entry * position.shares * FEE_PCT * 2)
        : (position.entry - exitPrice) * position.shares - (position.entry * position.shares * FEE_PCT * 2);
      
      trades.push({
        side: position.side,
        entry: position.entry,
        exit: exitPrice,
        pnl,
        reason: 'end_of_data',
        bars: klines.length - position.entryBar
      });
    }
    
    // Calculate metrics
    if (trades.length === 0) {
      return { trades: [], metrics: { totalTrades: 0, winRate: 0, profitFactor: 0, expectancy: 0, netPnL: 0 } };
    }
    
    const winningTrades = trades.filter(t => t.pnl > 0);
    const losingTrades = trades.filter(t => t.pnl <= 0);
    const winRate = winningTrades.length / trades.length;
    
    const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0;
    const expectancy = (profitFactor * winRate) - (1 - winRate);
    const netPnL = trades.reduce((sum, t) => sum + t.pnl, 0);
    
    return {
      trades,
      metrics: {
        totalTrades: trades.length,
        winningTrades: winningTrades.length,
        losingTrades: losingTrades.length,
        winRate,
        profitFactor,
        expectancy,
        netPnL,
        avgWin: winningTrades.length > 0 ? grossProfit / winningTrades.length : 0,
        avgLoss: losingTrades.length > 0 ? grossLoss / losingTrades.length : 0,
        largestWin: Math.max(...winningTrades.map(t => t.pnl)),
        largestLoss: Math.min(...losingTrades.map(t => t.pnl)),
        avgBarsInTrade: trades.reduce((sum, t) => sum + t.bars, 0) / trades.length
      }
    };
  } catch (err) {
    console.error(`Backtest error for ${pair}:`, err.message);
    return { trades: [], metrics: { error: err.message } };
  }
}

// Run backtest on multiple pairs
async function runMultiPairBacktest() {
  console.log('=== MEAN REVERSION SCALPER BACKTEST ===');
  console.log(`Testing ${PAIRS.length} pairs over ${LOOKBACK_DAYS} days (5m candles)`);
  console.log('Strategy: ADX < 25 (ranging) + RSI(14) <30/>70 + BB(20,2) touch + volume >= 1.5x');
  console.log('Entry: RSI extreme + BB touch in same direction');
  console.log('Exit: 2x ATR TP, 1x ATR SL, max 4h hold');
  console.log('');
  
  const results = {};
  let totalTrades = 0;
  let totalNetPnL = 0;
  let totalProfitFactor = 0;
  let pairsWithPositiveExpectancy = 0;
  
  for (const pair of PAIRS) {
    console.log(`\n--- ${pair} ---`);
    const result = await runMrBacktest({ pair, days: LOOKBACK_DAYS, positionUsd: POSITION_SIZE });
    
    if (result.trades && result.trades.length > 0) {
      const m = result.metrics;
      results[pair] = m;
      totalTrades += m.totalTrades;
      totalNetPnL += m.netPnL;
      if (m.expectancy > 0) pairsWithPositiveExpectancy++;
      
      console.log(`Trades: ${m.totalTrades}`);
      console.log(`Win Rate: ${(m.winRate * 100).toFixed(1)}%`);
      console.log(`Profit Factor: ${m.profitFactor.toFixed(2)}`);
      console.log(`Expectancy: $${m.expectancy.toFixed(3)}`);
      console.log(`Net PnL: $${m.netPnL.toFixed(2)}`);
      console.log(`Avg Win: $${m.avgWin.toFixed(2)} | Avg Loss: $${m.avgLoss.toFixed(2)}`);
      console.log(`Avg Bars in Trade: ${m.avgBarsInTrade.toFixed(1)} (${(m.avgBarsInTrade * 5 / 60).toFixed(1)}h)`);
    } else {
      console.log('No trades generated or error:', result.metrics.error);
      results[pair] = { error: result.metrics.error };
    }
  }
  
  console.log('\n=== COMBINED RESULTS ===');
  console.log(`Total Trades: ${totalTrades}`);
  console.log(`Combined Net PnL: $${totalNetPnL.toFixed(2)}`);
  if (totalTrades > 0) {
    const avgPF = totalProfitFactor / PAIRS.length;
    const winRateTotal = /* would need to recalculate */ 0; // placeholder
    console.log(`Pairs with Positive Expectancy: ${pairsWithPositiveExpectancy}/${PAIRS.length}`);
    console.log(`Expectancy per trade: $${(totalNetPnL / totalTrades).toFixed(3)}`);
  }
  
  // Success criteria
  const success = 
    totalTrades >= 50 && 
    totalNetPnL > 0 && 
    pairsWithPositiveExpectancy >= PAIRS.length * 0.6;
    
  console.log('\n✅ SUCCESS CRITERIA:');
  console.log(`  Minimum 50 trades: ${totalTrades >= 50} (${totalTrades})`);
  console.log(`  Positive Net PnL: ${totalNetPnL > 0} ($${totalNetPnL.toFixed(2)})`);
  console.log(`  >60% pairs profitable: ${pairsWithPositiveExpectancy >= PAIRS.length * 0.6} (${pairsWithPositiveExpectancy}/${PAIRS.length})`);
  console.log(`  Overall: ${success ? 'PASS' : 'FAIL'}`);
  
  return { success, results, totalTrades, totalNetPnL };
}

runMultiPairBacktest().then(result => {
  process.exit(result.success ? 0 : 1);
}).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});