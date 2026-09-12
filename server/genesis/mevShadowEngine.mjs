// mevShadowEngine.mjs
// Orchestrates the benign MEV research pipeline without ever gaining execution authority.
//
// raw quote snapshots -> institutional evaluator -> append-only evidence -> ranked candidates

import {
  evaluateAtomicDexArb,
  rankMevCandidates,
  MODE,
  EXECUTION_AUTHORITY,
  ENGINE_VERSION,
} from './mevArbitrageShadow.mjs';
import {
  recordMevShadowBatch,
  summarizeMevShadowRows,
} from './mevShadowLedger.mjs';

export function evaluateMevShadowBatch(opportunities = [], { persist = false } = {}) {
  const evaluations = opportunities.map((opportunity) => evaluateAtomicDexArb(opportunity));

  // Persistence is explicit, never implicit. This prevents a parser/provider bug
  // from silently turning arbitrary input into evidence.
  let persistence = [];
  if (persist) persistence = recordMevShadowBatch(evaluations.filter((row) => row.executable));

  const ranked = rankMevCandidates(evaluations);
  const candidates = ranked.filter((row) => row.verdict === 'SHADOW_CANDIDATE');
  const rejected = evaluations.filter((row) => row.verdict !== 'SHADOW_CANDIDATE');

  return {
    mode: MODE,
    executionAuthority: EXECUTION_AUTHORITY,
    engineVersion: ENGINE_VERSION,
    evaluatedAt: new Date().toISOString(),
    summary: summarizeMevShadowRows(evaluations.map((row) => ({
      verdict: row.verdict,
      netPnlUsd: row.netPnlUsd,
      expectedNetPnlUsd: row.expectedNetPnlUsd,
      stressNetPnlUsd: row.stressNetPnlUsd,
      netEdgeBps: row.netEdgeBps,
    }))),
    candidates,
    rejected,
    persistence,
  };
}
