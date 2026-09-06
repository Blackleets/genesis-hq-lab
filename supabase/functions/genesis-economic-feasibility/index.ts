declare const Deno: any;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
const RUNNER_TOKEN_SHA256 = 'e9f02987e836a6eaf8ef8d7afaed805580cd31264aef5ed86fc3ebb756c59d91';
const ENGINE_VERSION = 'efg_v1.2';
const FUTURES_STATE_KEY = 'quant_futures_native_market_v1';
const SUPPORTED_FAMILIES = new Set(['CRYPTO_BASIS_MEAN_REVERSION', 'CRYPTO_CROSS_ASSET_FUNDING_SPREAD']);
const REST_HEADERS = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST,OPTIONS', 'access-control-allow-headers': 'content-type,x-genesis-runner-token,authorization' } });
}
async function sha256(value: string) { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
async function authorized(req: Request) { const supplied = (req.headers.get('x-genesis-runner-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '').trim(); return Boolean(supplied) && await sha256(supplied) === RUNNER_TOKEN_SHA256; }
async function rest(path: string, init: RequestInit = {}) { const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...REST_HEADERS, ...(init.headers || {}) }, signal: AbortSignal.timeout(8000) }); if (!response.ok) throw new Error(`supabase_${response.status}:${await response.text()}`); const text = await response.text(); return text ? JSON.parse(text) : null; }
function parseJson<T>(value: unknown, fallback: T): T { if (typeof value !== 'string' || !value) return fallback; try { return JSON.parse(value) as T; } catch { return fallback; } }
function round(value: number, digits = 4) { const s = 10 ** digits; return Math.round(value * s) / s; }
function intervalHours(interval: string) { const m = String(interval || '').match(/^(\d+)([mhd])$/); if (!m) return 4; const n = Number(m[1]); return m[2] === 'm' ? n / 60 : m[2] === 'h' ? n : n * 24; }

function basisAssessment(spec: any, state: any, modeledCostBps: number) {
  const assets: string[] = Array.isArray(spec?.universe?.assets) ? spec.universe.assets.map((v: unknown) => String(v).toUpperCase()) : [];
  const params = spec?.params || {};
  const safetyBufferBps = Math.max(5, modeledCostBps * 0.5);
  const requiredGrossBps = modeledCostBps + safetyBufferBps;
  const maxHoldHours = Number(params.maxHoldBars ?? 1) * intervalHours(String(params.interval || '4h'));
  const fundingIntervals = Math.max(1, Math.ceil(maxHoldHours / 8));
  const entryZ = Number(params.entryZ ?? 0);
  const rows = assets.map((symbol) => {
    const ev = state.evidence?.[symbol]; const market = ev?.market || {};
    const basisBps = Number(market.basisBps), fundingRate = Number(market.lastFundingRate), premiumZ = Number(market.premiumZ7d);
    const fresh = ev?.freshness?.fresh === true;
    const activeSignal = Number.isFinite(premiumZ) && entryZ > 0 ? Math.abs(premiumZ) >= entryZ : true;
    const direction = Number.isFinite(basisBps) && basisBps < 0 ? 'LONG_PERP_SHORT_SPOT' : 'SHORT_PERP_LONG_SPOT';
    const fundingCarryBps = Number.isFinite(fundingRate) ? (direction.startsWith('SHORT') ? 1 : -1) * fundingRate * 10000 * fundingIntervals : 0;
    const grossEdgeBps = Number.isFinite(basisBps) ? Math.max(0, Math.abs(basisBps) + fundingCarryBps) : null;
    return { symbol, fresh, activeSignal, premiumZ: Number.isFinite(premiumZ) ? round(premiumZ) : null, basisBps: Number.isFinite(basisBps) ? round(basisBps) : null, fundingRate: Number.isFinite(fundingRate) ? fundingRate : null, fundingIntervals, fundingCarryBps: round(fundingCarryBps), grossEdgeBps: grossEdgeBps == null ? null : round(grossEdgeBps), requiredGrossBps: round(requiredGrossBps), edgeCostRatio: grossEdgeBps != null ? round(grossEdgeBps / modeledCostBps) : null, sourceEvidenceHash: ev?.evidenceHashSha256 ?? null };
  });
  const usable = rows.filter((r) => r.fresh && r.grossEdgeBps != null), active = usable.filter((r) => r.activeSignal);
  if (!usable.length) return { mode: 'FUTURES_BASIS_SNAPSHOT', verdict: 'DATA_BLOCKED', reason: 'No fresh futures-native evidence was available for the proposal universe.', selected: null, rows, modeledCostBps, safetyBufferBps, requiredGrossBps, details: { assets: rows, entryZ, maxHoldHours, fundingIntervals } };
  if (!active.length) return { mode: 'FUTURES_BASIS_SNAPSHOT', verdict: 'NO_ACTIVE_SIGNAL', reason: 'Evidence is fresh, but the frozen entry condition is not currently active. No economic conclusion is inferred.', selected: null, rows, modeledCostBps, safetyBufferBps, requiredGrossBps, details: { assets: rows, entryZ, maxHoldHours, fundingIntervals } };
  const selected = [...active].sort((a, b) => Number(b.grossEdgeBps ?? -Infinity) - Number(a.grossEdgeBps ?? -Infinity))[0];
  const pass = Number(selected.grossEdgeBps) >= requiredGrossBps;
  return { mode: 'FUTURES_BASIS_SNAPSHOT', verdict: pass ? 'PASS_PREFILTER' : 'FAIL_ECONOMICS', reason: pass ? 'At least one active futures-native opportunity exceeds modeled round-trip cost plus the safety buffer. This authorizes research compute only, not capital.' : 'Active gross opportunity does not clear modeled round-trip cost plus the safety buffer; expensive backtesting is not justified.', selected, rows, modeledCostBps, safetyBufferBps, requiredGrossBps, details: { assets: rows, entryZ, maxHoldHours, fundingIntervals } };
}

function fundingSpreadAssessment(spec: any, state: any, modeledCostBps: number) {
  const assets: string[] = Array.isArray(spec?.universe?.assets) ? spec.universe.assets.map((v: unknown) => String(v).toUpperCase()) : [];
  const params = spec?.params || {};
  const minOiUsd = Number(params.minOiUsd ?? 0), holdDays = Number(params.holdDays ?? 30), haircut = Math.max(0, Math.min(1, Number(params.persistenceHaircut ?? 0.5)));
  const safetyBufferBps = Math.max(5, modeledCostBps * 0.5);
  const rows = assets.map((symbol) => {
    const ev = state.evidence?.[symbol]; const market = ev?.market || {};
    return { symbol, fresh: ev?.freshness?.fresh === true, fundingMeanRecent: Number(market.fundingMeanRecent), lastFundingRate: Number(market.lastFundingRate), basisBps: Number(market.basisBps), openInterestUsd: Number(market.openInterestUsd), sourceEvidenceHash: ev?.evidenceHashSha256 ?? null };
  }).filter((r) => r.fresh && Number.isFinite(r.fundingMeanRecent) && Number.isFinite(r.basisBps) && Number.isFinite(r.openInterestUsd) && r.openInterestUsd >= minOiUsd);
  if (rows.length < 2) return { mode: 'CROSS_ASSET_FUNDING_SPREAD_SNAPSHOT', verdict: 'DATA_BLOCKED', reason: 'Fewer than two liquid assets have fresh trusted funding/OI evidence.', selected: null, rows, modeledCostBps, safetyBufferBps, requiredGrossBps: modeledCostBps + safetyBufferBps, details: { assets: rows, minOiUsd, holdDays, persistenceHaircut: haircut } };
  const ordered = [...rows].sort((a, b) => b.fundingMeanRecent - a.fundingMeanRecent);
  const shortLeg = ordered[0], longLeg = ordered.at(-1)!;
  const spreadRate = shortLeg.fundingMeanRecent - longLeg.fundingMeanRecent;
  if (!(spreadRate > 0)) return { mode: 'CROSS_ASSET_FUNDING_SPREAD_SNAPSHOT', verdict: 'NO_ACTIVE_SIGNAL', reason: 'No positive recent mean funding spread exists across the liquid universe.', selected: null, rows, modeledCostBps, safetyBufferBps, requiredGrossBps: modeledCostBps + safetyBufferBps, details: { assets: rows, minOiUsd, holdDays, persistenceHaircut: haircut } };
  const intervals = Math.max(1, Math.round(holdDays * 3));
  const grossFundingBps = spreadRate * 10000 * intervals * haircut;
  const basisAdverseBufferBps = spec?.costModel?.basisAdverseBuffer ? Math.abs(shortLeg.basisBps) + Math.abs(longLeg.basisBps) : 0;
  const requiredGrossBps = modeledCostBps + safetyBufferBps + basisAdverseBufferBps;
  const selected = { shortSymbol: shortLeg.symbol, longSymbol: longLeg.symbol, shortFundingMean: shortLeg.fundingMeanRecent, longFundingMean: longLeg.fundingMeanRecent, fundingSpreadPer8hBps: round(spreadRate * 10000), holdDays, fundingIntervals: intervals, persistenceHaircut: haircut, grossFundingBps: round(grossFundingBps), basisAdverseBufferBps: round(basisAdverseBufferBps), requiredGrossBps: round(requiredGrossBps), edgeCostRatio: round(grossFundingBps / modeledCostBps) };
  const pass = grossFundingBps >= requiredGrossBps;
  return { mode: 'CROSS_ASSET_FUNDING_SPREAD_SNAPSHOT', verdict: pass ? 'PASS_PREFILTER' : 'FAIL_ECONOMICS', reason: pass ? 'Haircut funding spread clears round-trip cost, safety buffer, and current two-leg basis adverse buffer. Research compute is permitted; capital remains locked.' : 'Haircut funding spread does not clear round-trip cost, safety buffer, and basis adverse buffer; reject before backtest.', selected, rows, modeledCostBps, safetyBufferBps, requiredGrossBps, details: { assets: rows, minOiUsd, holdDays, persistenceHaircut: haircut, pairFrozen: params.pairFrozen === true } };
}

function blockedAssessment(mode: string, reason: string, modeledCostBps: number | null = null) {
  return { mode, verdict: 'DATA_BLOCKED', reason, selected: null, rows: [], modeledCostBps, safetyBufferBps: null, requiredGrossBps: null, details: {} };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method !== 'POST') return json({ ok: false, engineVersion: ENGINE_VERSION, error: 'method_not_allowed' }, 405);
  if (!await authorized(req)) return json({ ok: false, engineVersion: ENGINE_VERSION, error: 'economic_gate_auth_invalid' }, 403);
  try {
    const body = await req.json(); const proposalId = String(body?.proposalId || '').trim();
    if (!proposalId) return json({ ok: false, engineVersion: ENGINE_VERSION, error: 'proposalId_required', executionAuthority: false, capitalEligible: false, liveOrders: false }, 400);
    const proposals = await rest(`quant_research_hypothesis_proposals?proposal_id=eq.${encodeURIComponent(proposalId)}&select=proposal_id,hypothesis_fingerprint,family,decision,canonical_spec,cost_model,created_at&limit=1`);
    const proposal = proposals?.[0];
    if (!proposal) return json({ ok: false, engineVersion: ENGINE_VERSION, error: 'proposal_not_found', executionAuthority: false, capitalEligible: false, liveOrders: false }, 404);
    const spec = proposal.canonical_spec || {}, family = String(proposal.family || 'UNKNOWN'), dataClass = String(spec.dataClass || '').toLowerCase();
    const costModel = proposal.cost_model || spec?.costModel || {};
    const rawRoundTripBps = costModel.roundTripBps;
    const modeledCostBps = rawRoundTripBps == null ? null : Number(rawRoundTripBps);

    let assessment: any;
    let state: any = null;
    let stateRow: any = null;

    if (!['ALLOW_NEW_HYPOTHESIS','ALLOW_RESEARCH_CHALLENGE','ALLOW_FORWARD_CONFIRMATION'].includes(String(proposal.decision))) {
      assessment = blockedAssessment('HYPOTHESIS_DECISION_GATE', `Hypothesis gate decision ${proposal.decision} does not authorize research.`, modeledCostBps);
    } else if (!SUPPORTED_FAMILIES.has(family)) {
      assessment = blockedAssessment('MODEL_REGISTRY_GATE', `economic_model_not_implemented_for_family:${family}`, modeledCostBps);
    } else if (!Number.isFinite(modeledCostBps) || Number(modeledCostBps) <= 0) {
      assessment = blockedAssessment('COST_MODEL_GATE', 'explicit_positive_roundTripBps_required', modeledCostBps);
    } else if (!dataClass.includes('binance_usdm')) {
      assessment = blockedAssessment('DATA_CLASS_GATE', 'efg_v1.2 currently supports trusted Binance USD-M futures evidence only.', modeledCostBps);
    } else {
      const stateRows = await rest(`org_state?key=eq.${FUTURES_STATE_KEY}&select=value,updated_at&limit=1`);
      stateRow = stateRows?.[0];
      state = parseJson(stateRow?.value, null);
      if (!state?.ok || state?.spotReferenceUsed !== false || !state?.evidence) {
        assessment = blockedAssessment('FUTURES_EVIDENCE_GATE', 'Trusted futures-native market evidence is missing or invalid.', modeledCostBps);
      } else if (family === 'CRYPTO_CROSS_ASSET_FUNDING_SPREAD') {
        assessment = fundingSpreadAssessment(spec, state, Number(modeledCostBps));
      } else if (family === 'CRYPTO_BASIS_MEAN_REVERSION') {
        assessment = basisAssessment(spec, state, Number(modeledCostBps));
      } else {
        assessment = blockedAssessment('MODEL_REGISTRY_GATE', `economic_model_not_implemented_for_family:${family}`, modeledCostBps);
      }
    }

    const sourceHash = assessment.rows?.length ? await sha256(JSON.stringify(assessment.rows.map((r: any) => ({ symbol: r.symbol, sourceEvidenceHash: r.sourceEvidenceHash })))) : null;
    const grossEdge = assessment.selected?.grossEdgeBps ?? assessment.selected?.grossFundingBps ?? null;
    const insert = {
      proposal_id: proposal.proposal_id,
      hypothesis_fingerprint: proposal.hypothesis_fingerprint,
      family,
      engine_version: ENGINE_VERSION,
      mode: assessment.mode,
      source_state_key: state ? FUTURES_STATE_KEY : null,
      source_evidence_hash: sourceHash,
      observed_at: state?.completedAt ?? stateRow?.updated_at ?? new Date().toISOString(),
      gross_edge_bps: grossEdge,
      modeled_cost_bps: Number.isFinite(assessment.modeledCostBps) ? assessment.modeledCostBps : null,
      safety_buffer_bps: Number.isFinite(assessment.safetyBufferBps) ? assessment.safetyBufferBps : null,
      required_gross_bps: Number.isFinite(assessment.requiredGrossBps) ? assessment.requiredGrossBps : null,
      edge_cost_ratio: assessment.selected?.edgeCostRatio ?? null,
      margin_bps: grossEdge == null || !Number.isFinite(assessment.requiredGrossBps) ? null : Number(grossEdge) - Number(assessment.requiredGrossBps),
      verdict: assessment.verdict,
      reason: assessment.reason,
      details: { ...assessment.details, selectedOpportunity: assessment.selected, proposalDecision: proposal.decision, dataClass, supportedFamilies: [...SUPPORTED_FAMILIES], policy: 'fail-closed economic prefilter; unsupported family or incomplete costs can never PASS' },
      execution_authority: false,
      capital_eligible: false,
      live_orders: false,
    };
    const created = await rest('quant_economic_feasibility_checks?select=check_id,created_at', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(insert) });
    return json({ ok: true, engineVersion: ENGINE_VERSION, checkId: created?.[0]?.check_id ?? null, createdAt: created?.[0]?.created_at ?? null, proposalId, hypothesisFingerprint: proposal.hypothesis_fingerprint, family, verdict: assessment.verdict, reason: assessment.reason, modeledCostBps: Number.isFinite(assessment.modeledCostBps) ? round(assessment.modeledCostBps) : null, safetyBufferBps: Number.isFinite(assessment.safetyBufferBps) ? round(assessment.safetyBufferBps) : null, requiredGrossBps: Number.isFinite(assessment.requiredGrossBps) ? round(assessment.requiredGrossBps) : null, selectedOpportunity: assessment.selected, assets: assessment.rows, executionAuthority: false, capitalEligible: false, liveOrders: false });
  } catch (error) { return json({ ok: false, engineVersion: ENGINE_VERSION, error: error instanceof Error ? error.message : 'economic_gate_failed', executionAuthority: false, capitalEligible: false, liveOrders: false }, 500); }
});
