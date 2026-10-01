// Bounded RESEARCH_ONLY session: public OKX observations, never orders.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  capturePositioning, classifyPositioningCaptureError, deriveCrossCapturePositioningFeatures,
} from '../genesis/positioningDynamicsCapture.mjs';
import { captureSpotPerpTakerDivergence } from '../genesis/spotPerpTakerDivergenceCapture.mjs';
import { auditPositioningRows, readJsonl } from './positioningDataQualityAudit.mjs';
import { evaluatePositioningStudy } from './runPositioningEdgeFactory.mjs';

export const CONTINUITY_PROTOCOL = Object.freeze({
  version: 'positioning_continuity_v1',
  symbol: 'BTCUSDT',
  targetAttempts: 24,
  minimumAttemptSeparationMs: 65_000,
  maximumDurationMs: 30 * 60_000,
  takerWindowMs: 60_000,
  minimumCoverageMs: 54_000,
  maximumObservationDeliveryLagMs: 30_000,
  minimumIndependentRows: 20,
  maxGapMinutes: 60,
  stressedCostBps: 12,
  policy: 'FRESH_SESSION_NO_BACKFILL_NO_POOLING; EXISTING_FIVE_FIXED_FAMILIES; HOLDOUT_SEALED',
  divergencePolicy: 'OPTIONAL_PRIOR_ASOF_ONLY_MAX_30_SECONDS; MISSING_BLOCKS_DIVERGENCE_FAMILY',
  authority: 'RESEARCH_ONLY_NO_ORDERS_NO_RISK_CHANGE',
});
export const CONTINUITY_PROTOCOL_SHA256 = crypto.createHash('sha256')
  .update(JSON.stringify(CONTINUITY_PROTOCOL)).digest('hex');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}
function numeric(value) {
  return typeof value === 'number' && Number.isFinite(value);
}
export function budgetedFetch(deadlineMs, { now = Date.now, fetchImpl = fetch } = {}) {
  return async (url, options = {}) => {
    const remainingMs = Math.floor(deadlineMs - now());
    if (remainingMs <= 0) throw new Error('CONTINUITY_TIME_BUDGET_EXHAUSTED');
    const deadlineSignal = AbortSignal.timeout(remainingMs);
    const signal = options.signal ? AbortSignal.any([options.signal, deadlineSignal]) : deadlineSignal;
    return fetchImpl(url, { ...options, signal });
  };
}
function observationRejection(row, previous, currentMs) {
  const captured = Date.parse(row?.capturedAt);
  const closed = Date.parse(row?.price?.closeTime);
  const taker = Date.parse(row?.provenance?.sourceTimes?.taker);
  if (row?.mode !== 'RESEARCH_ONLY' || row?.schemaVersion !== 4
      || row?.provider !== 'okx_public_market_data' || row?.symbol !== CONTINUITY_PROTOCOL.symbol
      || row?.provenance?.securityType !== 'PUBLIC_READ_ONLY_NO_API_KEY'
      || row?.provenance?.instrument !== 'BTC-USDT-SWAP'
      || row?.provenance?.closedPriceBarOnly !== true || row?.provenance?.fixedWindowTakerFlow !== true) {
    return 'INVALID_OBSERVATION_PROVENANCE';
  }
  if (![captured, closed, taker].every(Number.isFinite) || captured > currentMs
      || currentMs - captured > CONTINUITY_PROTOCOL.maximumObservationDeliveryLagMs
      || closed > captured || taker > captured || captured - closed > 5 * 60_000
      || captured - taker > 2 * 60_000) return 'INVALID_OR_STALE_SOURCE_TIME';
  if (!numeric(row?.price?.close) || row.price.close <= 0
      || !numeric(row?.positioning?.openInterest?.value) || row.positioning.openInterest.value <= 0
      || row.positioning.openInterest.unit !== 'CONTRACTS'
      || row.positioning.takerWindowMs !== CONTINUITY_PROTOCOL.takerWindowMs
      || !numeric(row.positioning.takerWindowCoverageMs)
      || row.positioning.takerWindowCoverageMs < CONTINUITY_PROTOCOL.minimumCoverageMs) {
    return 'INCOMPLETE_OBSERVATION';
  }
  if (previous) {
    if (row.price.closeTime === previous.price.closeTime) return 'DUPLICATE_CLOSED_BAR';
    if (captured - Date.parse(previous.capturedAt) < CONTINUITY_PROTOCOL.takerWindowMs
        || taker - Date.parse(previous.provenance.sourceTimes.taker) < CONTINUITY_PROTOCOL.takerWindowMs) {
      return 'OVERLAPPING_OR_REPLAYED_TAKER_WINDOW';
    }
  }
  return null;
}

