const EPS = 1e-12;

export const DEFAULT_LIQUIDITY_POLICY = Object.freeze({
  minTvlUsd: 50_000,
  minVolume24hUsd: 100_000,
  feeCaptureHaircut: 0.65,
  ilReserveMultiplier: 1.5,
  rangeHalfWidthPct: 5,
  rebalanceCostBps: 3,
  operationalReserveBps: 1.5,
  minForwardSamples: 48,
  minProfitFactor: 1.15,
  minTStat: 1.0,
  maxDrawdownPct: 8,
  minEvidenceQuality: 0.75,
});

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function impermanentLossBps(priceRatio) {
  const r = num(priceRatio);
  if (!(r > 0)) return null;
  const value = 2 * Math.sqrt(r) / (1 + r) - 1;
  return Math.abs(value) * 10_000;
}

export function scoreLiquiditySnapshot(input = {}, policy = {}) {
  const p = { ...DEFAULT_LIQUIDITY_POLICY, ...policy };
  const tvlUsd = num(input.tvlUsd);
  const fees24hUsd = num(input.fees24hUsd);
  const volume24hUsd = num(input.volume24hUsd);
  const priceChange24hPct = num(input.priceChange24hPct);
  const priceUsd = num(input.priceUsd);
  const officialSource = input.officialSource === true;

  const dailyFeeYieldBps = tvlUsd > 0 && fees24hUsd >= 0 ? fees24hUsd / tvlUsd * 10_000 : null;
  const capturedFeeYieldBps = dailyFeeYieldBps == null ? null : dailyFeeYieldBps * p.feeCaptureHaircut;
  const turnover24h = tvlUsd > 0 && volume24hUsd >= 0 ? volume24hUsd / tvlUsd : null;

  let ilStressBps = null;
  let rebalanceReserveBps = null;
  if (priceChange24hPct != null && priceChange24hPct > -99.9) {
    const ratio = 1 + priceChange24hPct / 100;
    const baseIl = impermanentLossBps(ratio);
    ilStressBps = baseIl == null ? null : baseIl * p.ilReserveMultiplier;
    const overflowPct = Math.max(0, Math.abs(priceChange24hPct) - p.rangeHalfWidthPct);
    rebalanceReserveBps = overflowPct > 0 ? p.rebalanceCostBps * (1 + overflowPct / p.rangeHalfWidthPct) : 0;
  }

  const stressKnown = capturedFeeYieldBps != null && ilStressBps != null && rebalanceReserveBps != null;
  const expectedNetStressBps = stressKnown
    ? capturedFeeYieldBps - ilStressBps - rebalanceReserveBps - p.operationalReserveBps
    : null;

  const checks = {
    officialSource,
    tvl: tvlUsd != null && tvlUsd >= p.minTvlUsd,
    volume: volume24hUsd != null && volume24hUsd >= p.minVolume24hUsd,
    fees: fees24hUsd != null && fees24hUsd > 0,
    price: priceUsd != null && priceUsd > 0,
    volatilityEvidence: priceChange24hPct != null,
    netStressPositive: expectedNetStressBps != null && expectedNetStressBps > 0,
  };

  return {
    ...input,
    tvlUsd,
    fees24hUsd,
    volume24hUsd,
    priceUsd,
    priceChange24hPct,
    dailyFeeYieldBps,
    capturedFeeYieldBps,
    turnover24h,
    ilStressBps,
    rebalanceReserveBps,
    operationalReserveBps: p.operationalReserveBps,
    expectedNetStressBps,
    screenPass: Object.values(checks).every(Boolean),
    checks,
  };
}

export function shouldScoreLiquidityForwardWindow(previous, current) {
  return previous?.screenPass === true &&
    previous?.officialSource === true &&
    current?.officialSource === true;
}

