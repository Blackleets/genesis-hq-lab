declare const Deno: any;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
const STATUS_VERSION = 'qes_v1.1';
const FUTURES_STATE_KEY = 'quant_futures_native_market_v1';
const HEADERS = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,OPTIONS' } });
}
function parseJson<T>(value: unknown, fallback: T): T { if (typeof value !== 'string' || !value) return fallback; try { return JSON.parse(value) as T; } catch { return fallback; } }
async function rest(path: string) { const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HEADERS, signal: AbortSignal.timeout(7000) }); if (!response.ok) throw new Error(`rest_${response.status}:${await response.text()}`); return await response.json(); }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method !== 'GET') return json({ ok: false, statusVersion: STATUS_VERSION, error: 'method_not_allowed' }, 405);
  try {
    const [stateRows, checks, proposals, pipelineRows] = await Promise.all([
      rest(`org_state?key=eq.${FUTURES_STATE_KEY}&select=value,updated_at&limit=1`),
      rest('quant_economic_feasibility_checks?select=check_id,proposal_id,hypothesis_fingerprint,family,engine_version,mode,source_state_key,source_evidence_hash,observed_at,gross_edge_bps,modeled_cost_bps,safety_buffer_bps,required_gross_bps,edge_cost_ratio,margin_bps,verdict,reason,details,capital_eligible,live_orders,created_at&order=created_at.desc&limit=30'),
      rest('quant_research_hypothesis_proposals?select=proposal_id,hypothesis_fingerprint,family,decision,mode,novelty_basis,supersedes_reason,canonical_spec,execution_authority,capital_eligible,live_orders,created_at&order=created_at.desc&limit=30'),
      rest('quant_research_pipeline_latest?select=event_id,proposal_id,hypothesis_fingerprint,family,stage,novelty_decision,economic_check_id,economic_verdict,experiment_key,research_compute_authority,reason,details,created_at&order=created_at.desc&limit=30'),
    ]);
    const stateRow = stateRows?.[0];
    const futuresNativeMarket: any = parseJson(stateRow?.value, null);
    const economicChecks = Array.isArray(checks) ? checks.map((row: any) => ({
      checkId: row.check_id, proposalId: row.proposal_id, hypothesisFingerprint: row.hypothesis_fingerprint, family: row.family, engineVersion: row.engine_version, mode: row.mode,
      sourceStateKey: row.source_state_key, sourceEvidenceHash: row.source_evidence_hash, observedAt: row.observed_at,
      grossEdgeBps: row.gross_edge_bps == null ? null : Number(row.gross_edge_bps), modeledCostBps: row.modeled_cost_bps == null ? null : Number(row.modeled_cost_bps),
      safetyBufferBps: row.safety_buffer_bps == null ? null : Number(row.safety_buffer_bps), requiredGrossBps: row.required_gross_bps == null ? null : Number(row.required_gross_bps),
      edgeCostRatio: row.edge_cost_ratio == null ? null : Number(row.edge_cost_ratio), marginBps: row.margin_bps == null ? null : Number(row.margin_bps), verdict: row.verdict, reason: row.reason,
      details: row.details ?? {}, capitalEligible: row.capital_eligible === true, liveOrders: row.live_orders === true, createdAt: row.created_at,
    })) : [];
    const hypothesisProposals = Array.isArray(proposals) ? proposals.map((row: any) => ({
      proposalId: row.proposal_id, hypothesisFingerprint: row.hypothesis_fingerprint, family: row.family, decision: row.decision, mode: row.mode, noveltyBasis: row.novelty_basis,
      supersedesReason: row.supersedes_reason, canonicalSpec: row.canonical_spec ?? {}, executionAuthority: row.execution_authority === true, capitalEligible: row.capital_eligible === true, liveOrders: row.live_orders === true, createdAt: row.created_at,
    })) : [];
    const pipeline = Array.isArray(pipelineRows) ? pipelineRows.map((row: any) => ({
      eventId: row.event_id, proposalId: row.proposal_id, hypothesisFingerprint: row.hypothesis_fingerprint, family: row.family, stage: row.stage,
      noveltyDecision: row.novelty_decision, economicCheckId: row.economic_check_id, economicVerdict: row.economic_verdict, experimentKey: row.experiment_key,
      researchComputeAuthority: row.research_compute_authority === true, reason: row.reason, details: row.details ?? {}, createdAt: row.created_at,
    })) : [];
    const latestByFamily: Record<string, any> = {};
    for (const check of economicChecks) if (!latestByFamily[check.family]) latestByFamily[check.family] = check;
    const feasibilitySummary = {
      checks: economicChecks.length,
      passPrefilter: economicChecks.filter((c: any) => c.verdict === 'PASS_PREFILTER').length,
      failEconomics: economicChecks.filter((c: any) => c.verdict === 'FAIL_ECONOMICS').length,
      noActiveSignal: economicChecks.filter((c: any) => c.verdict === 'NO_ACTIVE_SIGNAL').length,
      dataBlocked: economicChecks.filter((c: any) => c.verdict === 'DATA_BLOCKED').length,
      latestByFamily,
    };
    const pipelineSummary = {
      proposalsTracked: pipeline.length,
      noveltyAccepted: pipeline.filter((r: any) => r.stage === 'NOVELTY_ACCEPTED').length,
      noveltyBlocked: pipeline.filter((r: any) => r.stage === 'NOVELTY_BLOCKED').length,
      economicWaiting: pipeline.filter((r: any) => r.stage === 'ECONOMIC_WAITING').length,
      economicBlocked: pipeline.filter((r: any) => r.stage === 'ECONOMIC_BLOCKED').length,
      backtestAllowed: pipeline.filter((r: any) => r.stage === 'BACKTEST_ALLOWED' && r.researchComputeAuthority).length,
      ledgerSealed: pipeline.filter((r: any) => r.stage === 'LEDGER_SEALED').length,
      computeAuthorities: pipeline.filter((r: any) => r.researchComputeAuthority).length,
    };
    return json({
      ok: true,
      statusVersion: STATUS_VERSION,
      mode: 'READ_ONLY_EVIDENCE',
      executionAuthority: false,
      capitalEligible: false,
      liveOrders: false,
      futuresNativeMarket: futuresNativeMarket ? { ...futuresNativeMarket, stateUpdatedAt: stateRow?.updated_at ?? null } : null,
      economicFeasibility: { engineVersion: economicChecks[0]?.engineVersion ?? null, summary: feasibilitySummary, checks: economicChecks },
      hypothesisGate: { engineVersion: 'hng_v1', proposals: hypothesisProposals, latest: hypothesisProposals[0] ?? null },
      researchPipeline: { engineVersion: 'qrp_v1', summary: pipelineSummary, latest: pipeline, policy: 'research compute authority exists only when the novelty decision is allowed and the latest economic verdict is PASS_PREFILTER' },
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return json({ ok: false, statusVersion: STATUS_VERSION, mode: 'READ_ONLY_EVIDENCE', executionAuthority: false, capitalEligible: false, liveOrders: false, error: error instanceof Error ? error.message : 'quant_evidence_status_failed' }, 500);
  }
});
