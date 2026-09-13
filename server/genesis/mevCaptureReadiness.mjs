// mevCaptureReadiness.mjs
// Competition/capture readiness evidence for the Arbitrage Radar.
//
// This layer deliberately does NOT invent an inclusion probability. It answers
// a narrower question: has a route passed every evidence gate except the
// capture/inclusion gate, and how long do those pre-capture windows persist?
// Persistence is useful competition evidence, but it is not execution proof.

export const CAPTURE_READINESS_VERSION = 'capture_readiness_v1';
export const CAPTURE_ONLY_BLOCKERS = Object.freeze([
  'inclusionProbability',
  'expectedNetPositive',
]);

const captureOnly = new Set(CAPTURE_ONLY_BLOCKERS);

function finitePositive(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function rowsFromEvaluation(evaluation) {
  if (!evaluation) return [];
  return [...(evaluation.candidates ?? []), ...(evaluation.rejected ?? [])];
}

export function isPreCaptureReady(row) {
  if (!row?.executable) return false;
  if (row.executionAuthority !== false || row.mode !== 'SHADOW') return false;
  if (row.atomic !== true || row.simulationSuccess !== true) return false;
  if (!finitePositive(row.netPnlUsd) || !finitePositive(row.stressNetPnlUsd)) return false;
  if (!Number.isFinite(Number(row.liquidityConfidence)) || Number(row.liquidityConfidence) <= 0) return false;
  const blockers = Array.isArray(row.blockers) ? row.blockers : [];
  return blockers.length > 0 && blockers.every((blocker) => captureOnly.has(blocker));
}

export function summarizeCaptureReadiness(evaluation) {
  const rows = rowsFromEvaluation(evaluation);
  const preCaptureRows = rows.filter(isPreCaptureReady);
  const blockerCounts = {};
  for (const row of rows) {
    for (const blocker of row?.blockers ?? []) {
      blockerCounts[blocker] = (blockerCounts[blocker] ?? 0) + 1;
    }
  }

  return {
    version: CAPTURE_READINESS_VERSION,
    mode: 'SHADOW',
    executionAuthority: false,
    evaluated: rows.length,
    preCaptureReady: preCaptureRows.length,
    captureEvidenceMeasured: false,
    inclusionProbabilityMeasured: false,
    state: preCaptureRows.length > 0 ? 'CAPTURE_EVIDENCE_REQUIRED' : 'BUILDING_EVIDENCE',
    blockerCounts,
    routes: preCaptureRows.map((row) => ({
      routeFingerprint: row.routeFingerprint,
      routeId: row.routeId ?? null,
      blockNumber: row.blockNumber ?? null,
      netPnlUsd: row.netPnlUsd ?? null,
      stressNetPnlUsd: row.stressNetPnlUsd ?? null,
      netEdgeBps: row.netEdgeBps ?? null,
      liquidityConfidence: row.liquidityConfidence ?? null,
      blockers: row.blockers ?? [],
    })),
    note: 'Pre-capture readiness is not an inclusion probability and does not authorize execution.',
  };
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function createCaptureWindowTracker({ maxClosedWindows = 500 } = {}) {
  const active = new Map();
  const closed = [];
  let totalPreCaptureObservations = 0;

  function closeRoute(key, endedAt, endedBlock) {
    const current = active.get(key);
    if (!current) return;
    active.delete(key);
    const endMs = Date.parse(endedAt ?? current.lastSeenAt);
    const startMs = Date.parse(current.firstSeenAt);
    closed.push({
      ...current,
      endedAt: endedAt ?? current.lastSeenAt,
      endedBlock: endedBlock ?? current.lastBlock,
      durationMs: Number.isFinite(endMs) && Number.isFinite(startMs) ? Math.max(0, endMs - startMs) : null,
    });
    if (closed.length > maxClosedWindows) closed.splice(0, closed.length - maxClosedWindows);
  }

  function snapshot() {
    const activeWindows = [...active.values()];
    const closedDurations = closed.map((window) => window.durationMs).filter(Number.isFinite);
    const closedObservations = closed.map((window) => window.observations).filter(Number.isFinite);
    return {
      version: CAPTURE_READINESS_VERSION,
      activeWindows: activeWindows.length,
      closedWindows: closed.length,
      totalPreCaptureObservations,
      longestActiveObservations: activeWindows.reduce((max, row) => Math.max(max, row.observations), 0),
      medianClosedWindowMs: median(closedDurations),
      medianClosedWindowObservations: median(closedObservations),
      active: activeWindows.slice(0, 20),
      note: 'Window persistence is competition telemetry only; it is not inclusion probability.',
    };
  }

  return {
    update(evaluation, { blockNumber = null, capturedAt = new Date().toISOString() } = {}) {
      const rows = rowsFromEvaluation(evaluation);
      const readyRows = rows.filter(isPreCaptureReady);
      const seen = new Set();

      for (const row of readyRows) {
        const key = row.routeFingerprint ?? row.routeId;
        if (!key) continue;
        seen.add(key);
        totalPreCaptureObservations += 1;
        const observedBlock = row.blockNumber ?? blockNumber;
        const previous = active.get(key);
        if (!previous) {
          active.set(key, {
            routeFingerprint: row.routeFingerprint ?? null,
            routeId: row.routeId ?? null,
            firstSeenAt: row.capturedAt ?? capturedAt,
            lastSeenAt: row.capturedAt ?? capturedAt,
            firstBlock: observedBlock == null ? null : String(observedBlock),
            lastBlock: observedBlock == null ? null : String(observedBlock),
            observations: 1,
            maxNetEdgeBps: Number.isFinite(Number(row.netEdgeBps)) ? Number(row.netEdgeBps) : null,
          });
          continue;
        }
        previous.lastSeenAt = row.capturedAt ?? capturedAt;
        previous.lastBlock = observedBlock == null ? previous.lastBlock : String(observedBlock);
        previous.observations += 1;
        if (Number.isFinite(Number(row.netEdgeBps))) {
          previous.maxNetEdgeBps = previous.maxNetEdgeBps == null
            ? Number(row.netEdgeBps)
            : Math.max(previous.maxNetEdgeBps, Number(row.netEdgeBps));
        }
      }

      for (const key of [...active.keys()]) {
        if (!seen.has(key)) closeRoute(key, capturedAt, blockNumber == null ? null : String(blockNumber));
      }

      return snapshot();
    },
    snapshot,
  };
}
