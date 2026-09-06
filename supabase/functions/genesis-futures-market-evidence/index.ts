declare const Deno: any;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
const BINANCE_FUTURES_BASE = Deno.env.get('BINANCE_FUTURES_BASE') || 'https://fapi.binance.com';
const RUNNER_TOKEN_SHA256 = 'e9f02987e836a6eaf8ef8d7afaed805580cd31264aef5ed86fc3ebb756c59d91';
const ENGINE_VERSION = 'fne_v1';
const STATE_KEY = 'quant_futures_native_market_v1';
const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const ALLOWED_SYMBOLS = new Set(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT']);
const REST_HEADERS = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
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

function round(value: number, digits = 6) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
function mean(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function std(values: number[]) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / (values.length - 1));
}

async function fetchJson(path: string) {
  const response = await fetch(`${BINANCE_FUTURES_BASE}${path}`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`binance_futures_${response.status}:${path.split('?')[0]}`);
  return await response.json();
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

async function writeState(value: unknown) {
  await rest('org_state?on_conflict=key', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key: STATE_KEY, value: JSON.stringify(value), updated_at: new Date().toISOString() }),
  });
}

function pctChange(first: number, last: number) {
  return Number.isFinite(first) && first !== 0 && Number.isFinite(last) ? (last / first) - 1 : null;
}

function latestTimestamp(rows: any[]) {
  const row = rows.at(-1);
  const raw = Number(row?.timestamp ?? row?.fundingTime ?? row?.time ?? row?.[6] ?? row?.[0]);
  return Number.isFinite(raw) ? new Date(raw).toISOString() : null;
}

function windowInfo(rows: any[]) {
  if (!rows.length) return { rows: 0, startAt: null, endAt: null };
  const startRaw = Number(rows[0]?.timestamp ?? rows[0]?.fundingTime ?? rows[0]?.time ?? rows[0]?.[0]);
  const endRaw = Number(rows.at(-1)?.timestamp ?? rows.at(-1)?.fundingTime ?? rows.at(-1)?.time ?? rows.at(-1)?.[6] ?? rows.at(-1)?.[0]);
  return {
    rows: rows.length,
    startAt: Number.isFinite(startRaw) ? new Date(startRaw).toISOString() : null,
    endAt: Number.isFinite(endRaw) ? new Date(endRaw).toISOString() : null,
  };
}

