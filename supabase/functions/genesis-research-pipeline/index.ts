declare const Deno: any;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
const RUNNER_TOKEN_SHA256 = 'e9f02987e836a6eaf8ef8d7afaed805580cd31264aef5ed86fc3ebb756c59d91';
const ENGINE_VERSION = 'qrp_v1';
const ALLOWED_NOVELTY = new Set(['ALLOW_NEW_HYPOTHESIS','ALLOW_RESEARCH_CHALLENGE','ALLOW_FORWARD_CONFIRMATION']);
const REST_HEADERS = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST,OPTIONS', 'access-control-allow-headers': 'content-type,x-genesis-runner-token,authorization' } });
}
async function sha256(value: string) { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
async function authorized(req: Request) { const supplied = (req.headers.get('x-genesis-runner-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '').trim(); return Boolean(supplied) && await sha256(supplied) === RUNNER_TOKEN_SHA256; }
async function rest(path: string, init: RequestInit = {}) { const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...REST_HEADERS, ...(init.headers || {}) }, signal: AbortSignal.timeout(8000) }); if (!response.ok) throw new Error(`supabase_${response.status}:${await response.text()}`); const text = await response.text(); return text ? JSON.parse(text) : null; }

function linkedExperiment(row: any, proposalId: string, fingerprint: string) {
  return row?.notes?.proposalId === proposalId || row?.evidence_policy?.hypothesisFingerprint === fingerprint || row?.evidence_policy?.hypothesis_fingerprint === fingerprint;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method !== 'POST') return json({ ok: false, engineVersion: ENGINE_VERSION, error: 'method_not_allowed' }, 405);
  if (!await authorized(req)) return json({ ok: false, engineVersion: ENGINE_VERSION, error: 'research_pipeline_auth_invalid' }, 403);

  try {
    const body = await req.json();
    const proposalId = String(body?.proposalId || '').trim();
    if (!proposalId) return json({ ok: false, engineVersion: ENGINE_VERSION, error: 'proposalId_required', executionAuthority: false, capitalEligible: false, liveOrders: false }, 400);

    const proposals = await rest(`quant_research_hypothesis_proposals?proposal_id=eq.${encodeURIComponent(proposalId)}&select=proposal_id,hypothesis_fingerprint,family,decision,canonical_spec,created_at&limit=1`);
    const proposal = proposals?.[0];
    if (!proposal) return json({ ok: false, engineVersion: ENGINE_VERSION, error: 'proposal_not_found', executionAuthority: false, capitalEligible: false, liveOrders: false }, 404);

    const fingerprint = String(proposal.hypothesis_fingerprint);
    const family = String(proposal.family);
    const noveltyDecision = String(proposal.decision || '');

    const [efgRows, experimentRows, authorityRows, latestEvents] = await Promise.all([
      rest(`quant_economic_feasibility_checks?proposal_id=eq.${encodeURIComponent(proposalId)}&select=check_id,engine_version,verdict,reason,gross_edge_bps,modeled_cost_bps,required_gross_bps,margin_bps,created_at&order=created_at.desc&limit=1`),
      rest(`quant_research_experiments?family=eq.${encodeURIComponent(family)}&select=experiment_key,stage,verdict,evidence_policy,notes,created_at&order=created_at.desc&limit=30`),
      rest('rpc/quant_research_backtest_allowed', { method: 'POST', body: JSON.stringify({ p_proposal_id: proposalId }) }),
      rest(`quant_research_pipeline_events?proposal_id=eq.${encodeURIComponent(proposalId)}&select=event_id,stage,economic_check_id,experiment_key,reason,created_at&order=created_at.desc&limit=1`),
    ]);

    const latestEfg = efgRows?.[0] ?? null;
    const experiment = (Array.isArray(experimentRows) ? experimentRows : []).find((row: any) => linkedExperiment(row, proposalId, fingerprint)) ?? null;
    const sqlBacktestAllowed = authorityRows === true || (Array.isArray(authorityRows) && authorityRows[0] === true);

    let stage = 'PROPOSED';
    let reason = 'Hypothesis proposal exists but has not yet cleared the research gates.';
    let researchComputeAuthority = false;

    if (experiment) {
      stage = 'LEDGER_SEALED';
      reason = `Research result is sealed in the append-only ledger as ${experiment.verdict}.`;
    } else if (!ALLOWED_NOVELTY.has(noveltyDecision)) {
      stage = 'NOVELTY_BLOCKED';
      reason = `Novelty gate decision ${noveltyDecision} does not authorize research.`;
    } else if (!latestEfg) {
      stage = 'NOVELTY_ACCEPTED';
      reason = 'Novelty gate passed; economic feasibility evidence is still required before research compute.';
    } else if (latestEfg.verdict === 'PASS_PREFILTER' && sqlBacktestAllowed) {
      stage = 'BACKTEST_ALLOWED';
      reason = 'Novelty and economic feasibility passed. Research compute is authorized; execution and capital remain locked.';
      researchComputeAuthority = true;
    } else if (latestEfg.verdict === 'NO_ACTIVE_SIGNAL') {
      stage = 'ECONOMIC_WAITING';
      reason = 'Economic model is registered, but the frozen signal is not active. Wait for new evidence; do not backtest opportunistically.';
    } else {
      stage = 'ECONOMIC_BLOCKED';
      reason = `Economic feasibility verdict ${latestEfg.verdict} blocks expensive research compute.`;
    }

    if (stage === 'BACKTEST_ALLOWED' && !sqlBacktestAllowed) {
      stage = 'ECONOMIC_BLOCKED';
      reason = 'Database authorization function denied research compute despite the apparent economic result.';
      researchComputeAuthority = false;
    }

    const latestEvent = latestEvents?.[0] ?? null;
    const economicCheckId = latestEfg?.check_id ?? null;
    const experimentKey = experiment?.experiment_key ?? null;
    const unchanged = latestEvent && latestEvent.stage === stage && (latestEvent.economic_check_id ?? null) === economicCheckId && (latestEvent.experiment_key ?? null) === experimentKey && latestEvent.reason === reason;

    let eventId = latestEvent?.event_id ?? null;
    let createdAt = latestEvent?.created_at ?? null;
    if (!unchanged) {
      const inserted = await rest('quant_research_pipeline_events?select=event_id,created_at', {
        method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
          proposal_id: proposalId,
          hypothesis_fingerprint: fingerprint,
          family,
          stage,
          novelty_decision: noveltyDecision,
          economic_check_id: economicCheckId,
          economic_verdict: latestEfg?.verdict ?? null,
          experiment_key: experimentKey,
          research_compute_authority: researchComputeAuthority,
          execution_authority: false,
          capital_eligible: false,
          live_orders: false,
          reason,
          details: {
            engineVersion: ENGINE_VERSION,
            sqlBacktestAllowed,
            economic: latestEfg ? {
              engineVersion: latestEfg.engine_version,
              grossEdgeBps: latestEfg.gross_edge_bps == null ? null : Number(latestEfg.gross_edge_bps),
              modeledCostBps: latestEfg.modeled_cost_bps == null ? null : Number(latestEfg.modeled_cost_bps),
              requiredGrossBps: latestEfg.required_gross_bps == null ? null : Number(latestEfg.required_gross_bps),
              marginBps: latestEfg.margin_bps == null ? null : Number(latestEfg.margin_bps),
              reason: latestEfg.reason,
            } : null,
            experiment: experiment ? { experimentKey: experiment.experiment_key, stage: experiment.stage, verdict: experiment.verdict } : null,
          },
        })
      });
      eventId = inserted?.[0]?.event_id ?? null;
      createdAt = inserted?.[0]?.created_at ?? null;
    }

    return json({
      ok: true,
      engineVersion: ENGINE_VERSION,
      proposalId,
      hypothesisFingerprint: fingerprint,
      family,
      stage,
      noveltyDecision,
      economicCheckId,
      economicVerdict: latestEfg?.verdict ?? null,
      experimentKey,
      researchComputeAuthority,
      sqlBacktestAllowed,
      reason,
      eventId,
      eventCreatedAt: createdAt,
      eventAppended: !unchanged,
      executionAuthority: false,
      capitalEligible: false,
      liveOrders: false,
    });
  } catch (error) {
    return json({ ok: false, engineVersion: ENGINE_VERSION, error: error instanceof Error ? error.message : 'research_pipeline_failed', executionAuthority: false, capitalEligible: false, liveOrders: false }, 500);
  }
});
