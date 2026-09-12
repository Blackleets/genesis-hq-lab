declare const Deno: any;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
const RUNNER_TOKEN_SHA256 = 'e9f02987e836a6eaf8ef8d7afaed805580cd31264aef5ed86fc3ebb756c59d91';
const ENGINE_VERSION = 'hng_v1';
const REST_HEADERS = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' };
const STRUCTURAL_BASES = new Set([
  'NEW_DATA_MODALITY',
  'NEW_MARKET_STRUCTURE',
  'NEW_SIGNAL_MECHANISM',
  'NEW_COST_MODEL',
  'NEW_UNIVERSE',
  'NEW_TIME_HORIZON',
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST,OPTIONS',
      'access-control-allow-headers': 'content-type,x-genesis-runner-token,authorization',
    },
  });
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
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...REST_HEADERS, ...(init.headers || {}) },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`supabase_${response.status}:${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function normalizeText(value: unknown, mode: 'upper' | 'lower' = 'lower') {
  const normalized = String(value ?? '').trim().replace(/\s+/g, ' ');
  return mode === 'upper' ? normalized.toUpperCase() : normalized.toLowerCase();
}

function canonicalize(value: any): any {
  if (Array.isArray(value)) {
    const normalized = value.map(canonicalize);
    if (normalized.every((item) => ['string', 'number', 'boolean'].includes(typeof item) || item === null)) {
      return [...normalized].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
    return normalized;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  if (typeof value === 'string') return value.trim();
  return value;
}

function stableStringify(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

function compactExperiment(row: any) {
  return {
    experimentKey: row.experiment_key,
    strategyName: row.strategy_name,
    strategyVersion: row.strategy_version,
    stage: row.stage,
    verdict: row.verdict,
    holdoutState: row.holdout_state,
    commitSha: row.commit_sha,
    createdAt: row.created_at,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method !== 'POST') return json({ ok: false, engineVersion: ENGINE_VERSION, error: 'method_not_allowed' }, 405);
  if (!await authorized(req)) return json({ ok: false, engineVersion: ENGINE_VERSION, error: 'hypothesis_gate_auth_invalid' }, 403);

  try {
    const body = await req.json();
    const family = normalizeText(body?.family, 'upper');
    const signalDefinition = normalizeText(body?.signalDefinition, 'lower');
    const dataClass = normalizeText(body?.dataClass, 'lower');
    const mode = normalizeText(body?.mode || 'HYPOTHESIS', 'upper');
    const noveltyBasis = normalizeText(body?.noveltyBasis || '', 'upper') || null;
    const supersedesReason = String(body?.supersedesReason || '').trim() || null;
    const requestedBy = normalizeText(body?.requestedBy || 'ATLAS_FORGE', 'upper');
    const universe = canonicalize(body?.universe ?? {});
    const params = canonicalize(body?.params ?? {});
    const costModel = canonicalize(body?.costModel ?? {});

    if (!family || !signalDefinition || !dataClass) {
      return json({ ok: false, engineVersion: ENGINE_VERSION, error: 'family_signalDefinition_dataClass_required', executionAuthority: false, capitalEligible: false, liveOrders: false }, 400);
    }
    if (!['HYPOTHESIS', 'FORWARD_CONFIRMATION'].includes(mode)) {
      return json({ ok: false, engineVersion: ENGINE_VERSION, error: 'invalid_mode', allowedModes: ['HYPOTHESIS', 'FORWARD_CONFIRMATION'], executionAuthority: false, capitalEligible: false, liveOrders: false }, 400);
    }

    const canonicalSpec = canonicalize({ family, signalDefinition, universe, params, costModel, dataClass });
    const fingerprint = await sha256(stableStringify(canonicalSpec));

    const [familyExperiments, exactProposals, familyProposals] = await Promise.all([
      rest(`quant_research_experiments?family=eq.${encodeURIComponent(family)}&verdict=eq.NO_GO&select=experiment_key,strategy_name,strategy_version,stage,verdict,holdout_state,commit_sha,created_at&order=created_at.desc&limit=30`),
      rest(`quant_research_hypothesis_proposals?hypothesis_fingerprint=eq.${encodeURIComponent(fingerprint)}&select=proposal_id,decision,mode,novelty_basis,supersedes_reason,created_at&order=created_at.desc&limit=20`),
      rest(`quant_research_hypothesis_proposals?family=eq.${encodeURIComponent(family)}&select=proposal_id,hypothesis_fingerprint,decision,mode,novelty_basis,created_at&order=created_at.desc&limit=30`),
    ]);

    const priorNoGo = Array.isArray(familyExperiments) ? familyExperiments : [];
    const exact = Array.isArray(exactProposals) ? exactProposals : [];
    const priorFamilyProposals = Array.isArray(familyProposals) ? familyProposals : [];
    const validReason = Boolean(supersedesReason && supersedesReason.length >= 20);
    const validStructuralBasis = Boolean(noveltyBasis && STRUCTURAL_BASES.has(noveltyBasis));
    const validForward = mode === 'FORWARD_CONFIRMATION' && noveltyBasis === 'INDEPENDENT_FORWARD_CONFIRMATION' && validReason;

    let decision: string;
    let reason: string;

    if (exact.length > 0 && !validForward) {
      if (priorNoGo.length > 0) {
        decision = 'REJECT_DUPLICATE_NO_GO';
        reason = 'Exact deterministic fingerprint was already proposed inside a family with recorded NO_GO evidence.';
      } else {
        decision = 'REJECT_DUPLICATE_PENDING';
        reason = 'Exact deterministic fingerprint is already registered and has no completed negative-evidence exception.';
      }
    } else if (validForward) {
      decision = 'ALLOW_FORWARD_CONFIRMATION';
      reason = 'Exact model may be replayed only as an independent forward confirmation; parameters remain frozen and this does not grant execution authority.';
    } else if (priorNoGo.length > 0 && (!validReason || !validStructuralBasis)) {
      decision = 'REQUIRE_SUPERSEDES_REASON';
      reason = 'This family has prior NO_GO evidence. A structural novelty basis and a substantive supersedes reason are required before more research.';
    } else if (priorNoGo.length > 0) {
      decision = 'ALLOW_RESEARCH_CHALLENGE';
      reason = 'Prior NO_GO family may be challenged only because an explicit structural change and supersedes reason were supplied. Research authority only.';
    } else {
      decision = 'ALLOW_NEW_HYPOTHESIS';
      reason = 'No prior NO_GO experiment was found for this normalized family and no exact proposal fingerprint exists.';
    }

    const matchedExperimentKeys = priorNoGo.map((row: any) => String(row.experiment_key));
    const matchedProposalIds = [...new Set([...exact, ...priorFamilyProposals.filter((row: any) => row.hypothesis_fingerprint === fingerprint)].map((row: any) => String(row.proposal_id)))];

    const insert = {
      hypothesis_fingerprint: fingerprint,
      family,
      signal_definition: signalDefinition,
      universe,
      params,
      cost_model: costModel,
      data_class: dataClass,
      mode,
      novelty_basis: noveltyBasis,
      supersedes_reason: supersedesReason,
      decision,
      matched_experiment_keys: matchedExperimentKeys,
      matched_proposal_ids: matchedProposalIds,
      canonical_spec: canonicalSpec,
      requested_by: requestedBy,
      execution_authority: false,
      capital_eligible: false,
      live_orders: false,
    };

    const created = await rest('quant_research_hypothesis_proposals?select=proposal_id,created_at', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(insert),
    });

    return json({
      ok: true,
      engineVersion: ENGINE_VERSION,
      proposalId: created?.[0]?.proposal_id ?? null,
      createdAt: created?.[0]?.created_at ?? null,
      decision,
      reason,
      hypothesisFingerprint: fingerprint,
      canonicalSpec,
      priorFamilyNoGoCount: priorNoGo.length,
      matchedExperiments: priorNoGo.map(compactExperiment),
      exactPriorProposalCount: exact.length,
      noveltyPolicy: {
        deterministic: true,
        semanticModelUsed: false,
        fingerprintFields: ['family', 'signalDefinition', 'universe', 'params', 'costModel', 'dataClass'],
        sameFamilyNoGoRequiresStructuralChange: true,
        forwardConfirmationMustFreezeModel: true,
      },
      executionAuthority: false,
      capitalEligible: false,
      liveOrders: false,
    });
  } catch (error) {
    return json({
      ok: false,
      engineVersion: ENGINE_VERSION,
      error: error instanceof Error ? error.message : 'hypothesis_gate_failed',
      executionAuthority: false,
      capitalEligible: false,
      liveOrders: false,
    }, 500);
  }
});