export function forwardLiquidityWindow(previous, current, elapsedHours, policy = {}) {
  const p = { ...DEFAULT_LIQUIDITY_POLICY, ...policy };
  const prevPrice = num(previous?.priceUsd);
  const currPrice = num(current?.priceUsd);
  const dailyFeeYieldBps = num(previous?.dailyFeeYieldBps);
  const hours = num(elapsedHours);
  if (!(prevPrice > 0) || !(currPrice > 0) || !(hours > 0) || dailyFeeYieldBps == null) return null;

  const ratio = currPrice / prevPrice;
  const priceMovePct = (ratio - 1) * 100;
  const feeAccrualBps = dailyFeeYieldBps * p.feeCaptureHaircut * Math.min(hours, 24) / 24;
  const ilBps = (impermanentLossBps(ratio) ?? 0) * p.ilReserveMultiplier;
  const outOfRange = Math.abs(priceMovePct) > p.rangeHalfWidthPct;
  const rebalanceBps = outOfRange ? p.rebalanceCostBps : 0;
  const operationalBps = p.operationalReserveBps * Math.min(hours, 24) / 24;
  const netBps = feeAccrualBps - ilBps - rebalanceBps - operationalBps;

  return {
    venue: previous.venue,
    poolAddress: previous.poolAddress,
    symbol: previous.symbol,
    startAt: previous.observedAt,
    endAt: current.observedAt,
    elapsedHours: hours,
    feeAccrualBps,
    ilBps,
    rebalanceBps,
    operationalBps,
    priceMovePct,
    outOfRange,
    netBps,
    officialSource: previous.officialSource === true && current.officialSource === true,
  };
}

export function liquidityForwardStats(windows = []) {
  const pnl = windows.map((x) => num(x?.netBps)).filter((x) => x != null);
  const wins = pnl.filter((x) => x > 0);
  const losses = pnl.filter((x) => x < 0);
  const grossProfit = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  const mean = pnl.length ? pnl.reduce((a, b) => a + b, 0) / pnl.length : null;
  let variance = null;
  if (pnl.length >= 2 && mean != null) {
    variance = pnl.reduce((s, x) => s + (x - mean) ** 2, 0) / (pnl.length - 1);
  }
  const sd = variance != null ? Math.sqrt(Math.max(0, variance)) : null;
  const tStat = mean != null && sd > EPS ? mean / (sd / Math.sqrt(pnl.length)) : null;

  let curve = 0, peak = 0, maxDrawdownBps = 0;
  for (const value of pnl) {
    curve += value;
    peak = Math.max(peak, curve);
    maxDrawdownBps = Math.max(maxDrawdownBps, peak - curve);
  }

  return {
    samples: pnl.length,
    expectancyBps: mean,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 99 : null),
    tStat,
    winRate: pnl.length ? wins.length / pnl.length : null,
    maxDrawdownPct: maxDrawdownBps / 100,
    totalNetBps: pnl.reduce((a, b) => a + b, 0),
  };
}

export function buildLiquiditySleeve(windows = [], { officialObservationRatio = 0, policy = {} } = {}) {
  const p = { ...DEFAULT_LIQUIDITY_POLICY, ...policy };
  const stats = liquidityForwardStats(windows);
  const evidenceQuality = Math.min(0.95,
    0.35 +
    Math.min(stats.samples, 96) / 240 +
    Math.max(0, Math.min(1, officialObservationRatio)) * 0.20
  );
  const paperCapitalEligible =
    stats.samples >= p.minForwardSamples &&
    stats.expectancyBps > 0 &&
    (stats.profitFactor ?? 0) >= p.minProfitFactor &&
    (stats.tStat ?? -Infinity) >= p.minTStat &&
    stats.maxDrawdownPct <= p.maxDrawdownPct &&
    evidenceQuality >= p.minEvidenceQuality &&
    officialObservationRatio >= 0.95;

  return {
    sleeveKey: 'SOLANA_LIQUIDITY',
    engineVersion: 'solana_liquidity_lab_v3_no_survivorship',
    samples: stats.samples,
    expectancyBps: stats.expectancyBps,
    profitFactor: stats.profitFactor,
    tStat: stats.tStat,
    maxDrawdownPct: stats.maxDrawdownPct,
    evidenceQuality,
    paperCapitalEligible,
    forwardProxy: true,
    liveEligible: false,
  };
}
