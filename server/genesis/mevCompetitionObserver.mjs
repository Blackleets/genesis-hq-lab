// mevCompetitionObserver.mjs
// Empirical competition telemetry for Arbitrage Radar.
//
// This module measures what can be observed safely in SHADOW mode:
// - whether a pre-capture-ready route survives into the next observation/block
// - how quickly its edge decays
// - how many consecutive observations it persists
//
// It deliberately does NOT convert these observations into an inclusion
// probability. Real inclusion probability requires execution/builder evidence.

import { isPreCaptureReady } from './mevCaptureReadiness.mjs';

export const COMPETITION_OBSERVER_VERSION = 'competition_observer_v1';

function rowsFromEvaluation(evaluation) {
  if (!evaluation) return [];
  return [...(evaluation.candidates ?? []), ...(evaluation.rejected ?? [])];
}

function finite(value) {
  return Number.isFinite(Number(value));
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function createCompetitionObserver({ maxTransitions = 2000 } = {}) {
  let previous = new Map();
  const transitions = [];
  let cyclesObserved = 0;
  let preCaptureObservations = 0;

  function trim() {
    if (transitions.length > maxTransitions) {
      transitions.splice(0, transitions.length - maxTransitions);
    }
  }

  function snapshot() {
    const comparable = transitions.filter((t) => t.comparable === true);
    const survived = comparable.filter((t) => t.survived === true);
    const edgeDecay = survived
      .map((t) => t.edgeDecayBps)
      .filter(Number.isFinite);
    const lifetime = comparable
      .map((t) => t.previousConsecutiveObservations)
      .filter(Number.isFinite);

    return {
      version: COMPETITION_OBSERVER_VERSION,
      mode: 'SHADOW',
      executionAuthority: false,
      cyclesObserved,
      preCaptureObservations,
      transitionsObserved: comparable.length,
      nextObservationSurvivalRate: comparable.length ? survived.length / comparable.length : null,
      medianSurvivingEdgeDecayBps: median(edgeDecay),
      medianObservedLifetime: median(lifetime),
      activePreCaptureRoutes: previous.size,
      inclusionProbabilityMeasured: false,
      captureProbabilityMeasured: false,
      note: 'Survival/decay telemetry is descriptive competition evidence only; it is not inclusion probability.',
    };
  }

  return {
    observe(evaluation, { blockNumber = null, capturedAt = new Date().toISOString() } = {}) {
      cyclesObserved += 1;
      const current = new Map();
      const readyRows = rowsFromEvaluation(evaluation).filter(isPreCaptureReady);
      preCaptureObservations += readyRows.length;

      for (const row of readyRows) {
        const key = row.routeFingerprint ?? row.routeId;
        if (!key) continue;
        const prior = previous.get(key);
        const edge = finite(row.netEdgeBps) ? Number(row.netEdgeBps) : null;
        current.set(key, {
          routeFingerprint: row.routeFingerprint ?? null,
          routeId: row.routeId ?? null,
          blockNumber: row.blockNumber ?? blockNumber ?? null,
          capturedAt: row.capturedAt ?? capturedAt,
          netEdgeBps: edge,
          consecutiveObservations: prior ? prior.consecutiveObservations + 1 : 1,
        });
      }

      for (const [key, prior] of previous.entries()) {
        const now = current.get(key);
        const comparable = prior.blockNumber != null && blockNumber != null
          ? String(prior.blockNumber) !== String(blockNumber)
          : true;
        transitions.push({
          routeFingerprint: prior.routeFingerprint,
          routeId: prior.routeId,
          fromBlock: prior.blockNumber == null ? null : String(prior.blockNumber),
          toBlock: blockNumber == null ? null : String(blockNumber),
          comparable,
          survived: Boolean(now),
          previousConsecutiveObservations: prior.consecutiveObservations,
          previousEdgeBps: prior.netEdgeBps,
          currentEdgeBps: now?.netEdgeBps ?? null,
          edgeDecayBps: now && finite(prior.netEdgeBps) && finite(now.netEdgeBps)
            ? Number(prior.netEdgeBps) - Number(now.netEdgeBps)
            : null,
          observedAt: capturedAt,
        });
      }

      previous = current;
      trim();
      return snapshot();
    },
    snapshot,
  };
}
