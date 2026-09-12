// mevShadowLedger.mjs
// Append-only evidence ledger for the benign MEV SHADOW lane.
//
// Important: rows are opportunities/evaluations, NOT realized profits.
// No execution happens here. The ledger exists so Genesis can measure whether
// a recurring edge survives costs over time instead of cherry-picking screenshots.

import { createHash } from 'node:crypto';
import db from '../db/database.mjs';
import { ENGINE_VERSION, MODE, EXECUTION_AUTHORITY } from './mevArbitrageShadow.mjs';

let ready = false;

function ensureTable() {
  if (ready) return;
  db.prepare(`
    CREATE TABLE IF NOT EXISTS mev_shadow_ledger (
      id TEXT PRIMARY KEY,
      captured_at TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      engine_version TEXT NOT NULL,
      route_fingerprint TEXT NOT NULL,
      chain_id TEXT,
      block_number TEXT,
      token_in TEXT,
      token_out TEXT,
      buy_dex TEXT,
      sell_dex TEXT,
      amount_in REAL,
      gross_pnl_usd REAL,
      total_costs_usd REAL,
      net_pnl_usd REAL,
      stress_net_pnl_usd REAL,
      expected_net_pnl_usd REAL,
      net_edge_bps REAL,
      robustness_score INTEGER,
      verdict TEXT NOT NULL,
      blockers_json TEXT NOT NULL,
      payload_json TEXT NOT NULL
    )
  `).run();
  db.prepare(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_mev_shadow_route_capture
    ON mev_shadow_ledger(engine_version, route_fingerprint, captured_at)
  `).run();
  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_mev_shadow_captured
    ON mev_shadow_ledger(captured_at DESC)
  `).run();
  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_mev_shadow_verdict
    ON mev_shadow_ledger(verdict, captured_at DESC)
  `).run();
  ready = true;
}

function eventId(evaluation) {
  return createHash('sha256')
    .update(`${evaluation.engineVersion ?? ENGINE_VERSION}|${evaluation.routeFingerprint}|${evaluation.capturedAt}`)
    .digest('hex')
    .slice(0, 32);
}

function assertShadowEvaluation(evaluation) {
  if (!evaluation || typeof evaluation !== 'object') throw new TypeError('evaluation_required');
  if (evaluation.mode !== MODE) throw new Error('mev_ledger_rejects_non_shadow_mode');
  if (evaluation.executionAuthority !== EXECUTION_AUTHORITY || evaluation.executionAuthority !== false) {
    throw new Error('mev_ledger_rejects_execution_authority');
  }
  if (!evaluation.routeFingerprint || !evaluation.capturedAt || !evaluation.verdict) {
    throw new Error('mev_ledger_missing_identity');
  }
}

export function recordMevShadowEvent(evaluation) {
  assertShadowEvaluation(evaluation);
  ensureTable();
  const id = eventId(evaluation);
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO mev_shadow_ledger (
      id, captured_at, recorded_at, engine_version, route_fingerprint,
      chain_id, block_number, token_in, token_out, buy_dex, sell_dex,
      amount_in, gross_pnl_usd, total_costs_usd, net_pnl_usd,
      stress_net_pnl_usd, expected_net_pnl_usd, net_edge_bps,
      robustness_score, verdict, blockers_json, payload_json
    ) VALUES (
      @id, @capturedAt, @recordedAt, @engineVersion, @routeFingerprint,
      @chainId, @blockNumber, @tokenIn, @tokenOut, @buyDex, @sellDex,
      @amountIn, @grossPnlUsd, @totalCostsUsd, @netPnlUsd,
      @stressNetPnlUsd, @expectedNetPnlUsd, @netEdgeBps,
      @robustnessScore, @verdict, @blockersJson, @payloadJson
    )
  `);
  const info = stmt.run({
    id,
    capturedAt: evaluation.capturedAt,
    recordedAt: now,
    engineVersion: evaluation.engineVersion ?? ENGINE_VERSION,
    routeFingerprint: evaluation.routeFingerprint,
    chainId: evaluation.chainId == null ? null : String(evaluation.chainId),
    blockNumber: evaluation.blockNumber == null ? null : String(evaluation.blockNumber),
    tokenIn: evaluation.tokenIn ?? null,
    tokenOut: evaluation.tokenOut ?? null,
    buyDex: evaluation.buyDex ?? null,
    sellDex: evaluation.sellDex ?? null,
    amountIn: evaluation.amountIn ?? null,
    grossPnlUsd: evaluation.grossPnlUsd ?? null,
    totalCostsUsd: evaluation.totalCostsUsd ?? null,
    netPnlUsd: evaluation.netPnlUsd ?? null,
    stressNetPnlUsd: evaluation.stressNetPnlUsd ?? null,
    expectedNetPnlUsd: evaluation.expectedNetPnlUsd ?? null,
    netEdgeBps: evaluation.netEdgeBps ?? null,
    robustnessScore: evaluation.robustnessScore ?? null,
    verdict: evaluation.verdict,
    blockersJson: JSON.stringify(evaluation.blockers ?? []),
    payloadJson: JSON.stringify(evaluation),
  });
  return { id, inserted: info.changes === 1 };
}