export async function runPositioningContinuity({
  sessionDir, summaryOut, evidencePrefix = sessionDir,
  capture = capturePositioning, captureDivergence = captureSpotPerpTakerDivergence,
  now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  onProgress = () => {},
} = {}) {
  if (!sessionDir || !summaryOut) throw new Error('sessionDir and summaryOut are required');
  const files = Object.fromEntries([
    ['protocol', 'protocol.json'], ['tape', 'positioning.jsonl'], ['latest', 'positioning-latest.json'],
    ['divergence', 'spot-perp-divergence.jsonl'], ['quality', 'quality.json'],
    ['study', 'study.json'], ['session', 'session.json'],
  ].map(([key, name]) => [key, path.join(sessionDir, name)]));
  if (fs.existsSync(files.protocol)) throw new Error('SESSION_ALREADY_EXISTS_USE_NEW_SESSION_ID');
  const startedAtMs = now();
  const deadline = startedAtMs + CONTINUITY_PROTOCOL.maximumDurationMs;
  const fetchWithinBudget = budgetedFetch(deadline, { now });
  const attempts = [];
  let lastAttemptFinishedMs = null;
  let stopReason = 'ATTEMPT_BUDGET_COMPLETE';
  let fatalFailure = false;
  writeJson(files.protocol, { protocol: CONTINUITY_PROTOCOL, protocolSha256: CONTINUITY_PROTOCOL_SHA256,
    registeredAt: new Date(startedAtMs).toISOString() });

  const saveReport = () => {
    const rows = readJsonl(files.tape);
    const divergences = readJsonl(files.divergence);
    const quality = auditPositioningRows(rows);
    const study = evaluatePositioningStudy(rows, quality, { divergenceRows: divergences });
    writeJson(files.quality, quality);
    writeJson(files.study, study);
    const report = {
      version: CONTINUITY_PROTOCOL.version, mode: 'RESEARCH_ONLY',
      paperOnly: true, executionAuthority: false, liveOrders: false, capitalEligible: false,
      changesRiskGates: false, holdoutOpened: false,
      protocol: CONTINUITY_PROTOCOL, protocolSha256: CONTINUITY_PROTOCOL_SHA256,
      sourceCommit: process.env.GITHUB_SHA ?? null,
      startedAt: new Date(startedAtMs).toISOString(), updatedAt: new Date(now()).toISOString(),
      stopReason, fatalFailure, attemptCount: attempts.length,
      acceptedRowCount: rows.length, independentRowCount: quality.independentRowCount,
      cohortReadyForResearch: quality.readiness.readyForPredeclaredStudy,
      researchVerdict: study.verdict, survivors: study.survivors?.length ?? 0,
      evidence_refs: Object.fromEntries(Object.entries(files).map(([key, file]) =>
        [key, path.join(evidencePrefix, path.basename(file))])),
      evidenceBranch: 'capture-tape', attempts,
    };
    writeJson(files.session, report);
    writeJson(summaryOut, report);
    return report;
  };

  for (let index = 0; index < CONTINUITY_PROTOCOL.targetAttempts; index += 1) {
    const dueMs = lastAttemptFinishedMs === null ? now()
      : lastAttemptFinishedMs + CONTINUITY_PROTOCOL.minimumAttemptSeparationMs;
    if (dueMs >= deadline || now() >= deadline) { stopReason = 'TIME_BUDGET_EXHAUSTED'; break; }
    while (now() < dueMs) await wait(Math.min(30_000, dueMs - now()));
    if (now() >= deadline) { stopReason = 'TIME_BUDGET_EXHAUSTED'; break; }
    const attempt = { attempt: index + 1, startedAt: new Date(now()).toISOString(),
      status: 'PENDING', reason: null, divergenceAvailable: false, divergenceReason: null };
    let divergence = null;
    try {
      // Optional evidence: its failure cannot manufacture a divergence feature.
      divergence = await captureDivergence({ fetchImpl: fetchWithinBudget });
    } catch {
      attempt.divergenceReason = 'DIVERGENCE_CAPTURE_UNAVAILABLE';
    }
    if (now() >= deadline) {
      attempt.status = 'TIME_BUDGET_EXHAUSTED'; stopReason = 'TIME_BUDGET_EXHAUSTED';
    } else {
      try {
        const row = await capture({ symbol: CONTINUITY_PROTOCOL.symbol, fetchImpl: fetchWithinBudget });
        const previous = readJsonl(files.tape).at(-1) ?? null;
        const rejection = now() >= deadline ? 'TIME_BUDGET_EXHAUSTED'
          : observationRejection(row, previous, now());
        if (rejection) {
          attempt.status = 'REJECTED'; attempt.reason = rejection;
        } else {
          row.crossCapture = deriveCrossCapturePositioningFeatures(previous, row);
          fs.appendFileSync(files.tape, JSON.stringify(row) + '\n');
          writeJson(files.latest, row);
          attempt.status = 'ACCEPTED'; attempt.capturedAt = row.capturedAt;
          const divergenceAge = Date.parse(row.capturedAt) - Date.parse(divergence?.capturedAt);
          if (divergence?.mode === 'RESEARCH_ONLY' && divergence?.provider === row.provider
              && divergence?.symbol === row.symbol && divergence?.schemaVersion === 1
              && divergence?.provenance?.fixedWindow === true
              && divergence?.provenance?.rawSpotVsPerpSizeComparisonForbidden === true
              && divergence.spot?.coverageMs >= CONTINUITY_PROTOCOL.minimumCoverageMs
              && divergence.perpetual?.coverageMs >= CONTINUITY_PROTOCOL.minimumCoverageMs
              && numeric(divergence?.divergence?.perpMinusSpotNotionalBuyFraction)
              && divergenceAge >= 0 && divergenceAge <= 30_000) {
            fs.appendFileSync(files.divergence, JSON.stringify(divergence) + '\n');
            attempt.divergenceAvailable = true;
          } else if (!attempt.divergenceReason) {
            attempt.divergenceReason = 'DIVERGENCE_MISSING_STALE_OR_NONCAUSAL';
          }
        }
      } catch (error) {
        if (now() >= deadline) {
          attempt.status = 'TIME_BUDGET_EXHAUSTED'; stopReason = 'TIME_BUDGET_EXHAUSTED';
        } else {
          const classification = classifyPositioningCaptureError(error);
          attempt.status = classification.transientDataGap ? 'DATA_GAP' : 'FATAL_FAILURE';
          attempt.reason = classification.reason;
          if (!classification.transientDataGap) {
            fatalFailure = true; stopReason = 'UNEXPECTED_CAPTURE_FAILURE';
          }
        }
      }
    }
    lastAttemptFinishedMs = now();
    attempt.finishedAt = new Date(lastAttemptFinishedMs).toISOString();
    attempts.push(attempt);
    saveReport();
    onProgress(attempt);
    if (fatalFailure || now() >= deadline) break;
  }
  if (!fatalFailure && now() >= deadline) stopReason = 'TIME_BUDGET_EXHAUSTED';
  return saveReport();
}

if (process.argv[1]?.endsWith('runPositioningContinuity.mjs')) {
  const args = process.argv.slice(2);
  const val = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  runPositioningContinuity({
    sessionDir: val('--session-dir'), summaryOut: val('--out'), evidencePrefix: val('--evidence-prefix'),
    onProgress: attempt => console.log(JSON.stringify(attempt)),
  }).then(report => {
    console.log(JSON.stringify(report));
    if (report.fatalFailure || !report.cohortReadyForResearch) process.exitCode = 1;
  }).catch(() => {
    console.error('POSITIONING_CONTINUITY_SESSION_FAILED; inspect persisted session status');
    process.exitCode = 1;
  });
}
