// technicalIndicators.mjs - Helper functions for technical analysis calculations

/**
 * Calculate Average True Range (ATR)
 * @param {Array} highs - Array of high prices
 * @param {Array} lows - Array of low prices
 * @param {Array} closes - Array of close prices
 * @param {number} period - Lookback period
 * @returns {number} ATR value
 */
export function calculateAtR(highs, lows, closes, period) {
  if (!Array.isArray(highs) || !Array.isArray(lows) || !Array.isArray(closes) || 
      highs.length < period + 1 || lows.length < period + 1 || closes.length < period + 1) {
    return 0;
  }
  
  let trSum = 0;
  for (let i = 1; i <= period; i++) {
    const idx = highs.length - i;
    const high = parseFloat(highs[idx]);
    const low = parseFloat(lows[idx]);
    const close = parseFloat(closes[idx - 1]);
    
    const tr1 = high - low;
    const tr2 = Math.abs(high - close);
    const tr3 = Math.abs(low - close);
    const tr = Math.max(tr1, tr2, tr3);
    trSum += tr;
  }
  return trSum / period;
}

/**
 * Calculate Bollinger Bands
 * @param {Array} closes - Array of close prices
 * @param {number} period - Moving average period
 * @param {number} stdDev - Standard deviation multiplier
 * @returns {Object} { upper, middle, lower }
 */
export function calculateBollingerBands(closes, period = 20, stdDev = 2) {
  if (!Array.isArray(closes) || closes.length < period) {
    const price = closes.length > 0 ? parseFloat(closes[closes.length - 1]) : 0;
    return { upper: price, middle: price, lower: price };
  }
  
  const slice = closes.slice(-period);
  const sum = slice.reduce((acc, price) => acc + parseFloat(price), 0);
  const mean = sum / period;
  
  const variance = slice.reduce((acc, price) => {
    const val = parseFloat(price);
    return acc + Math.pow(val - mean, 2);
  }, 0) / period;
  
  const std = Math.sqrt(variance);
  
  return {
    upper: mean + (stdDev * std),
    middle: mean,
    lower: mean - (stdDev * std)
  };
}

/**
 * Calculate Relative Strength Index (RSI)
 * @param {Array} closes - Array of close prices
 * @param {number} period - Lookback period (default 14)
 * @returns {number} RSI value (0-100)
 */
export function calculateRsi(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length < period + 1) {
    return 50; // Neutral RSI when insufficient data
  }
  
  const slice = closes.slice(-(period + 1)).map(p => parseFloat(p));
  let gains = 0;
  let losses = 0;
  
  for (let i = 1; i < slice.length; i++) {
    const change = slice[i] - slice[i-1];
    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }
  
  const avgGain = gains / period;
  const avgLoss = losses / period;
  
  if (avgLoss === 0) return 100;
  
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * Calculate Average Directional Index (ADX)
 * Simplified version for trend strength detection
 * @param {Array} highs - Array of high prices
 * @param {Array} lows - Array of low prices
 * @param {Array} closes - Array of close prices
 * @param {number} period - Lookback period
 * @returns {number} ADX value (0-100)
 */
export function calculateAdx(highs, lows, closes, period = 14) {
  if (!highs || !lows || !closes || highs.length < period) return 25;
  
  // For simplicity in this implementation, we'll use a simplified volatility-based approach
  // A full ADX implementation is complex, so we'll approximate with volatility ratio
  
  const lookback = period * 2;
  const hSlice = slice(highs, lookback);
  const lSlice = slice(lows, lookback);
  const cSlice = slice(closes, lookback);
  
  // Calculate true ranges
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
  
  // Simplified: just return current DX as approximation of ADX
  // In reality ADX is smoothed DX, but this gives us directional bias
  return dx;
}

// Helper: safe array slice
function slices(arr, start) {
  return Array.isArray(arr) && arr.length > start ? arr.slice(start) : [];
}

// Helper: safe array slice from end
function slice(arr, count) {
  return Array.isArray(arr) && arr.length >= count ? arr.slice(-count) : [];
}