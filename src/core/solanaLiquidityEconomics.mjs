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

export function solanaOperationCostBps({
  baseFeeLamports,
  priorityFeeLamports,
  solUsd,
  txCount = 1,
  notionalUsd,
} = {}) {
  const base = num(baseFeeLamports);
  const priority = num(priorityFeeLamports);
  const sol = num(solUsd);
  const txs = num(txCount);
  const notional = num(notionalUsd);
  if (base == null || priority == null || !(sol > 0) || !(txs > 0) || !(notional > 0)) return null;
  const totalLamports = (Math.max(0, base) + Math.max(0, priority)) * txs;
  const totalUsd = totalLamports / 1_000_000_000 * sol;
  return {
    totalLamports,
    totalUsd,
    bps: totalUsd / notional * 10_000,
  };
}

export function lpBreakEvenHoldDays({
  capturedFeeYieldBps,
  ilStressBps = 0,
  rebalanceReserveBps = 0,
  roundTripCostBps,
} = {}) {
  const fees = num(capturedFeeYieldBps);
  const il = num(ilStressBps);
  const rebalance = num(rebalanceReserveBps);
  const roundTrip = num(roundTripCostBps);
  if (fees == null || il == null || rebalance == null || roundTrip == null || roundTrip < 0) return null;
  const preOperationalNetBpsPerDay = fees - il - rebalance;
  if (!(preOperationalNetBpsPerDay > 0)) return {
    preOperationalNetBpsPerDay,
    breakEvenHoldDays: null,
  };
  return {
    preOperationalNetBpsPerDay,
    breakEvenHoldDays: roundTrip / preOperationalNetBpsPerDay,
  };
}

export function measuredCostForwardEntry({
  candidate,
  roundTripCostBps,
  maxBreakEvenHoldDays = 1,
} = {}) {
  const checks = candidate?.checks ?? {};
  const structurallyValid =
    checks.officialSource === true &&
    checks.tvl === true &&
    checks.volume === true &&
    checks.fees === true &&
    checks.price === true &&
    checks.volatilityEvidence === true;

  const breakEven = lpBreakEvenHoldDays({
    capturedFeeYieldBps: candidate?.capturedFeeYieldBps,
    ilStressBps: candidate?.ilStressBps,
    rebalanceReserveBps: candidate?.rebalanceReserveBps,
    roundTripCostBps,
  });

  const breakEvenHoldDays = breakEven?.breakEvenHoldDays ?? null;
  const preOperationalNetBpsPerDay = breakEven?.preOperationalNetBpsPerDay ?? null;
  const pass =
    structurallyValid &&
    preOperationalNetBpsPerDay > 0 &&
    breakEvenHoldDays != null &&
    breakEvenHoldDays <= maxBreakEvenHoldDays;

  return {
    pass,
    structurallyValid,
    preOperationalNetBpsPerDay,
    breakEvenHoldDays,
    roundTripCostBps: num(roundTripCostBps),
    maxBreakEvenHoldDays,
    reason: !structurallyValid
      ? 'STRUCTURAL_EVIDENCE_INCOMPLETE'
      : !(preOperationalNetBpsPerDay > 0)
        ? 'PRE_OPERATIONAL_EDGE_NON_POSITIVE'
        : breakEvenHoldDays == null
          ? 'BREAK_EVEN_UNAVAILABLE'
          : breakEvenHoldDays > maxBreakEvenHoldDays
            ? 'BREAK_EVEN_TOO_SLOW'
            : 'MEASURED_COST_FORWARD_ENTRY_PASS',
  };
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
  const price = num(input.price ?? input.priceUsd);
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
    price: price != null && price > 0,
    volatilityEvidence: priceChange24hPct != null,
    netStressPositive: expectedNetStressBps != null && expectedNetStressBps > 0,
  };

  return {
    ...input,
    tvlUsd,
    fees24hUsd,
    volume24hUsd,
    price,
    priceUsd: price,
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
  const prevPrice = num(previous?.price ?? previous?.priceUsd);
  const currPrice = num(current?.price ?? current?.priceUsd);
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
  const networkRoundTripBps = Math.max(0, num(previous?.measuredRoundTripCostBps) ?? 0);
  const netBps = feeAccrualBps - ilBps - rebalanceBps - operationalBps - networkRoundTripBps;

  return {
    venue: previous.venue,
    poolAddress: previous.poolAddress,
    symbol: previous.symbol,
    pair: previous.pair ?? null,
    startAt: previous.observedAt,
    endAt: current.observedAt,
    elapsedHours: hours,
    feeAccrualBps,
    ilBps,
    rebalanceBps,
    operationalBps,
    networkRoundTripBps,
    priceMovePct,
    outOfRange,
    netBps,
    officialSource: previous.officialSource === true && current.officialSource === true,
  };
}

