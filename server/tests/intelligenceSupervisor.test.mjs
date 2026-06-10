import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import db from '../db/database.mjs';
import { buildSupervisorMission } from '../intelligence/missionBuilder.mjs';
import {
  applyIntelligenceSupervisorRun,
  getIntelligenceSupervisorLatest,
  getIntelligenceSupervisorHistory,
  getIntelligenceSupervisorRunById,
  rollbackIntelligenceSupervisorOverrides,
  runIntelligenceSupervisor,
} from '../intelligence/intelligenceSupervisor.mjs';

const ORIGINAL_FOUNDRY_PATH = process.env.FRACTAL_FOUNDRY_PATH;
const ORIGINAL_PYTHON_BIN = process.env.PYTHON_BIN;

function cleanupRuns() {
  db.prepare(`DELETE FROM intelligence_runs WHERE scope = 'futures_supervisor'`).run();
  db.prepare(`DELETE FROM intelligence_policy_applies WHERE scope = 'futures_supervisor'`).run();
  db.prepare(`DELETE FROM org_state WHERE key = 'futures_runtime_policy_overrides'`).run();
}

describe('intelligence supervisor', () => {
  beforeEach(() => {
    cleanupRuns();
    delete process.env.FRACTAL_FOUNDRY_PATH;
    process.env.PYTHON_BIN = ORIGINAL_PYTHON_BIN || 'python';
  });

  afterEach(() => {
    cleanupRuns();
    if (ORIGINAL_FOUNDRY_PATH == null) delete process.env.FRACTAL_FOUNDRY_PATH;
    else process.env.FRACTAL_FOUNDRY_PATH = ORIGINAL_FOUNDRY_PATH;
    if (ORIGINAL_PYTHON_BIN == null) delete process.env.PYTHON_BIN;
    else process.env.PYTHON_BIN = ORIGINAL_PYTHON_BIN;
  });

  test('buildSupervisorMission returns a real futures advisory mission', () => {
    const mission = buildSupervisorMission();
    assert.ok(mission.id.startsWith('sup-mission-'));
    assert.equal(mission.scope, 'futures_supervisor');
    assert.equal(mission.constraints.includes('paper only'), true);
    assert.equal(Array.isArray(mission.governorProfiles), true);
    assert.equal(Array.isArray(mission.recentOutcomes), true);
    assert.equal(Array.isArray(mission.lessonSummaries), true);
  });

  test('degraded run is stored without mutating trades', async () => {
    process.env.PYTHON_BIN = `missing-python-${Date.now()}`;
    const beforeTrades = db.prepare(`SELECT COUNT(*) AS n FROM trades`).get()?.n ?? 0;
    const result = await runIntelligenceSupervisor();
    const afterTrades = db.prepare(`SELECT COUNT(*) AS n FROM trades`).get()?.n ?? 0;

    assert.equal(afterTrades, beforeTrades, 'supervisor must never write to trades');
    assert.equal(Boolean(result.run), true);
    assert.equal(['degraded', 'failed'].includes(result.run.status), true);
    assert.equal(result.run.advisoryOnly, true);

    const latest = getIntelligenceSupervisorLatest();
    assert.equal(latest.latest, null, 'failed/degraded runs must not replace the last successful package');
    assert.equal(['degraded', 'failed'].includes(latest.latestAttempt?.status ?? ''), true);
  });

  test('successful fake foundry run persists recommendation and degraded retry preserves latest good package', async () => {
    const fakeFoundryDir = mkdtempSync(join(tmpdir(), 'genesis-foundry-'));
    try {
      writeFileSync(join(fakeFoundryDir, 'fractal_prompt_foundry.py'), `
class Mission:
    def __init__(self, name, goal, constraints, success_criteria, deliverables, domain_terms=None):
        self.name = name
        self.goal = goal
        self.constraints = constraints
        self.success_criteria = success_criteria
        self.deliverables = deliverables
        self.domain_terms = domain_terms or []

class FractalPromptFoundry:
    def __init__(self, mission, population_size=5):
        self.mission = mission
        self.population_size = population_size

    def run(self, rounds=3):
        return {
            "best_candidate": {
                "candidate_id": "seed-1",
                "style": "architect",
                "prompt": "ROLE LANE: ARCHITECT\\nPRIMARY GOAL: advisory only paper only risk gates no direct execution no governor mutation\\nshort_micro short_core cooldown lessons expectancy drawdown",
                "notes": ["initial lane"]
            },
            "best_evaluation": {
                "total_score": 0.91,
                "metrics": {
                    "coverage": 1.0,
                    "structure": 0.9,
                    "actionability": 0.92,
                    "novelty": 0.8,
                    "anti_vague": 0.95
                },
                "missing_terms": [],
                "critique": ["strong candidate"],
                "result_summary": "Strong advisory package for the futures desk."
            },
            "leaderboard": [
                {"candidate_id": "seed-1", "style": "architect", "score": 0.91, "round": 0}
            ]
        }
      `.trim(), 'utf8');

      process.env.FRACTAL_FOUNDRY_PATH = fakeFoundryDir;
      const okRun = await runIntelligenceSupervisor();
      assert.equal(okRun.ok, true);
      assert.equal(okRun.run.status, 'recommended');
      assert.equal(okRun.run.source, 'foundry');
      assert.ok(okRun.run.score != null && okRun.run.score > 0);
      assert.ok(okRun.run.recommendedRules.length > 0);

      const latestAfterSuccess = getIntelligenceSupervisorLatest();
      assert.equal(latestAfterSuccess.latest?.id, okRun.run.id);
      assert.equal(latestAfterSuccess.latestAttempt?.id, okRun.run.id);
      assert.equal(Array.isArray(okRun.run.proposedChanges), true);

      delete process.env.FRACTAL_FOUNDRY_PATH;
      process.env.PYTHON_BIN = `missing-python-${Date.now()}`;
      const degradedRetry = await runIntelligenceSupervisor();
      assert.equal(['degraded', 'failed'].includes(degradedRetry.run.status), true);

      const latestAfterDegraded = getIntelligenceSupervisorLatest();
      assert.equal(latestAfterDegraded.latest?.id, okRun.run.id, 'latest successful package must survive degraded retries');
      assert.equal(['degraded', 'failed'].includes(latestAfterDegraded.latestAttempt?.status ?? ''), true);

      const history = getIntelligenceSupervisorHistory(10);
      assert.ok(history.length >= 2);
      assert.equal(history[0].id, latestAfterDegraded.latestAttempt?.id);
    } finally {
      rmSync(fakeFoundryDir, { recursive: true, force: true });
    }
  });

  test('apply flow writes runtime overrides only for recommended runs', () => {
    const runId = `intelligence-test-${Date.now()}`;
    db.prepare(`
      INSERT INTO intelligence_runs (
        id, mission_id, source, scope, status, advisory_only, provider_status,
        mission, candidate_summary, recommended_prompt, recommended_rules,
        score, risk_notes, justification, proposed_changes, artifacts, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      runId,
      'mission-1',
      'foundry',
      'futures_supervisor',
      'recommended',
      1,
      'ok',
      JSON.stringify({ id: 'mission-1', scope: 'futures_supervisor' }),
      JSON.stringify({ id: 'candidate-1' }),
      'paper only advisory only',
      JSON.stringify([]),
      0.9,
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify([
        {
          key: 'FUTURES_BREAKOUT_SHORT_MICRO_ENABLED',
          label: 'short_micro enabled',
          type: 'boolean',
          profileId: 'short_micro',
          currentValue: true,
          proposedValue: false,
          reason: 'pressure',
        },
      ]),
      JSON.stringify({}),
      new Date().toISOString(),
    );

    const beforeTrades = db.prepare(`SELECT COUNT(*) AS n FROM trades`).get()?.n ?? 0;
    const applied = applyIntelligenceSupervisorRun(runId, 'test');
    const afterTrades = db.prepare(`SELECT COUNT(*) AS n FROM trades`).get()?.n ?? 0;
    const reread = getIntelligenceSupervisorRunById(runId);
    const latest = getIntelligenceSupervisorLatest();

    assert.equal(afterTrades, beforeTrades, 'apply must never write trades');
    assert.equal(applied.ok, true);
    assert.equal(applied.state.active, true);
    assert.ok(typeof applied.expiresAt === 'string');
    assert.equal(reread?.status, 'recommended');
    assert.equal(latest.appliedPolicy.active, true);
    assert.equal(latest.appliedPolicy.sourceRunId, runId);
  });

  test('rollback clears active overrides without touching trades', () => {
    db.prepare(`
      INSERT OR REPLACE INTO org_state (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
    `).run('futures_runtime_policy_overrides', JSON.stringify({
      scope: 'futures_supervisor',
      sourceRunId: 'run-rollback',
      appliedAt: new Date().toISOString(),
      appliedBy: 'test',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      overrides: {
        FUTURES_BREAKOUT_SHORT_MICRO_ENABLED: false,
      },
    }));

    const beforeTrades = db.prepare(`SELECT COUNT(*) AS n FROM trades`).get()?.n ?? 0;
    const result = rollbackIntelligenceSupervisorOverrides('test', 'rollback test');
    const afterTrades = db.prepare(`SELECT COUNT(*) AS n FROM trades`).get()?.n ?? 0;
    const latest = getIntelligenceSupervisorLatest();

    assert.equal(beforeTrades, afterTrades);
    assert.equal(result.ok, true);
    assert.equal(latest.appliedPolicy.active, false);
  });
});
