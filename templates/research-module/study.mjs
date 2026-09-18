// Genesis contributor template — RESEARCH_ONLY.
//
// Copy this folder when starting a new hypothesis. Keep the evaluator pure:
// no network, no signing, no order placement, no mutation of production state.

import { createHash } from 'node:crypto';

export const EXECUTION_AUTHORITY = false;

export const PROTOCOL = Object.freeze({
  studyVersion: 1,
  hypothesis: 'EXAMPLE: feature X predicts same-direction return over a fixed forward horizon net of declared costs.',
  featureThreshold: 0.5,
  horizonMs: 15 * 60 * 1000,
  horizonToleranceMs: 5 * 60 * 1000,
  roundTripCostBps: 10,
  minimumObservations: 5,
});

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function protocolHash(protocol = PROTOCOL) {
  return createHash('sha256').update(canonical(protocol)).digest('hex');
}

export function isAdmissibleObservation(row) {
  const capturedAtMs = Date.parse(row?.capturedAt ?? '');
  const price = finite(row?.features?.price);
  const feature = finite(row?.features?.signalFeature);
  return Boolean(
    row?.mode === 'RESEARCH_ONLY' &&
    row?.safeForResearch === true &&
    row?.provider &&
    row?.symbol &&
    Number.isFinite(capturedAtMs) &&
    price !== null &&
    price > 0 &&
    feature !== null,
  );
}

export function classifySide(row, protocol = PROTOCOL) {
  if (!isAdmissibleObservation(row)) return null;
  const feature = finite(row.features.signalFeature);
  if (feature >= protocol.featureThreshold) return 'LONG';
  if (feature <= -protocol.featureThreshold) return 'SHORT';
  return null;
}

export function findForwardOutcome(rows, entryIndex, protocol = PROTOCOL) {
  const entry = rows[entryIndex];
  if (!isAdmissibleObservation(entry)) return null;
  const entryMs = Date.parse(entry.capturedAt);
  const minMs = entryMs + protocol.horizonMs;
  const maxMs = minMs + protocol.horizonToleranceMs;

  for (let i = entryIndex + 1; i < rows.length; i += 1) {
    const candidate = rows[i];
    if (!isAdmissibleObservation(candidate)) continue;
    if (candidate.provider !== entry.provider || candidate.symbol !== entry.symbol) continue;
    const t = Date.parse(candidate.capturedAt);
    if (t < minMs) continue;
    if (t > maxMs) return null;
    return candidate;
  }
  return null;
}

function summarize(observations) {
  const values = observations.map((x) => x.netBps);
  if (!values.length) {
    return {
      observationCount: 0,
      meanNetBps: null,
      winRate: null,
      profitFactor: null,
    };
  }

  const wins = values.filter((x) => x > 0);
  const losses = values.filter((x) => x < 0);
  const grossProfit = wins.reduce((sum, x) => sum + x, 0);
  const grossLoss = Math.abs(losses.reduce((sum, x) => sum + x, 0));

  return {
    observationCount: values.length,
    meanNetBps: values.reduce((sum, x) => sum + x, 0) / values.length,
    winRate: wins.length / values.length,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : null),
  };
}

export function evaluateStudy(inputRows = [], protocol = PROTOCOL) {
  const rows = [...inputRows]
    .filter(Boolean)
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));

  const observations = [];

  for (let i = 0; i < rows.length; i += 1) {
    const side = classifySide(rows[i], protocol);
    if (!side) continue;

    const exit = findForwardOutcome(rows, i, protocol);
    if (!exit) continue;

    const entryPrice = finite(rows[i].features.price);
    const exitPrice = finite(exit.features.price);
    if (!(entryPrice > 0 && exitPrice > 0)) continue;

    const marketMoveBps = ((exitPrice / entryPrice) - 1) * 10_000;
    const grossBps = side === 'LONG' ? marketMoveBps : -marketMoveBps;
    const netBps = grossBps - protocol.roundTripCostBps;

    observations.push({
      entryCapturedAt: rows[i].capturedAt,
      exitCapturedAt: exit.capturedAt,
      provider: rows[i].provider,
      symbol: rows[i].symbol,
      side,
      grossBps,
      costBps: protocol.roundTripCostBps,
      netBps,
    });
  }

  const summary = summarize(observations);
  const sufficient = summary.observationCount >= protocol.minimumObservations;

  let decision = 'INSUFFICIENT_DATA';
  if (sufficient) {
    decision = summary.meanNetBps > 0 && (summary.profitFactor === Infinity || summary.profitFactor > 1)
      ? 'SURVIVES_INITIAL_SCREEN'
      : 'REJECTED';
  }

  return {
    mode: 'RESEARCH_ONLY',
    executionAuthority: EXECUTION_AUTHORITY,
    studyVersion: protocol.studyVersion,
    protocolHash: protocolHash(protocol),
    hypothesis: protocol.hypothesis,
    minimumObservations: protocol.minimumObservations,
    costModel: {
      roundTripCostBps: protocol.roundTripCostBps,
    },
    ...summary,
    sufficient,
    decision,
    observations,
    promotionEligible: false,
  };
}