export function recordMevShadowBatch(evaluations = []) {
  ensureTable();
  const insertMany = db.transaction((rows) => rows.map(recordMevShadowEvent));
  return insertMany(evaluations);
}

export function getMevShadowEvents({ limit = 100, verdict = null } = {}) {
  ensureTable();
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 100));
  const rows = verdict
    ? db.prepare(`SELECT * FROM mev_shadow_ledger WHERE verdict = ? ORDER BY captured_at DESC LIMIT ?`).all(verdict, safeLimit)
    : db.prepare(`SELECT * FROM mev_shadow_ledger ORDER BY captured_at DESC LIMIT ?`).all(safeLimit);
  return rows.map((row) => ({
    ...row,
    blockers: JSON.parse(row.blockers_json || '[]'),
    payload: JSON.parse(row.payload_json || '{}'),
  }));
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function summarizeMevShadowRows(rows = []) {
  const candidates = rows.filter((r) => r.verdict === 'SHADOW_CANDIDATE');
  const knownNet = rows.filter((r) => Number.isFinite(Number(r.net_pnl_usd ?? r.netPnlUsd)));
  const candidateNet = candidates
    .map((r) => Number(r.net_pnl_usd ?? r.netPnlUsd))
    .filter(Number.isFinite);
  const edges = candidates
    .map((r) => Number(r.net_edge_bps ?? r.netEdgeBps))
    .filter(Number.isFinite);
  const expected = candidates
    .map((r) => Number(r.expected_net_pnl_usd ?? r.expectedNetPnlUsd))
    .filter(Number.isFinite);
  const stress = candidates
    .map((r) => Number(r.stress_net_pnl_usd ?? r.stressNetPnlUsd))
    .filter(Number.isFinite);

  return {
    mode: MODE,
    executionAuthority: EXECUTION_AUTHORITY,
    engineVersion: ENGINE_VERSION,
    evaluated: rows.length,
    candidates: candidates.length,
    noGo: rows.length - candidates.length,
    candidateRate: rows.length ? candidates.length / rows.length : 0,
    knownNetEconomics: knownNet.length,
    theoreticalCandidateNetPnlUsd: candidateNet.reduce((sum, v) => sum + v, 0),
    theoreticalExpectedNetPnlUsd: expected.reduce((sum, v) => sum + v, 0),
    theoreticalStressNetPnlUsd: stress.reduce((sum, v) => sum + v, 0),
    medianCandidateNetEdgeBps: median(edges),
    note: 'Opportunity economics only; not realized account PnL.',
  };
}

export function getMevShadowSummary({ hours = 24 } = {}) {
  ensureTable();
  const safeHours = Math.max(1, Math.min(24 * 90, Number(hours) || 24));
  const rows = db.prepare(`
    SELECT verdict, net_pnl_usd, expected_net_pnl_usd, stress_net_pnl_usd, net_edge_bps
    FROM mev_shadow_ledger
    WHERE captured_at >= datetime('now', ?)
    ORDER BY captured_at ASC
  `).all(`-${safeHours} hours`);
  return { ...summarizeMevShadowRows(rows), hours: safeHours };
}