export function buildLiquidityHorizonWindows(history = [], options = {}) {
  const horizons = Array.isArray(options.horizonsHours) && options.horizonsHours.length
    ? options.horizonsHours.map(Number).filter((x) => x > 0)
    : [1, 2, 4, 8, 24];
  const toleranceFraction = Math.max(0.05, Number(options.toleranceFraction ?? 0.25));
  const minToleranceHours = Math.max(0.05, Number(options.minToleranceHours ?? 0.35));

  const byPool = new Map();
  for (const snapshot of history ?? []) {
    for (const candidate of snapshot?.candidates ?? []) {
      const key = `${candidate.venue}:${candidate.poolAddress}`;
      if (!byPool.has(key)) byPool.set(key, []);
      byPool.get(key).push(candidate);
    }
  }

  const windows = [];
  for (const rows of byPool.values()) {
    rows.sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
    for (const horizonHours of horizons) {
      let lastEndMs = -Infinity;
      const tol = Math.max(minToleranceHours, horizonHours * toleranceFraction);
      const lo = Math.max(0.05, horizonHours - tol);
      const hi = horizonHours + tol;

      for (let i = 0; i < rows.length - 1; i++) {
        const start = rows[i];
        const startMs = Date.parse(start?.observedAt);
        if (!Number.isFinite(startMs) || startMs < lastEndMs) continue;
        if (start?.screenPass !== true || start?.officialSource !== true) continue;

        let best = null;
        let bestDistance = Infinity;
        for (let j = i + 1; j < rows.length; j++) {
          const end = rows[j];
          const endMs = Date.parse(end?.observedAt);
          if (!Number.isFinite(endMs)) continue;
          const elapsedHours = (endMs - startMs) / 3_600_000;
          if (elapsedHours < lo) continue;
          if (elapsedHours > hi) break;
          if (end?.officialSource !== true) continue;
          const d = Math.abs(elapsedHours - horizonHours);
          if (d < bestDistance) {
            best = end;
            bestDistance = d;
          }
        }
        if (!best || !shouldScoreLiquidityForwardWindow(start, best)) continue;
        const elapsedHours = (Date.parse(best.observedAt) - startMs) / 3_600_000;
        const window = forwardLiquidityWindow(start, best, elapsedHours);
        if (!window) continue;
        windows.push({
          ...window,
          horizonHours,
          horizonErrorHours: elapsedHours - horizonHours,
          nonOverlapping: true,
        });
        lastEndMs = Date.parse(best.observedAt);
      }
    }
  }
  return windows;
}

export function liquidityHorizonResearch(windows = [], options = {}) {
  const minSamples = Math.max(2, Number(options.minSamples ?? 8));
  const minProfitFactor = Math.max(1, Number(options.minProfitFactor ?? 1.1));
  const minTStat = Number(options.minTStat ?? 0.5);
  const groups = new Map();

  for (const window of windows ?? []) {
    const h = Number(window?.horizonHours);
    if (!(h > 0)) continue;
    const key = `${h}|${window.venue}|${window.poolAddress}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(window);
  }

  const rows = [];
  for (const group of groups.values()) {
    const stats = liquidityForwardStats(group);
    const first = group[0] ?? {};
    const researchCandidate =
      stats.samples >= minSamples &&
      stats.expectancyBps > 0 &&
      (stats.profitFactor ?? 0) >= minProfitFactor &&
      (stats.tStat ?? -Infinity) >= minTStat;
    rows.push({
      horizonHours: first.horizonHours,
      venue: first.venue,
      poolAddress: first.poolAddress,
      pair: first.pair ?? null,
      symbol: first.symbol ?? null,
      ...stats,
      researchCandidate,
      capitalEligible: false,
      requiresIndependentForward: true,
      overlappingWindows: false,
      reason: researchCandidate
        ? 'HORIZON_RESEARCH_CANDIDATE_REQUIRES_INDEPENDENT_FORWARD_CONFIRMATION'
        : 'HORIZON_EVIDENCE_GATE_NOT_MET',
    });
  }
  rows.sort((a, b) =>
    Number(b.researchCandidate) - Number(a.researchCandidate) ||
    a.horizonHours - b.horizonHours ||
    (b.expectancyBps ?? -Infinity) - (a.expectancyBps ?? -Infinity)
  );
  const candidates = rows.filter((x) => x.researchCandidate);
  return {
    rows,
    candidates,
    candidateCount: candidates.length,
    capitalEligible: false,
    requiresIndependentForward: true,
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
    engineVersion: 'solana_liquidity_lab_v7_holding_horizon_research',
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