async function buildSymbolEvidence(symbol: string) {
  const limit = 168;
  const [premiumNow, markRows, indexRows, premiumRows, oiRows, fundingRows] = await Promise.all([
    fetchJson(`/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`),
    fetchJson(`/fapi/v1/markPriceKlines?symbol=${encodeURIComponent(symbol)}&interval=1h&limit=${limit}`),
    fetchJson(`/fapi/v1/indexPriceKlines?pair=${encodeURIComponent(symbol)}&interval=1h&limit=${limit}`),
    fetchJson(`/fapi/v1/premiumIndexKlines?symbol=${encodeURIComponent(symbol)}&interval=1h&limit=${limit}`),
    fetchJson(`/futures/data/openInterestHist?symbol=${encodeURIComponent(symbol)}&period=1h&limit=${limit}`),
    fetchJson(`/fapi/v1/fundingRate?symbol=${encodeURIComponent(symbol)}&limit=30`),
  ]);

  if (![markRows, indexRows, premiumRows, oiRows, fundingRows].every(Array.isArray)) throw new Error('unexpected_binance_shape');
  if (markRows.length < 24 || indexRows.length < 24 || oiRows.length < 24) throw new Error('insufficient_futures_history');

  const mark = Number(premiumNow?.markPrice);
  const index = Number(premiumNow?.indexPrice);
  const lastFundingRate = Number(premiumNow?.lastFundingRate);
  const basisBps = Number.isFinite(mark) && Number.isFinite(index) && index > 0 ? ((mark - index) / index) * 10_000 : null;
  const markCloses = markRows.map((row: any) => Number(row?.[4])).filter(Number.isFinite);
  const hourlyLogReturns: number[] = [];
  for (let i = 1; i < markCloses.length; i++) if (markCloses[i - 1] > 0 && markCloses[i] > 0) hourlyLogReturns.push(Math.log(markCloses[i] / markCloses[i - 1]));
  const realizedVolAnnualized = hourlyLogReturns.length > 2 ? std(hourlyLogReturns) * Math.sqrt(24 * 365) : null;
  const markReturn7d = markCloses.length >= 2 ? pctChange(markCloses[0], markCloses.at(-1)!) : null;

  const premiumCloses = premiumRows.map((row: any) => Number(row?.[4])).filter(Number.isFinite);
  const premiumMean = premiumCloses.length ? mean(premiumCloses) : null;
  const premiumStd = premiumCloses.length > 1 ? std(premiumCloses) : null;
  const currentPremium = premiumCloses.at(-1) ?? null;
  const premiumZ = currentPremium != null && premiumMean != null && premiumStd != null && premiumStd > 0 ? (currentPremium - premiumMean) / premiumStd : null;

  const oiValues = oiRows.map((row: any) => Number(row?.sumOpenInterestValue)).filter(Number.isFinite);
  const oiCurrentUsd = oiValues.at(-1) ?? null;
  const oiChange7d = oiValues.length >= 2 ? pctChange(oiValues[0], oiValues.at(-1)!) : null;
  const fundingRates = fundingRows.map((row: any) => Number(row?.fundingRate)).filter(Number.isFinite);
  const fundingMean = fundingRates.length ? mean(fundingRates) : null;
  const fundingAnnualizedSimple = Number.isFinite(lastFundingRate) ? lastFundingRate * 3 * 365 : null;

  const evidenceHash = await sha256(JSON.stringify({ symbol, premiumNow, markRows, indexRows, premiumRows, oiRows, fundingRows }));
  const now = Date.now();
  const sourceTime = Number(premiumNow?.time);
  const ageMs = Number.isFinite(sourceTime) ? Math.max(0, now - sourceTime) : null;

  return {
    symbol,
    source: 'BINANCE_USDM_FUTURES_PUBLIC',
    spotReferenceUsed: false,
    market: {
      markPrice: Number.isFinite(mark) ? mark : null,
      indexPrice: Number.isFinite(index) ? index : null,
      basisBps: basisBps == null ? null : round(basisBps, 4),
      lastFundingRate: Number.isFinite(lastFundingRate) ? lastFundingRate : null,
      fundingAnnualizedSimple: fundingAnnualizedSimple == null ? null : round(fundingAnnualizedSimple, 6),
      nextFundingTime: Number.isFinite(Number(premiumNow?.nextFundingTime)) ? new Date(Number(premiumNow.nextFundingTime)).toISOString() : null,
      markReturn7d: markReturn7d == null ? null : round(markReturn7d, 6),
      realizedVolAnnualized: realizedVolAnnualized == null ? null : round(realizedVolAnnualized, 6),
      premiumIndex: currentPremium == null ? null : round(currentPremium, 8),
      premiumZ7d: premiumZ == null ? null : round(premiumZ, 4),
      openInterestUsd: oiCurrentUsd == null ? null : round(oiCurrentUsd, 2),
      openInterestChange7d: oiChange7d == null ? null : round(oiChange7d, 6),
      fundingMeanRecent: fundingMean == null ? null : round(fundingMean, 8),
    },
    windows: {
      mark1h: windowInfo(markRows),
      index1h: windowInfo(indexRows),
      premium1h: windowInfo(premiumRows),
      openInterest1h: windowInfo(oiRows),
      funding: windowInfo(fundingRows),
    },
    freshness: {
      sourceTime: Number.isFinite(sourceTime) ? new Date(sourceTime).toISOString() : latestTimestamp(markRows),
      ageMs,
      fresh: ageMs != null ? ageMs < 5 * 60 * 1000 : false,
    },
    evidenceHashSha256: evidenceHash,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (!['GET', 'POST'].includes(req.method)) return json({ ok: false, engineVersion: ENGINE_VERSION, error: 'method_not_allowed' }, 405);
  if (!await authorized(req)) return json({ ok: false, engineVersion: ENGINE_VERSION, error: 'futures_evidence_auth_invalid' }, 403);

  try {
    const url = new URL(req.url);
    let requested = url.searchParams.get('symbol') ? [String(url.searchParams.get('symbol')).toUpperCase()] : DEFAULT_SYMBOLS;
    if (req.method === 'POST') {
      try {
        const body = await req.json();
        if (Array.isArray(body?.symbols) && body.symbols.length) requested = body.symbols.map((value: unknown) => String(value).toUpperCase());
      } catch { /* empty body is valid */ }
    }
    const symbols = [...new Set(requested)].filter((symbol) => ALLOWED_SYMBOLS.has(symbol)).slice(0, 6);
    if (!symbols.length) return json({ ok: false, engineVersion: ENGINE_VERSION, error: 'no_allowed_symbols', allowedSymbols: [...ALLOWED_SYMBOLS] }, 400);

    const startedAt = new Date().toISOString();
    const settled = await Promise.allSettled(symbols.map(buildSymbolEvidence));
    const evidence: Record<string, any> = {};
    const errors: Array<{ symbol: string; error: string }> = [];
    settled.forEach((result, index) => {
      const symbol = symbols[index];
      if (result.status === 'fulfilled') evidence[symbol] = result.value;
      else errors.push({ symbol, error: result.reason instanceof Error ? result.reason.message : 'evidence_failed' });
    });

    const payload = {
      ok: Object.keys(evidence).length > 0,
      engineVersion: ENGINE_VERSION,
      mode: 'RESEARCH_EVIDENCE_ONLY',
      dataPolicy: 'BINANCE_USDM_FUTURES_PUBLIC_REAL_ONLY',
      executionAuthority: false,
      capitalEligible: false,
      liveOrders: false,
      spotReferenceUsed: false,
      requestedSymbols: symbols,
      successfulSymbols: Object.keys(evidence),
      errors,
      startedAt,
      completedAt: new Date().toISOString(),
      evidence,
    };
    await writeState(payload);
    return json(payload, payload.ok ? 200 : 502);
  } catch (error) {
    return json({ ok: false, engineVersion: ENGINE_VERSION, mode: 'RESEARCH_EVIDENCE_ONLY', dataPolicy: 'BINANCE_USDM_FUTURES_PUBLIC_REAL_ONLY', executionAuthority: false, capitalEligible: false, liveOrders: false, spotReferenceUsed: false, error: error instanceof Error ? error.message : 'futures_market_evidence_failed' }, 500);
  }
});
