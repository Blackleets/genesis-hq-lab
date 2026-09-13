// crossExchangeFundingShadow.mjs
// Cross-exchange perpetual funding carry research for Genesis HQ.
//
// Safety contract:
// - SHADOW research only
// - no wallet, API key, signing, order placement or execution authority
// - never labels a one-snapshot spread as proven edge
// - projections are explicitly conditional on funding persistence
//
// Economic idea:
// - positive funding: longs pay shorts
// - negative funding: shorts pay longs
// - therefore, for comparable perpetuals, long the lower funding rate and
//   short the higher funding rate to collect the cross-venue differential
// - round-trip trading fees are charged on BOTH venues at entry and exit

export const FUNDING_SHADOW_MODE = 'SHADOW';
export const FUNDING_EXECUTION_AUTHORITY = false;
export const FUNDING_EVALUATOR_VERSION = 'cross_exchange_funding_v1';

const DEFAULT_HORIZON_HOURS = Object.freeze([24, 72, 168]);

function finite(value) {
  return Number.isFinite(Number(value));
}

function decimalToBps(value) {
  return Number(value) * 10_000;
}

function sameText(a, b) {
  return String(a ?? '').trim().toUpperCase() === String(b ?? '').trim().toUpperCase();
}

function normalizedIntervalHours(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function normalizeFundingVenue(raw = {}) {
  const intervalHours = normalizedIntervalHours(raw.intervalHours)
    ?? (typeof raw.interval === 'string' && /^\d+(?:\.\d+)?h$/i.test(raw.interval.trim())
      ? Number(raw.interval.trim().slice(0, -1))
      : null);

  return {
    venue: String(raw.venue ?? raw.exchange ?? '').trim().toLowerCase() || null,
    symbol: String(raw.symbol ?? '').trim() || null,
    base: String(raw.base ?? '').trim().toUpperCase() || null,
    quote: String(raw.quote ?? '').trim().toUpperCase() || null,
    settle: String(raw.settle ?? raw.quote ?? '').trim().toUpperCase() || null,
    fundingRate: finite(raw.fundingRate) ? Number(raw.fundingRate) : null,
    intervalHours,
    takerFee: finite(raw.takerFee ?? raw.taker) ? Number(raw.takerFee ?? raw.taker) : null,
    makerFee: finite(raw.makerFee ?? raw.maker) ? Number(raw.makerFee ?? raw.maker) : null,
    fundingTimestamp: finite(raw.fundingTimestamp) ? Number(raw.fundingTimestamp) : null,
    nextFundingTimestamp: finite(raw.nextFundingTimestamp) ? Number(raw.nextFundingTimestamp) : null,
    feeSource: raw.feeSource ? String(raw.feeSource) : null,
  };
}

export function contractCompatibility(aRaw, bRaw) {
  const a = normalizeFundingVenue(aRaw);
  const b = normalizeFundingVenue(bRaw);
  const reasons = [];

  if (!a.venue || !b.venue || a.venue === b.venue) reasons.push('distinct_venues_required');
  if (!a.base || !b.base || !sameText(a.base, b.base)) reasons.push('base_mismatch');
  if (!a.quote || !b.quote || !sameText(a.quote, b.quote)) reasons.push('quote_mismatch');
  if (!a.settle || !b.settle || !sameText(a.settle, b.settle)) reasons.push('settle_mismatch');
  if (!a.intervalHours || !b.intervalHours || a.intervalHours !== b.intervalHours) reasons.push('funding_interval_mismatch');
  if (!finite(a.fundingRate) || !finite(b.fundingRate)) reasons.push('funding_rate_missing');

  return {
    compatible: reasons.length === 0,
    reasons,
    a,
    b,
  };
}

export function roundTripFeeBps(longVenue, shortVenue, feeModel = 'taker') {
  const feeKey = feeModel === 'maker' ? 'makerFee' : 'takerFee';
  const longFee = Number(longVenue?.[feeKey]);
  const shortFee = Number(shortVenue?.[feeKey]);
  if (!Number.isFinite(longFee) || longFee < 0 || !Number.isFinite(shortFee) || shortFee < 0) return null;
  // Entry: long + short. Exit: close long + close short.
  return 2 * (decimalToBps(longFee) + decimalToBps(shortFee));
}

export function projectFundingCarry({
  fundingDiffBps,
  intervalHours,
  roundTripTradingFeeBps,
  horizonHours,
} = {}) {
  if (![fundingDiffBps, intervalHours, roundTripTradingFeeBps, horizonHours].every(finite)) return null;
  if (intervalHours <= 0 || horizonHours <= 0) return null;
  const periods = horizonHours / intervalHours;
  const projectedFundingBps = Number(fundingDiffBps) * periods;
  const projectedNetBeforeBasisSlippageBps = projectedFundingBps - Number(roundTripTradingFeeBps);
  return {
    horizonHours: Number(horizonHours),
    periods,
    projectedFundingBps,
    roundTripTradingFeeBps: Number(roundTripTradingFeeBps),
    projectedNetBeforeBasisSlippageBps,
    assumption: 'projection_if_funding_differential_persists',
  };
}

export function evaluateFundingPair(aRaw, bRaw, {
  horizonsHours = DEFAULT_HORIZON_HOURS,
  feeEvidenceVerified = false,
  persistence = null,
  qualification = {},
} = {}) {
  const compatibility = contractCompatibility(aRaw, bRaw);
  if (!compatibility.compatible) {
    return {
      version: FUNDING_EVALUATOR_VERSION,
      mode: FUNDING_SHADOW_MODE,
      executionAuthority: FUNDING_EXECUTION_AUTHORITY,
      status: 'FILTERED',
      blockers: compatibility.reasons,
      compatibility,
    };
  }

  const { a, b } = compatibility;
  const longVenue = a.fundingRate <= b.fundingRate ? a : b;
  const shortVenue = longVenue === a ? b : a;
  const fundingDiff = shortVenue.fundingRate - longVenue.fundingRate;
  const fundingDiffBps = decimalToBps(fundingDiff);

  const takerRoundTripFeeBps = roundTripFeeBps(longVenue, shortVenue, 'taker');
  const makerRoundTripFeeBps = roundTripFeeBps(longVenue, shortVenue, 'maker');
  const breakEvenPeriodsTaker = takerRoundTripFeeBps != null && fundingDiffBps > 0
    ? takerRoundTripFeeBps / fundingDiffBps
    : null;
  const breakEvenHoursTaker = breakEvenPeriodsTaker == null
    ? null
    : breakEvenPeriodsTaker * longVenue.intervalHours;
  const breakEvenPeriodsMaker = makerRoundTripFeeBps != null && fundingDiffBps > 0
    ? makerRoundTripFeeBps / fundingDiffBps
    : null;
  const breakEvenHoursMaker = breakEvenPeriodsMaker == null
    ? null
    : breakEvenPeriodsMaker * longVenue.intervalHours;

  const takerProjections = takerRoundTripFeeBps == null
    ? []
    : horizonsHours.map((horizonHours) => projectFundingCarry({
        fundingDiffBps,
        intervalHours: longVenue.intervalHours,
        roundTripTradingFeeBps: takerRoundTripFeeBps,
        horizonHours,
      })).filter(Boolean);

  const makerProjections = makerRoundTripFeeBps == null
    ? []
    : horizonsHours.map((horizonHours) => projectFundingCarry({
        fundingDiffBps,
        intervalHours: longVenue.intervalHours,
        roundTripTradingFeeBps: makerRoundTripFeeBps,
        horizonHours,
      })).filter(Boolean);

  const blockers = [];
  if (!(fundingDiffBps > 0)) blockers.push('funding_differential_not_positive');
  if (takerRoundTripFeeBps == null) blockers.push('taker_fees_unknown');
  if (!feeEvidenceVerified) blockers.push('fee_evidence_unverified');

  const persistenceEvidence = evaluateFundingPersistence(persistence, {
    intervalHours: longVenue.intervalHours,
    roundTripTradingFeeBps: takerRoundTripFeeBps,
    qualification,
  });
  if (!persistenceEvidence.qualified) blockers.push(...persistenceEvidence.blockers);

  const status = blockers.length === 0 ? 'QUALIFIED' : (fundingDiffBps > 0 ? 'OBSERVING' : 'FILTERED');

  return {
    version: FUNDING_EVALUATOR_VERSION,
    mode: FUNDING_SHADOW_MODE,
    executionAuthority: FUNDING_EXECUTION_AUTHORITY,
    status,
    blockers: [...new Set(blockers)],
    contract: {
      base: longVenue.base,
      quote: longVenue.quote,
      settle: longVenue.settle,
      intervalHours: longVenue.intervalHours,
    },
    longVenue,
    shortVenue,
    fundingDifferential: {
      decimal: fundingDiff,
      bpsPerInterval: fundingDiffBps,
    },
    fees: {
      takerRoundTripBps: takerRoundTripFeeBps,
      makerRoundTripBps: makerRoundTripFeeBps,
      evidenceVerified: feeEvidenceVerified === true,
    },
    breakEven: {
      takerPeriods: breakEvenPeriodsTaker,
      takerHours: breakEvenHoursTaker,
      makerPeriods: breakEvenPeriodsMaker,
      makerHours: breakEvenHoursMaker,
    },
    projections: {
      taker: takerProjections,
      maker: makerProjections,
      excludes: ['basis_change', 'slippage', 'margin_cost', 'liquidation_risk', 'transfer_cost', 'funding_rate_change'],
    },
    persistence: persistenceEvidence,
  };
}

export function evaluateFundingPersistence(samples, {
  intervalHours = 8,
  roundTripTradingFeeBps = null,
  qualification = {},
} = {}) {
  const minSamples = Number.isFinite(Number(qualification.minSamples)) ? Number(qualification.minSamples) : 9;
  const minPositiveRatio = Number.isFinite(Number(qualification.minPositiveRatio)) ? Number(qualification.minPositiveRatio) : 0.75;
  const horizonHours = Number.isFinite(Number(qualification.horizonHours)) ? Number(qualification.horizonHours) : 168;

  if (!Array.isArray(samples) || samples.length === 0) {
    return {
      qualified: false,
      sampleCount: 0,
      positiveRatio: null,
      averageDiffBps: null,
      projectedNetBeforeBasisSlippageBps: null,
      blockers: ['persistence_unmeasured'],
    };
  }

  const diffs = samples
    .map((sample) => {
      if (finite(sample?.diffBps)) return Number(sample.diffBps);
      if (finite(sample?.longRate) && finite(sample?.shortRate)) {
        return decimalToBps(Number(sample.shortRate) - Number(sample.longRate));
      }
      return null;
    })
    .filter((value) => Number.isFinite(value));

  if (diffs.length === 0) {
    return {
      qualified: false,
      sampleCount: 0,
      positiveRatio: null,
      averageDiffBps: null,
      projectedNetBeforeBasisSlippageBps: null,
      blockers: ['persistence_invalid'],
    };
  }

  const positiveCount = diffs.filter((value) => value > 0).length;
  const positiveRatio = positiveCount / diffs.length;
  const averageDiffBps = diffs.reduce((sum, value) => sum + value, 0) / diffs.length;
  const projection = roundTripTradingFeeBps == null
    ? null
    : projectFundingCarry({
        fundingDiffBps: averageDiffBps,
        intervalHours,
        roundTripTradingFeeBps,
        horizonHours,
      });

  const blockers = [];
  if (diffs.length < minSamples) blockers.push('persistence_sample_too_small');
  if (positiveRatio < minPositiveRatio) blockers.push('persistence_ratio_too_low');
  if (!(averageDiffBps > 0)) blockers.push('average_differential_not_positive');
  if (!projection || !(projection.projectedNetBeforeBasisSlippageBps > 0)) blockers.push('horizon_not_fee_positive');

  return {
    qualified: blockers.length === 0,
    sampleCount: diffs.length,
    positiveCount,
    positiveRatio,
    averageDiffBps,
    horizonHours,
    projectedNetBeforeBasisSlippageBps: projection?.projectedNetBeforeBasisSlippageBps ?? null,
    blockers,
  };
}

export function rankFundingPairs(venues, options = {}) {
  if (!Array.isArray(venues)) return [];
  const rows = [];
  for (let i = 0; i < venues.length; i += 1) {
    for (let j = i + 1; j < venues.length; j += 1) {
      const row = evaluateFundingPair(venues[i], venues[j], options);
      if (row.status !== 'FILTERED' || row.fundingDifferential) rows.push(row);
    }
  }
  return rows.sort((a, b) =>
    (b.fundingDifferential?.bpsPerInterval ?? -Infinity)
    - (a.fundingDifferential?.bpsPerInterval ?? -Infinity));
}
