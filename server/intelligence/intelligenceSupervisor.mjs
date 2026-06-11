import db from '../db/database.mjs';
import { nanoid } from '../utils.mjs';
import { buildSupervisorMission } from './missionBuilder.mjs';
import { evaluateSupervisorCandidate, normalizeProviderResult } from './policyEvaluator.mjs';
import {
  applySupervisorRecommendation,
  buildSupervisorProposedChanges,
  getAppliedFuturesPolicyState,
  rollbackSupervisorOverrides,
} from './policyApplication.mjs';
import { runFoundrySupervisorMission } from './policyFoundryAdapter.mjs';

const SUPERVISOR_SCOPE = 'futures_supervisor';
const SUCCESS_STATUSES = ['draft', 'recommended'];

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function toRecord(row) {
  if (!row) return null;
  return {
    id: row.id,
    missionId: row.mission_id,
    source: row.source,
    scope: row.scope,
    status: row.status,
    advisoryOnly: Boolean(row.advisory_only),
    providerStatus: row.provider_status,
    mission: parseJson(row.mission, null),
    candidateSummary: parseJson(row.candidate_summary, null),
    recommendedPrompt: row.recommended_prompt ?? null,
    recommendedRules: parseJson(row.recommended_rules, []),
    score: row.score == null ? null : Math.round(row.score * 1000) / 1000,
    riskNotes: parseJson(row.risk_notes, []),
    justification: parseJson(row.justification, []),
    proposedChanges: parseJson(row.proposed_changes, []),
    artifacts: parseJson(row.artifacts, null),
    createdAt: row.created_at,
  };
}

function insertRun(record) {
  db.prepare(`
    INSERT INTO intelligence_runs (
      id, mission_id, source, scope, status, advisory_only, provider_status,
      mission, candidate_summary, recommended_prompt, recommended_rules,
      score, risk_notes, justification, proposed_changes, artifacts, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.missionId,
    record.source,
    record.scope,
    record.status,
    record.advisoryOnly ? 1 : 0,
    record.providerStatus,
    JSON.stringify(record.mission),
    record.candidateSummary ? JSON.stringify(record.candidateSummary) : null,
    record.recommendedPrompt ?? null,
    JSON.stringify(record.recommendedRules ?? []),
    record.score ?? null,
    JSON.stringify(record.riskNotes ?? []),
    JSON.stringify(record.justification ?? []),
    JSON.stringify(record.proposedChanges ?? []),
    record.artifacts ? JSON.stringify(record.artifacts) : null,
    record.createdAt,
  );
}

function buildState() {
  const latestSuccessfulRow = db.prepare(`
    SELECT *
    FROM intelligence_runs
    WHERE scope = ?
      AND status IN (${SUCCESS_STATUSES.map(() => '?').join(', ')})
    ORDER BY created_at DESC
    LIMIT 1
  `).get(SUPERVISOR_SCOPE, ...SUCCESS_STATUSES);

  const latestAttemptRow = db.prepare(`
    SELECT *
    FROM intelligence_runs
    WHERE scope = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(SUPERVISOR_SCOPE);

  return {
    scope: SUPERVISOR_SCOPE,
    latest: toRecord(latestSuccessfulRow),
    latestAttempt: toRecord(latestAttemptRow),
    appliedPolicy: getAppliedFuturesPolicyState(),
  };
}

export function getIntelligenceSupervisorLatest() {
  return buildState();
}

export function getIntelligenceSupervisorHistory(limit = 20) {
  return db.prepare(`
    SELECT *
    FROM intelligence_runs
    WHERE scope = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(SUPERVISOR_SCOPE, Math.max(1, Math.min(limit, 100))).map(toRecord);
}

export function getIntelligenceSupervisorRunById(id) {
  const row = db.prepare(`
    SELECT *
    FROM intelligence_runs
    WHERE scope = ? AND id = ?
    LIMIT 1
  `).get(SUPERVISOR_SCOPE, id);
  return toRecord(row);
}

export function applyIntelligenceSupervisorRun(id, appliedBy = 'operator') {
  const run = getIntelligenceSupervisorRunById(id);
  return applySupervisorRecommendation(run, appliedBy);
}

export function rollbackIntelligenceSupervisorOverrides(appliedBy = 'operator', reason = 'manual rollback') {
  return rollbackSupervisorOverrides(appliedBy, reason);
}

export async function runIntelligenceSupervisor() {
  const mission = buildSupervisorMission();
  const createdAt = new Date().toISOString();
  const provider = await runFoundrySupervisorMission(mission);

  if (!provider.ok) {
    const degradedRun = {
      id: `intelligence-${nanoid()}`,
      missionId: mission.id,
      source: provider.source ?? 'foundry',
      scope: SUPERVISOR_SCOPE,
      status: provider.providerStatus === 'unavailable' ? 'degraded' : 'failed',
      advisoryOnly: true,
      providerStatus: provider.providerStatus,
      mission,
      candidateSummary: null,
      recommendedPrompt: null,
      recommendedRules: [],
      score: null,
      riskNotes: [
        provider.error ?? 'Supervisor provider unavailable.',
        'No recommendation was applied and live futures behavior was not changed.',
      ],
      justification: ['Run stored as advisory-only degraded state.'],
      proposedChanges: [],
      artifacts: {
        error: provider.error ?? 'unknown_provider_error',
      },
      createdAt,
    };
    insertRun(degradedRun);
    return {
      ok: provider.providerStatus === 'unavailable',
      advisoryOnly: true,
      applied: false,
      state: buildState(),
      run: degradedRun,
      error: provider.error ?? 'supervisor_provider_unavailable',
    };
  }

  const candidate = normalizeProviderResult(provider.result, mission);
  const evaluation = evaluateSupervisorCandidate(candidate, mission);
  const proposedChanges = buildSupervisorProposedChanges(mission);
  const successfulRun = {
    id: `intelligence-${nanoid()}`,
    missionId: mission.id,
    source: provider.source ?? 'foundry',
    scope: SUPERVISOR_SCOPE,
    status: 'recommended',
    advisoryOnly: true,
    providerStatus: provider.providerStatus,
    mission,
    candidateSummary: {
      id: candidate.id,
      source: candidate.source,
      style: candidate.style,
      score: evaluation.score,
      providerScore: candidate.providerScore,
      metrics: candidate.metrics,
      summary: candidate.summary,
      critique: candidate.critique,
      missingTerms: candidate.missingTerms,
      affectedProfiles: evaluation.affectedProfiles,
      leaderboard: candidate.leaderboard,
    },
    recommendedPrompt: candidate.prompt || 'No prompt body returned by provider.',
    recommendedRules: evaluation.recommendedRules,
    score: evaluation.score,
    riskNotes: evaluation.riskNotes,
    justification: evaluation.justification,
    proposedChanges,
    artifacts: {
      provider: provider.result,
    },
    createdAt,
  };
  insertRun(successfulRun);

  return {
    ok: true,
    advisoryOnly: true,
    applied: false,
    state: buildState(),
    run: successfulRun,
  };
}
