declare const Deno: any;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
const RUNNER_TOKEN_SHA256 = 'e9f02987e836a6eaf8ef8d7afaed805580cd31264aef5ed86fc3ebb756c59d91';
const ENGINE_VERSION = 'efg_v1';
const FUTURES_STATE_KEY = 'quant_futures_native_market_v1';
const REST_HEADERS = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST,OPTIONS', 'access-control-allow-headers': 'content-type,x-genesis-runner-token,authorization' } });
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function authorized(req: Request) {
  const supplied = (req.headers.get('x-genesis-runner-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '').trim();
  return Boolean(supplied) && await sha256(supplied) === RUNNER_TOKEN_SHA256;
}
async function rest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...REST_HEADERS, ...(init.headers || {}) }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`supabase_${response.status}:${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
function parseJson<T>(value: unknown, fallback: T): T { if (typeof value !== 'string' || !value) return fallback; try { return JSON.parse(value) as T; } catch { return fallback; } }
function round(value: number, digits = 4) { const s = 10 ** digits; return Math.round(value * s) / s; }
function intervalHours(interval: string) { const m = String(interval || '').match(/^(\d+)([mhd])$/); if (!m) return 4; const n = Number(m[1]); return m[2] === 'm' ? n / 60 : m[2] === 'h' ? n : n * 24; }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method !== 'POST') return json({ ok: false, engineVersion: ENGINE_VERSION, error: 'method_not_allowed' }, 405);
  if (!await authorized(req)) return json({ ok: false, engineVersion: ENGINE_VERSION, error: 'economic_gate_auth_invalid' }, 403);

  try {
    const body = await req.json();
    const proposalId = String(body?.proposalId || '').trim();
    if (!proposalId) return json({ ok: false, engineVersion: ENGINE_VERSION, error: 'proposalId_required', executionAuthority: false, capitalEligible: false, liveOrders: false }, 400);

    const proposals = await rest(`quant_research_hypothesis_proposals?proposal_id=eq.${encodeURIComponent(proposalId)}&select=proposal_id,hypothesis_fingerprint,family,decision,canonical_spec,cost_model,created_at&limit=1`);
    const proposal = proposals?.[0];
    if (!proposal) return json({ ok: false, engineVersion: ENGINE_VERSION, error: 'proposal_not_found', executionAuthority: false, capitalEligible: false, liveOrders: false }, 404);
    if (!['ALLOW_NEW_HYPOTHESIS','ALLOW_RESEARCH_CHALLENGE','ALLOW_FORWARD_CONFIRMATION'].includes(String(proposal.decision))) {
      return json({ ok: true, engineVersion: ENGINE_VERSION, verdict: 'DATA_BLOCKED', reason: `Hypothesis gate decision ${proposal.decision} does not authorize research.`, proposalId, hypothesisFingerprint: proposal.hypothesis_fingerprint, executionAuthority: false, capitalEligible: false, liveOrders: false });
    }

    const spec = proposal.canonical_spec || {};
    const family = String(proposal.family || 'UNKNOWN');
    const dataClass = String(spec.dataClass || '').toLowerCase();
    if (!dataClass.includes('binance_usdm')) {
      return json({ ok: true, engineVersion: ENGINE_VERSION, verdict: 'DATA_BLOCKED', reason: 'efg_v1 currently supports trusted Binance USD-M futures evidence only.', proposalId, hypothesisFingerprint: proposal.hypothesis_fingerprint, family, executionAuthority: false, capitalEligible: false, liveOrders: false });
    }

    const stateRows = await rest(`org_state?key=eq.${FUTURES_STATE_KEY}&select=value,updated_at&limit=1`);
    const stateRow = stateRows?.[0];
    const state: any = parseJson(stateRow?.value, null);
    if (!state?.ok || state?.spotReferenceUsed !== false || !state?.evidence) {
      return json({ ok: true, engineVersion: ENGINE_VERSION, verdict: 'DATA_BLOCKED', reason: 'Trusted futures-native market evidence is missing or invalid.', proposalId, hypothesisFingerprint: proposal.hypothesis_fingerprint, family, executionAuthority: false, capitalEligible: false, liveOrders: false });
    }

    const assets: string[] = Array.isArray(spec?.universe?.assets) ? spec.universe.assets.map((v: unknown) => String(v).toUpperCase()) : [];
    const params = spec?.params || {};
    const costModel = proposal.cost_model || spec?.costModel || {};
    const modeledCostBps = Number(costModel.roundTripBps ?? 0);
    const safetyBufferBps = Math.max(5, modeledCostBps * 0.5);
    const requiredGrossBps = modeledCostBps + safetyBufferBps;
    const maxHoldHours = Number(params.maxHoldBars ?? 1) * intervalHours(String(params.interval || '4h'));
    const fundingIntervals = Math.max(1, Math.ceil(maxHoldHours / 8));
    const entryZ = Number(params.entryZ ?? 0);

    const rows = assets.map((symbol) => {
      const ev = state.evidence?.[symbol];
      const market = ev?.market || {};
      const basisBps = Number(market.basisBps);
      const fundingRate = Number(market.lastFundingRate);
      const premiumZ = Number(market.premiumZ7d);
      const fresh = ev?.freshness?.fresh === true;
      const activeSignal = Number.isFinite(premiumZ) && entryZ > 0 ? Math.abs(premiumZ) >= entryZ : true;
      const direction = Number.isFinite(basisBps) && basisBps < 0 ? 'LONG_PERP_SHORT_SPOT' : 'SHORT_PERP_LONG_SPOT';
      const fundingCarryBps = Number.isFinite(fundingRate) ? (direction.startsWith('SHORT') ? 1 : -1) * fundingRate * 10000 * fundingIntervals : 0;
      const grossEdgeBps = Number.isFinite(basisBps) ? Math.max(0, Math.abs(basisBps) + fundingCarryBps) : null;
      const ratio = grossEdgeBps != null && modeledCostBps > 0 ? grossEdgeBps / modeledCostBps : null;
      return { symbol, fresh, activeSignal, premiumZ: Number.isFinite(premiumZ) ? round(premiumZ) : null, basisBps: Number.isFinite(basisBps) ? round(basisBps) : null, fundingRate: Number.isFinite(fundingRate) ? fundingRate : null, fundingIntervals, fundingCarryBps: round(fundingCarryBps), grossEdgeBps: grossEdgeBps == null ? null : round(grossEdgeBps), requiredGrossBps: round(requiredGrossBps), edgeCostRatio: ratio == null ? null : round(ratio), sourceEvidenceHash: ev?.evidenceHashSha256 ?? null };
    });

    const usable = rows.filter((r) => r.fresh && r.grossEdgeBps != null);
    const active = usable.filter((r) => r.activeSignal);
    let verdict = 'DATA_BLOCKED';
    let reason = 'No fresh futures-native evidence was available for the proposal universe.';
    let selected: any = null;
    if (usable.length && !active.length) {
      verdict = 'NO_ACTIVE_SIGNAL';
      reason = 'Evidence is fresh, but the frozen entry condition is not currently active. No economic conclusion is inferred.';
    } else if (active.length) {
      selected = [...active].sort((a, b) => Number(b.grossEdgeBps ?? -Infinity) - Number(a.grossEdgeBps ?? -Infinity))[0];
      if (Number(selected.grossEdgeBps) >= requiredGrossBps) {
        verdict = 'PASS_PREFILTER';
        reason = 'At least one active futures-native opportunity exceeds modeled round-trip cost plus the safety buffer. This authorizes research compute only, not capital.';
      } else {
        verdict = 'FAIL_ECONOMICS';
        reason = 'Active gross opportunity does not clear modeled round-trip cost plus the safety buffer; expensive backtesting is not justified.';
      }
    }

    const sourceHash = await sha256(JSON.stringify(rows.map((r) => ({ symbol: r.symbol, sourceEvidenceHash: r.sourceEvidenceHash }))));
    const insert = {
      proposal_id: proposal.proposal_id,
      hypothesis_fingerprint: proposal.hypothesis_fingerprint,
      family,
      engine_version: ENGINE_VERSION,
      mode: 'FUTURES_BASIS_SNAPSHOT',
      source_state_key: FUTURES_STATE_KEY,
      source_evidence_hash: sourceHash,
      observed_at: state.completedAt ?? stateRow?.updated_at ?? new Date().toISOString(),
      gross_edge_bps: selected?.grossEdgeBps ?? null,
      modeled_cost_bps: modeledCostBps,
      safety_buffer_bps: safetyBufferBps,
      required_gross_bps: requiredGrossBps,
      edge_cost_ratio: selected?.edgeCostRatio ?? null,
      margin_bps: selected?.grossEdgeBps == null ? null : Number(selected.grossEdgeBps) - requiredGrossBps,
      verdict,
      reason,
      details: { assets: rows, entryZ, maxHoldHours, fundingIntervals, proposalDecision: proposal.decision, dataClass, policy: 'gross opportunity must exceed modeled round-trip cost + max(5bps, 50% cost)' },
      execution_authority: false,
      capital_eligible: false,
      live_orders: false,
    };
    const created = await rest('quant_economic_feasibility_checks?select=check_id,created_at', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(insert) });

    return json({ ok: true, engineVersion: ENGINE_VERSION, checkId: created?.[0]?.check_id ?? null, createdAt: created?.[0]?.created_at ?? null, proposalId, hypothesisFingerprint: proposal.hypothesis_fingerprint, family, verdict, reason, modeledCostBps: round(modeledCostBps), safetyBufferBps: round(safetyBufferBps), requiredGrossBps: round(requiredGrossBps), selectedOpportunity: selected, assets: rows, executionAuthority: false, capitalEligible: false, liveOrders: false });
  } catch (error) {
    return json({ ok: false, engineVersion: ENGINE_VERSION, error: error instanceof Error ? error.message : 'economic_gate_failed', executionAuthority: false, capitalEligible: false, liveOrders: false }, 500);
  }
});
