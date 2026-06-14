// chartAnalysis.ts — pure auto-analysis over candles for the "AUTO" draw mode.
// Detects swing pivots, clusters them into support/resistance levels ranked by
// touches, and fits diagonal trend lines from recent swing highs/lows. No React.

import type { OHLC } from './chartIndicators';

export interface Pivot {
  index: number;
  time: number;
  price: number;
  kind: 'high' | 'low';
}

export interface AutoLevel {
  price: number;
  kind: 'support' | 'resistance';
  touches: number;
  strength: number; // 0..1, normalized by max touches in the set
}

export interface AutoTrendLine {
  kind: 'support' | 'resistance';
  t1: number; p1: number;
  t2: number; p2: number;
}

export interface AutoAnalysis {
  levels: AutoLevel[];
  trends: AutoTrendLine[];
}

/** Swing pivots: a bar is a swing-high if its high is the max within ±window. */
export function findPivots(candles: OHLC[], window = 5): Pivot[] {
  const pivots: Pivot[] = [];
  for (let i = window; i < candles.length - window; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) pivots.push({ index: i, time: candles[i].time, price: candles[i].high, kind: 'high' });
    if (isLow) pivots.push({ index: i, time: candles[i].time, price: candles[i].low, kind: 'low' });
  }
  return pivots;
}

/**
 * Cluster pivot prices into horizontal levels. Prices within `tolPct` of each
 * other count as the same level; touch count drives the ranking.
 */
export function detectLevels(
  pivots: Pivot[],
  lastPrice: number,
  tolPct = 0.004,
  maxLevels = 6,
): AutoLevel[] {
  if (pivots.length === 0 || !Number.isFinite(lastPrice)) return [];
  const tol = lastPrice * tolPct;
  const clusters: { sum: number; count: number }[] = [];
  for (const p of pivots) {
    const hit = clusters.find((c) => Math.abs(c.sum / c.count - p.price) <= tol);
    if (hit) { hit.sum += p.price; hit.count += 1; }
    else clusters.push({ sum: p.price, count: 1 });
  }
  const maxTouches = Math.max(...clusters.map((c) => c.count));
  return clusters
    .map((c) => {
      const price = c.sum / c.count;
      return {
        price,
        kind: (price >= lastPrice ? 'resistance' : 'support') as AutoLevel['kind'],
        touches: c.count,
        strength: c.count / maxTouches,
      };
    })
    .filter((l) => l.touches >= 2)
    .sort((a, b) => b.touches - a.touches)
    .slice(0, maxLevels);
}

/** Fit a trend line through the last `n` swing highs (resistance) and lows (support). */
export function detectTrendLines(pivots: Pivot[], n = 3): AutoTrendLine[] {
  const out: AutoTrendLine[] = [];
  const build = (kind: 'high' | 'low'): AutoTrendLine | null => {
    const pts = pivots.filter((p) => p.kind === kind).slice(-n);
    if (pts.length < 2) return null;
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (b.time === a.time) return null;
    return {
      kind: kind === 'high' ? 'resistance' : 'support',
      t1: a.time, p1: a.price,
      t2: b.time, p2: b.price,
    };
  };
  const res = build('high');
  const sup = build('low');
  if (res) out.push(res);
  if (sup) out.push(sup);
  return out;
}

/** Full auto analysis used by the chart's AUTO layer. */
export function analyzeChart(candles: OHLC[], window = 5): AutoAnalysis {
  if (candles.length < window * 2 + 2) return { levels: [], trends: [] };
  const pivots = findPivots(candles, window);
  const lastPrice = candles[candles.length - 1].close;
  return {
    levels: detectLevels(pivots, lastPrice),
    trends: detectTrendLines(pivots),
  };
}
