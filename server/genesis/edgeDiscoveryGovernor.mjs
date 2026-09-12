export const EDGE_DISCOVERY_GOVERNOR_VERSION = 'edge_discovery_governor_v1';

export const GOVERNOR_POLICY = Object.freeze({
  maxQueue: 24,
  maxPerHypothesis: 5,
  forwardGate: {
    minTrades: 20,
    minExpectancyBps: 0,
    minProfitFactor: 1.2,
    minTStat: 1,
    maxDrawdownPct: 12,
  },
});

const finite = (value) => {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export function assertResearchBoundary(label, value) {
  if (!value) return;
  if (value.paperOnly !== true || value.liveOrders !== false || value.executionAuthority !== false || value.capitalEligible !== false) {
    throw new Error(`edge_discovery_boundary_failed:${label}`);
  }
}

function deepRejectedFamily(adaptive) {
  const control = adaptive?.control;
  if (!control || control.researchStatus !== 'REJECT') return null;
  const trainExp = finite(control.train?.expectancyBps);
  const walkPass = control.walkForward?.pass === true;
  if (trainExp != null && trainExp <= 0 && !walkPass) return control.hypothesisKey || null;
  return null;
}

function forwardPass(metrics, gate) {
  const trades = finite(metrics?.trades) ?? 0;
  const expectancy = finite(metrics?.expectancyBps);
  const pf = finite(metrics?.profitFactor);
  const tStat = finite(metrics?.tStat);
  const dd = finite(metrics?.maxDrawdownPct);
  return trades >= gate.minTrades
    && expectancy != null && expectancy > gate.minExpectancyBps
    && pf != null && pf >= gate.minProfitFactor
    && tStat != null && tStat >= gate.minTStat
    && dd != null && dd <= gate.maxDrawdownPct;
}

export function evaluateForwardEvidence(forward, gate = GOVERNOR_POLICY.forwardGate) {
  const families = Array.isArray(forward?.families) ? forward.families : [];
  return families.map((family) => {
    const proven = forwardPass(family.championForward, gate);
    return {
      familyKey: family.familyKey,
      championId: family.championId ?? null,
      trades: finite(family.championForward?.trades) ?? 0,
      expectancyBps: finite(family.championForward?.expectancyBps),
      profitFactor: finite(family.championForward?.profitFactor),
      tStat: finite(family.championForward?.tStat),
      maxDrawdownPct: finite(family.championForward?.maxDrawdownPct),
      status: proven ? 'EDGE_PROVEN_FORWARD' : 'FORWARD_SAMPLE_BUILDING',
      proven,
      liveEligible: false,
    };
  });
}

function roundRobin(items, maxPerHypothesis, maxTotal) {
  const groups = new Map();
  for (const item of items) {
    const key = String(item.hypothesisKey || 'UNATTRIBUTED');
    if (!groups.has(key)) groups.set(key, []);
    const group = groups.get(key);
    if (group.length < maxPerHypothesis) group.push(item);
  }
  const keys = [...groups.keys()];
  const out = [];
  let depth = 0;
  while (out.length < maxTotal) {
    let added = false;
    for (const key of keys) {
      const item = groups.get(key)?.[depth];
      if (!item) continue;
      out.push(item);
      added = true;
      if (out.length >= maxTotal) break;
    }
    if (!added) break;
    depth += 1;
  }
  return out;
}

export function governHypothesisQueue({ edge, rawHypotheses, adaptive, audit, forward, deepLedger }, policy = GOVERNOR_POLICY) {
  for (const [label, value] of Object.entries({ edge, rawHypotheses, adaptive, audit, forward, deepLedger })) {
    assertResearchBoundary(label, value);
  }

  const durableKilled = new Set(Object.keys(deepLedger?.killed ?? {}));
  const forwardEnrolled = new Set((forward?.families ?? []).map((family) => family?.familyKey).filter(Boolean));
  const auditExhausted = new Set(audit?.exhaustedFamilies ?? []);
  const currentDeepReject = deepRejectedFamily(adaptive);
  if (currentDeepReject) durableKilled.add(currentDeepReject);

  const rawQueue = Array.isArray(rawHypotheses?.queue) ? rawHypotheses.queue : [];
  const unique = new Map();
  const suppressed = [];

  for (const item of rawQueue) {
    const hypothesisKey = String(item?.hypothesisKey || 'UNATTRIBUTED');
    const id = String(item?.id || `${hypothesisKey}:${unique.size}`);
    let reason = null;
    if (durableKilled.has(hypothesisKey)) reason = 'DEEP_REJECTED';
    else if (forwardEnrolled.has(hypothesisKey)) reason = 'FORWARD_ALREADY_ENROLLED';
    else if (auditExhausted.has(hypothesisKey)) reason = 'AUDIT_BUDGET_EXHAUSTED';
    if (reason) {
      suppressed.push({ id, hypothesisKey, reason });
      continue;
    }
    if (!unique.has(id)) unique.set(id, item);
  }

  const governedQueue = roundRobin([...unique.values()], policy.maxPerHypothesis, policy.maxQueue);
  const forwardEvidence = evaluateForwardEvidence(forward, policy.forwardGate);
  const provenForward = forwardEvidence.filter((item) => item.proven);
  const contradictions = [];

  if (edge?.verdict === 'PAPER_CANDIDATE_FOUND' && adaptive?.verdict === 'NO_ADAPTIVE_EDGE_FOUND') {
    contradictions.push({
      type: 'SHORT_WINDOW_VS_DEEP_RETEST',
      severity: 'HIGH',
      action: 'DO_NOT_PROMOTE_FROM_FAST_FACTORY',
      explanation: 'Fast research found candidates while the deeper adaptive retest found no promotable edge. Treat fast candidates as hypotheses only.',
    });
  }

  let discoveryStatus = 'SEARCHING_FOR_EDGE';
  if (provenForward.length > 0) discoveryStatus = 'EDGE_PROVEN_FORWARD';
  else if (forwardEvidence.length > 0) discoveryStatus = 'FORWARD_EVIDENCE_ACCUMULATING';
  else if ((audit?.totalPassedRegistered ?? 0) > 0) discoveryStatus = 'AUDIT_SURVIVORS_WAITING_FORWARD';

  const governedHypotheses = {
    ok: true,
    version: 'edge_hypotheses_governed_v1',
    mode: 'RESEARCH_ONLY',
    paperOnly: true,
    liveOrders: false,
    executionAuthority: false,
    capitalEligible: false,
    completedAt: new Date().toISOString(),
    sourceCompletedAt: rawHypotheses?.completedAt ?? null,
    governedBy: EDGE_DISCOVERY_GOVERNOR_VERSION,
    methodology: {
      holdoutNeverSelectsMutations: true,
      deepRetestCanVetoFastResearch: true,
      forwardEnrolledSuppression: true,
      durableDeepRejectSuppression: true,
      auditBudgetSuppression: true,
      diversityRoundRobin: true,
      maxQueue: policy.maxQueue,
      maxPerHypothesis: policy.maxPerHypothesis,
    },
    queueSize: governedQueue.length,
    queue: governedQueue,
  };

  const report = {
    ok: true,
    version: EDGE_DISCOVERY_GOVERNOR_VERSION,
    mode: 'RESEARCH_ONLY',
    paperOnly: true,
    liveOrders: false,
    executionAuthority: false,
    capitalEligible: false,
    completedAt: governedHypotheses.completedAt,
    discoveryStatus,
    objective: 'REPRODUCIBLE_POSITIVE_NET_EXPECTANCY',
    fastResearch: {
      verdict: edge?.verdict ?? null,
      tested: edge?.tested ?? null,
      paperCandidates: edge?.paperCandidates ?? null,
      researchPoolSize: edge?.researchPoolSize ?? null,
      proofStatus: 'HYPOTHESIS_ONLY',
    },
    deepResearch: {
      verdict: adaptive?.verdict ?? null,
      promotableToAudit: adaptive?.promotableToAudit ?? null,
      currentDeepRejectedFamily: currentDeepReject,
    },
    audit: {
      verdict: audit?.verdict ?? null,
      totalPassedRegistered: audit?.totalPassedRegistered ?? 0,
      exhaustedFamilies: [...auditExhausted],
    },
    forward: {
      familyCount: forwardEvidence.length,
      provenCount: provenForward.length,
      families: forwardEvidence,
    },
    hypothesisGovernance: {
      rawQueueSize: rawQueue.length,
      governedQueueSize: governedQueue.length,
      familyCount: new Set(governedQueue.map((item) => item.hypothesisKey)).size,
      suppressedCount: suppressed.length,
      suppressed,
    },
    contradictions,
    decision: provenForward.length > 0
      ? 'KEEP_PROVEN_EDGE_IN_PAPER_VALIDATION'
      : 'CONTINUE_DISCOVERY_AND_ACCUMULATE_FORWARD_EVIDENCE',
    invariants: {
      changesV9: false,
      changesRunnerParameters: false,
      opensTrades: false,
      closesTrades: false,
      unlocksLive: false,
      liveLockedRequired: true,
    },
  };

  return { governedHypotheses, report };
}
