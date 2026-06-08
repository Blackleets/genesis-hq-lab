import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchKlines } from './historicalData.mjs';
import { runBacktest } from './backtestEngine.mjs';
import { computeMetrics } from './metrics.mjs';
import { DEFAULTS, getParams } from '../strategyParams.mjs';
import { evaluateSignal } from '../signal.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const RESULTS_PATH = join(__dir, '..', '..', '..', 'data', 'backtest', 'results', 'crypto-strategy-lab.json');

export const LAB_THRESHOLDS = Object.freeze({
  minTrainTrades: 200,
  minTestTrades: 80,
  minProfitFactor: 1.1,
  maxBucketShare: 0.5,
});

function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}

function toFiniteNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function resample(closes, step) {
  if (!Array.isArray(closes) || closes.length === 0) return [];
  if (!Number.isFinite(step) || step <= 1) return [...closes];
  const out = [];
  for (let index = step - 1; index < closes.length; index += step) out.push(closes[index]);
  return out;
}

function computeSimpleEma(values, period) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const factor = 2 / (period + 1);
  let ema = values[0];
  for (let index = 1; index < values.length; index++) ema = values[index] * factor + ema * (1 - factor);
  return ema;
}

function computeSimpleRsi(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let index = closes.length - period; index < closes.length; index++) {
    const diff = closes[index] - closes[index - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return gains === 0 ? 50 : 100;
  const rs = (gains / period) / (losses / period);
  return round6(100 - 100 / (1 + rs));
}

function computeTrendFeatures(ctx, params = {}) {
  const closes = Array.isArray(ctx?.closes) ? ctx.closes : [];
  const frame = params.trendFrameMinutes ?? 60;
  const sampled = resample(closes, frame);
  const priceSeries = sampled.length >= 30 ? sampled : closes;
  const fast = computeSimpleEma(priceSeries, params.trendFastPeriod ?? 9);
  const slow = computeSimpleEma(priceSeries, params.trendSlowPeriod ?? 21);
  const rsi = computeSimpleRsi(priceSeries, 14);
  const momentumLookback = Math.min(priceSeries.length - 1, params.trendMomentumBars ?? 6);
  const momentum = momentumLookback > 0
    ? ((priceSeries[priceSeries.length - 1] - priceSeries[priceSeries.length - 1 - momentumLookback]) / priceSeries[priceSeries.length - 1 - momentumLookback]) * 100
    : 0;
  const margin = params.trendMarginPct ?? 0.001;
  return { fast, slow, rsi, momentum, margin };
}

export function trendContinuationSignal(ctx, params = {}) {
  const { fast, slow, rsi, momentum, margin } = computeTrendFeatures(ctx, params);
  const minMomentum = params.trendMomentumPct ?? 0.6;
  const scoreBase = Math.min(0.95, 0.7 + Math.abs(momentum) / 20);
  if (fast > slow * (1 + margin) && momentum >= minMomentum && rsi >= 52 && rsi <= (params.trendRsiMax ?? 72)) {
    return { action: 'TRADE', side: 'LONG', confidence: round6(scoreBase), score: round6(scoreBase), reasons: ['trend_continuation_long'] };
  }
  if (fast < slow * (1 - margin) && momentum <= -minMomentum && rsi <= 48 && rsi >= (params.trendRsiMin ?? 28)) {
    return { action: 'TRADE', side: 'SHORT', confidence: round6(scoreBase), score: round6(scoreBase), reasons: ['trend_continuation_short'] };
  }
  return { action: 'SKIP', side: null, confidence: 0, score: 0, reasons: ['trend_not_aligned'] };
}

export function meanReversionSignal(ctx, params = {}) {
  const closes = Array.isArray(ctx?.closes) ? ctx.closes : [];
  const frame = params.reversionFrameMinutes ?? 60;
  const sampled = resample(closes, frame);
  const priceSeries = sampled.length >= 30 ? sampled : closes;
  const last = priceSeries[priceSeries.length - 1] ?? ctx?.price ?? 0;
  const mean = computeSimpleEma(priceSeries, params.reversionMeanPeriod ?? 21);
  const rsi = computeSimpleRsi(priceSeries, 14);
  const deviation = mean > 0 ? (last - mean) / mean : 0;
  const stretch = params.reversionDeviationPct ?? 0.02;
  const confidence = round6(Math.min(0.92, 0.7 + Math.abs(deviation) * 4));
  if (deviation <= -stretch && rsi <= (params.reversionRsiOversold ?? 32)) {
    return { action: 'TRADE', side: 'LONG', confidence, score: confidence, reasons: ['mean_reversion_long'] };
  }
  if (deviation >= stretch && rsi >= (params.reversionRsiOverbought ?? 68)) {
    return { action: 'TRADE', side: 'SHORT', confidence, score: confidence, reasons: ['mean_reversion_short'] };
  }
  return { action: 'SKIP', side: null, confidence: 0, score: 0, reasons: ['no_reversion_extreme'] };
}

export function bucketConcentration(trades, bucketFn) {
  const totalNetPnl = trades.reduce((sum, trade) => sum + toFiniteNumber(trade.pnl, 0), 0);
  if (trades.length === 0 || totalNetPnl <= 0) {
    return { share: 0, bucket: null, netPnl: round6(totalNetPnl), buckets: [] };
  }
  const buckets = new Map();
  for (const trade of trades) {
    const key = bucketFn(trade);
    const bucket = buckets.get(key) ?? { bucket: key, netPnl: 0, trades: 0 };
    bucket.netPnl += toFiniteNumber(trade.pnl, 0);
    bucket.trades += 1;
    buckets.set(key, bucket);
  }
  const positiveContribution = [...buckets.values()].reduce((sum, entry) => sum + Math.max(0, entry.netPnl), 0);
  if (positiveContribution <= 0) {
    return { share: 0, bucket: null, netPnl: round6(totalNetPnl), buckets: [] };
  }
  const ranked = [...buckets.values()]
    .map((entry) => ({ ...entry, netPnl: round6(entry.netPnl), share: entry.netPnl > 0 ? round6(entry.netPnl / positiveContribution) : 0 }))
    .sort((left, right) => right.netPnl - left.netPnl);
  const top = ranked[0] ?? null;
  return {
    share: top?.share ?? 0,
    bucket: top?.bucket ?? null,
    netPnl: top?.netPnl ?? 0,
    buckets: ranked,
  };
}

function hourBucket(openTime) {
  const iso = typeof openTime === 'number' ? openTime : Date.parse(openTime ?? '');
  if (!Number.isFinite(iso)) return 'unknown';
  return String(new Date(iso).getUTCHours()).padStart(2, '0');
}

export function evaluateExperimentResult(result, thresholds = LAB_THRESHOLDS) {
  const trainPf = result.train.profitFactor ?? 0;
  const testPf = result.test.profitFactor ?? 0;
  const hourConcentration = result.concentration?.hour ?? { share: 0, bucket: null };
  const sideConcentration = result.concentration?.side ?? { share: 0, bucket: null };

  if (result.test.expectancy <= 0) return { passed: false, rejectReason: `test expectancy ${result.test.expectancy} <= 0` };
  if (testPf <= 1) return { passed: false, rejectReason: `test profit factor ${testPf} <= 1` };
  if (result.train.expectancy <= 0) return { passed: false, rejectReason: `train expectancy ${result.train.expectancy} <= 0` };
  if (trainPf <= 1) return { passed: false, rejectReason: `train profit factor ${trainPf} <= 1` };
  if (result.train.trades < thresholds.minTrainTrades) return { passed: false, rejectReason: `train trades ${result.train.trades} < ${thresholds.minTrainTrades}` };
  if (result.test.trades < thresholds.minTestTrades) return { passed: false, rejectReason: `test trades ${result.test.trades} < ${thresholds.minTestTrades}` };
  if (trainPf <= thresholds.minProfitFactor) return { passed: false, rejectReason: `train profit factor ${trainPf} <= ${thresholds.minProfitFactor}` };
  if (testPf <= thresholds.minProfitFactor) return { passed: false, rejectReason: `test profit factor ${testPf} <= ${thresholds.minProfitFactor}` };
  if (hourConcentration.share > thresholds.maxBucketShare) {
    return { passed: false, rejectReason: `hour bucket ${hourConcentration.bucket} contributes ${(hourConcentration.share * 100).toFixed(1)}% of test net pnl` };
  }
  if (sideConcentration.share > thresholds.maxBucketShare) {
    return { passed: false, rejectReason: `side slice ${sideConcentration.bucket} contributes ${(sideConcentration.share * 100).toFixed(1)}% of test net pnl` };
  }
  return { passed: true, rejectReason: null };
}

function splitSeries(klines, trainSplit) {
  const splitIndex = Math.max(1, Math.min(klines.length - 1, Math.floor(klines.length * trainSplit)));
  return {
    train: klines.slice(0, splitIndex),
    test: klines.slice(splitIndex),
  };
}

function runSliceBacktest(klinesByPair, experiment, rangeKey) {
  const combinedTrades = [];
  for (const [pair, klines] of Object.entries(klinesByPair)) {
    const { train, test } = splitSeries(klines, experiment.trainSplit);
    const slice = rangeKey === 'train' ? train : test;
    const params = {
      ...experiment.signalParams,
      targetPct: experiment.targetPct,
      stopPct: experiment.stopPct,
      timeoutHours: experiment.timeoutHours,
    };
    const { trades } = runBacktest(slice, params, {
      signalFn: experiment.signalFn,
      warmup: experiment.warmup,
    });
    combinedTrades.push(...trades.map((trade) => ({ ...trade, pair })));
  }
  return {
    trades: combinedTrades,
    metrics: computeMetrics(combinedTrades),
  };
}

export async function runStrategyExperiment(experiment, deps = {}) {
  const fetchKlinesFn = deps.fetchKlinesFn ?? fetchKlines;
  const klinesByPair = {};
  for (const pair of experiment.pairSet) {
    klinesByPair[pair] = await fetchKlinesFn(pair, { days: experiment.days, interval: experiment.interval });
  }

  const trainSlice = runSliceBacktest(klinesByPair, experiment, 'train');
  const testSlice = runSliceBacktest(klinesByPair, experiment, 'test');
  const result = {
    id: experiment.id,
    hypothesis: experiment.hypothesis,
    pairSet: [...experiment.pairSet],
    interval: experiment.interval,
    params: {
      targetPct: experiment.targetPct,
      stopPct: experiment.stopPct,
      timeoutHours: experiment.timeoutHours,
    },
    train: trainSlice.metrics,
    test: testSlice.metrics,
    concentration: {
      hour: bucketConcentration(testSlice.trades, (trade) => hourBucket(trade.openTime)),
      side: bucketConcentration(testSlice.trades, (trade) => trade.side ?? 'UNKNOWN'),
    },
  };
  const verdict = evaluateExperimentResult(result);
  return { ...result, ...verdict };
}

export function buildStrategyLabExperiments({ baselineParams = DEFAULTS } = {}) {
  const liveParams = { ...DEFAULTS, ...baselineParams };
  return [
    {
      id: 'single-pair-btc-1m-baseline',
      hypothesis: 'single_pair',
      pairSet: ['BTCUSDT'],
      interval: '1m',
      days: 45,
      targetPct: liveParams.targetPct,
      stopPct: liveParams.stopPct,
      timeoutHours: liveParams.timeoutHours,
      signalFn: null,
      signalParams: { ...liveParams },
      warmup: 320,
      trainSplit: 0.7,
      minTrades: LAB_THRESHOLDS.minTestTrades,
    },
    {
      id: 'single-pair-btc-1h-baseline',
      hypothesis: 'single_pair',
      pairSet: ['BTCUSDT'],
      interval: '1h',
      days: 365,
      targetPct: liveParams.targetPct,
      stopPct: liveParams.stopPct,
      timeoutHours: 24,
      signalFn: null,
      signalParams: { ...liveParams, timeoutHours: 24 },
      warmup: 120,
      trainSplit: 0.7,
      minTrades: LAB_THRESHOLDS.minTestTrades,
    },
    {
      id: 'single-pair-btc-4h-baseline',
      hypothesis: 'single_pair',
      pairSet: ['BTCUSDT'],
      interval: '4h',
      days: 730,
      targetPct: liveParams.targetPct,
      stopPct: liveParams.stopPct,
      timeoutHours: 96,
      signalFn: null,
      signalParams: { ...liveParams, timeoutHours: 96 },
      warmup: 120,
      trainSplit: 0.7,
      minTrades: LAB_THRESHOLDS.minTestTrades,
    },
    ...[
      ['1h', 365, 24, 60],
      ['4h', 730, 96, 240],
    ].flatMap(([interval, days, timeoutHours, trendFrameMinutes]) => ([
      [0.03, 0.015],
      [0.04, 0.02],
      [0.06, 0.02],
      [0.06, 0.03],
      [0.08, 0.03],
    ].map(([targetPct, stopPct]) => ({
      id: `trend-btc-${interval}-tp${Math.round(targetPct * 1000)}-sl${Math.round(stopPct * 1000)}`,
      hypothesis: 'trend',
      pairSet: ['BTCUSDT'],
      interval,
      days,
      targetPct,
      stopPct,
      timeoutHours,
      signalFn: trendContinuationSignal,
      signalParams: { trendFrameMinutes, trendMomentumPct: interval === '1h' ? 0.5 : 1.2 },
      warmup: 120,
      trainSplit: 0.7,
      minTrades: LAB_THRESHOLDS.minTestTrades,
    }))),
    ),
    ...[
      ['1h', 365, 24, 60],
      ['4h', 730, 48, 240],
    ].flatMap(([interval, days, timeoutHours, reversionFrameMinutes]) => ([
      [0.02, 0.02],
      [0.03, 0.02],
      [0.03, 0.03],
      [0.04, 0.03],
    ].map(([targetPct, stopPct]) => ({
      id: `reversion-btc-${interval}-tp${Math.round(targetPct * 1000)}-sl${Math.round(stopPct * 1000)}`,
      hypothesis: 'reversion',
      pairSet: ['BTCUSDT'],
      interval,
      days,
      targetPct,
      stopPct,
      timeoutHours,
      signalFn: meanReversionSignal,
      signalParams: {
        reversionFrameMinutes,
        reversionDeviationPct: interval === '1h' ? 0.015 : 0.025,
        reversionRsiOversold: 32,
        reversionRsiOverbought: 68,
      },
      warmup: 120,
      trainSplit: 0.7,
      minTrades: LAB_THRESHOLDS.minTestTrades,
    }))),
    ),
  ].map((experiment) => ({
    ...experiment,
    signalFn: experiment.signalFn ?? evaluateSignal,
  }));
}

export async function runStrategyLab({ experiments, baselineParams, fetchKlinesFn } = {}) {
  const candidateExperiments = experiments ?? buildStrategyLabExperiments({ baselineParams: baselineParams ?? getParams() });
  const results = [];
  for (const experiment of candidateExperiments) {
    results.push(await runStrategyExperiment(experiment, { fetchKlinesFn }));
  }
  const ranked = [...results].sort((left, right) => {
    if (right.test.expectancy !== left.test.expectancy) return right.test.expectancy - left.test.expectancy;
    return (right.test.profitFactor ?? 0) - (left.test.profitFactor ?? 0);
  });
  return {
    generatedAt: new Date().toISOString(),
    thresholds: LAB_THRESHOLDS,
    winner: ranked.find((result) => result.passed) ?? null,
    results: ranked,
  };
}

export function writeStrategyLabReport(report, outputPath = RESULTS_PATH) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');
  return outputPath;
}
