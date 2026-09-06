declare const Deno: any;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
const BINANCE_FUTURES_BASE = Deno.env.get('BINANCE_FUTURES_BASE') || 'https://fapi.binance.com';
const RUNNER_TOKEN_SHA256 = 'e9f02987e836a6eaf8ef8d7afaed805580cd31264aef5ed86fc3ebb756c59d91';
const ENGINE_VERSION = 'fbr_v1';
const STATE_KEY = 'quant_basis_research_v1';
const SYMBOLS = ['BTCUSDT', 'ETHUSDT'];
const INTERVAL = '4h';
const TARGET_BARS = 5500;
const Z_LOOKBACK = 42;
const ENTRY_Z = 2.0;
const EXIT_Z = 0.5;
const MAX_HOLD_BARS = 12;
const ROUND_TRIP_COST = 0.0020;
const REST_HEADERS = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' };
const GATES = {
  minTrades: 50,
  minWinRate: 0.40,
  minProfitFactor: 1.30,
  minExpectancyPct: 0.05,
  minTStat: 2.0,
  maxDrawdownPct: 25.0,
  requirePositiveHalves: true,
  requireMcP5Positive: true,
};

type Trade = {
  symbol: string;
  direction: 'LONG_BASIS' | 'SHORT_BASIS';
  openedAt: number;
  closedAt: number;
  entryPremium: number;
  exitPremium: number;
  basisReturn: number;
  fundingReturn: number;
  costReturn: number;
  netReturn: number;
  exitReason: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function authorized(req: Request) {
  const supplied = (req.headers.get('x-genesis-runner-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '').trim();
  return Boolean(supplied) && await sha256(supplied) === RUNNER_TOKEN_SHA256;
}
async function fetchJson(path: string) {
  const response = await fetch(`${BINANCE_FUTURES_BASE}${path}`, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`binance_${response.status}:${path.split('?')[0]}`);
  return await response.json();
}
async function rest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...REST_HEADERS, ...(init.headers || {}) }, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`supabase_${response.status}:${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
async function writeState(value: unknown) {
  await rest('org_state?on_conflict=key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ key: STATE_KEY, value: JSON.stringify(value), updated_at: new Date().toISOString() }) });
}
function round(value: number, digits = 6) { const scale = 10 ** digits; return Math.round(value * scale) / scale; }
function mean(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function std(values: number[]) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / (values.length - 1));
}

async function fetchPremiumHistory(symbol: string) {
  let endTime = Date.now();
  let rows: any[] = [];
  for (let page = 0; page < 5 && rows.length < TARGET_BARS; page++) {
    const chunk = await fetchJson(`/fapi/v1/premiumIndexKlines?symbol=${encodeURIComponent(symbol)}&interval=${INTERVAL}&limit=1500&endTime=${endTime}`);
    if (!Array.isArray(chunk) || !chunk.length) break;
    rows = [...chunk, ...rows];
    const oldest = Number(chunk[0]?.[0]);
    if (!Number.isFinite(oldest)) break;
    endTime = oldest - 1;
    if (chunk.length < 10) break;
  }
  const unique = new Map<number, any>();
  for (const row of rows) {
    const ts = Number(row?.[0]);
    if (Number.isFinite(ts)) unique.set(ts, row);
  }
  return [...unique.values()].sort((a, b) => Number(a[0]) - Number(b[0])).slice(-TARGET_BARS);
}

async function fetchFundingHistory(symbol: string, startTime: number) {
  const out: any[] = [];
  let cursor = startTime;
  const endTime = Date.now();
  for (let page = 0; page < 5; page++) {
    const chunk = await fetchJson(`/fapi/v1/fundingRate?symbol=${encodeURIComponent(symbol)}&startTime=${cursor}&endTime=${endTime}&limit=1000`);
    if (!Array.isArray(chunk) || !chunk.length) break;
    out.push(...chunk);
    const last = Number(chunk.at(-1)?.fundingTime);
    if (!Number.isFinite(last) || last >= endTime || chunk.length < 1000) break;
    cursor = last + 1;
  }
  const unique = new Map<number, any>();
  for (const row of out) {
    const ts = Number(row?.fundingTime);
    if (Number.isFinite(ts)) unique.set(ts, row);
  }
  return [...unique.values()].sort((a, b) => Number(a.fundingTime) - Number(b.fundingTime));
}

function causalZ(values: number[], lookback: number) {
  const out = new Array(values.length).fill(null) as Array<number | null>;
  for (let i = lookback; i < values.length; i++) {
    const window = values.slice(i - lookback, i).filter(Number.isFinite);
    if (window.length !== lookback) continue;
    const avg = mean(window), sigma = std(window);
    if (sigma > 0 && Number.isFinite(values[i])) out[i] = (values[i] - avg) / sigma;
  }
  return out;
}

function fundingBetween(rows: any[], start: number, end: number, direction: 1 | -1) {
  let total = 0;
  for (const row of rows) {
    const ts = Number(row?.fundingTime);
    if (ts < start) continue;
    if (ts >= end) break;
    const rate = Number(row?.fundingRate);
    if (Number.isFinite(rate)) total += -direction * rate;
  }
  return total;
}

function simulate(symbol: string, premiumRows: any[], fundingRows: any[]) {
  const closes = premiumRows.map((row) => Number(row?.[4]));
  const z = causalZ(closes, Z_LOOKBACK);
  const trades: Trade[] = [];
  let lastExitIndex = -1;
  for (let i = Z_LOOKBACK; i < premiumRows.length - 2; i++) {
    if (i <= lastExitIndex) continue;
    const signal = z[i];
    if (signal == null) continue;
    const direction: 1 | -1 | 0 = signal >= ENTRY_Z ? -1 : signal <= -ENTRY_Z ? 1 : 0;
    if (!direction) continue;
    const entryIndex = i + 1;
    const entryPremium = Number(premiumRows[entryIndex]?.[1]);
    const entryTime = Number(premiumRows[entryIndex]?.[0]);
    if (!Number.isFinite(entryPremium) || !Number.isFinite(entryTime)) continue;
    let exitIndex = Math.min(premiumRows.length - 1, entryIndex + MAX_HOLD_BARS);
    let exitReason = 'timeout_48h';
    for (let j = entryIndex; j < Math.min(premiumRows.length - 1, entryIndex + MAX_HOLD_BARS); j++) {
      const exitSignal = z[j];
      if (exitSignal != null && Math.abs(exitSignal) <= EXIT_Z && j + 1 < premiumRows.length) {
        exitIndex = j + 1;
        exitReason = 'premium_mean_reversion';
        break;
      }
    }
    const exitPremium = Number(premiumRows[exitIndex]?.[1]);
    const exitTime = Number(premiumRows[exitIndex]?.[0]);
    if (!Number.isFinite(exitPremium) || !Number.isFinite(exitTime) || exitTime <= entryTime) continue;
    const basisReturn = direction * (exitPremium - entryPremium);
    const fundingReturn = fundingBetween(fundingRows, entryTime, exitTime, direction);
    const netReturn = basisReturn + fundingReturn - ROUND_TRIP_COST;
    trades.push({ symbol, direction: direction === 1 ? 'LONG_BASIS' : 'SHORT_BASIS', openedAt: entryTime, closedAt: exitTime, entryPremium: round(entryPremium, 8), exitPremium: round(exitPremium, 8), basisReturn: round(basisReturn, 8), fundingReturn: round(fundingReturn, 8), costReturn: ROUND_TRIP_COST, netReturn: round(netReturn, 8), exitReason });
    lastExitIndex = exitIndex;
  }
  return trades;
}

function lcg(seed: number) {
  let state = seed >>> 0;
  return () => { state = (1664525 * state + 1013904223) >>> 0; return state / 4294967296; };
}
function percentile(values: number[], q: number) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * q)));
  return ordered[index];
}
function metrics(trades: Trade[]) {
  const ordered = [...trades].sort((a, b) => a.closedAt - b.closedAt);
  const returns = ordered.map((trade) => trade.netReturn);
  const wins = returns.filter((value) => value > 0), losses = returns.filter((value) => value < 0);
  const grossProfit = wins.reduce((sum, value) => sum + value, 0), grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  const expectancy = returns.length ? mean(returns) : null, sigma = std(returns);
  const tStat = returns.length >= 2 && sigma > 0 && expectancy != null ? expectancy / (sigma / Math.sqrt(returns.length)) : null;
  let curve = 0, peak = 0, maxDrawdown = 0;
  for (const value of returns) { curve += value; peak = Math.max(peak, curve); maxDrawdown = Math.max(maxDrawdown, peak - curve); }
  const half = Math.floor(returns.length / 2), h1 = returns.slice(0, half), h2 = returns.slice(half);
  const rng = lcg(20260906), bootstrapTotals: number[] = [];
  if (returns.length) {
    for (let b = 0; b < 1000; b++) {
      let total = 0;
      for (let i = 0; i < returns.length; i++) total += returns[Math.floor(rng() * returns.length)];
      bootstrapTotals.push(total * 100);
    }
  }
  return {
    n: returns.length,
    wins: wins.length,
    losses: losses.length,
    winRate: returns.length ? round(wins.length / returns.length, 4) : null,
    totalReturnPct: round(returns.reduce((sum, value) => sum + value, 0) * 100, 4),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 4) : null,
    expectancyPct: expectancy == null ? null : round(expectancy * 100, 4),
    tStat: tStat == null ? null : round(tStat, 4),
    maxDrawdownPct: round(maxDrawdown * 100, 4),
    half1ExpectancyPct: h1.length ? round(mean(h1) * 100, 4) : null,
    half2ExpectancyPct: h2.length ? round(mean(h2) * 100, 4) : null,
    mcP5TotalReturnPct: bootstrapTotals.length ? round(percentile(bootstrapTotals, 0.05)!, 4) : null,
    avgBasisReturnPct: returns.length ? round(mean(ordered.map((trade) => trade.basisReturn)) * 100, 4) : null,
    avgFundingReturnPct: returns.length ? round(mean(ordered.map((trade) => trade.fundingReturn)) * 100, 4) : null,
    fixedCostPctPerTrade: ROUND_TRIP_COST * 100,
  };
}
function gate(m: any) {
  const gates = [
    { code: 'MIN_TRADES', pass: m.n >= GATES.minTrades, observed: m.n, required: GATES.minTrades },
    { code: 'WIN_RATE', pass: m.winRate != null && m.winRate >= GATES.minWinRate, observed: m.winRate, required: GATES.minWinRate },
    { code: 'PROFIT_FACTOR', pass: m.profitFactor != null && m.profitFactor >= GATES.minProfitFactor, observed: m.profitFactor, required: GATES.minProfitFactor },
    { code: 'EXPECTANCY', pass: m.expectancyPct != null && m.expectancyPct >= GATES.minExpectancyPct, observed: m.expectancyPct, required: GATES.minExpectancyPct },
    { code: 'T_STAT', pass: m.tStat != null && m.tStat >= GATES.minTStat, observed: m.tStat, required: GATES.minTStat },
    { code: 'MAX_DRAWDOWN', pass: m.maxDrawdownPct <= GATES.maxDrawdownPct, observed: m.maxDrawdownPct, required: GATES.maxDrawdownPct },
    { code: 'TEMPORAL_HALVES', pass: m.half1ExpectancyPct != null && m.half1ExpectancyPct > 0 && m.half2ExpectancyPct != null && m.half2ExpectancyPct > 0, observed: [m.half1ExpectancyPct, m.half2ExpectancyPct], required: 'both_positive' },
    { code: 'MC_P5', pass: m.mcP5TotalReturnPct != null && m.mcP5TotalReturnPct > 0, observed: m.mcP5TotalReturnPct, required: '>0' },
  ];
  return { pass: gates.every((item) => item.pass), passed: gates.filter((item) => item.pass).length, total: gates.length, gates };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (!['GET', 'POST'].includes(req.method)) return json({ ok: false, engineVersion: ENGINE_VERSION, error: 'method_not_allowed' }, 405);
  if (!await authorized(req)) return json({ ok: false, engineVersion: ENGINE_VERSION, error: 'basis_research_auth_invalid' }, 403);
  const startedAt = new Date().toISOString();
  try {
    const datasets = await Promise.all(SYMBOLS.map(async (symbol) => {
      const premiumRows = await fetchPremiumHistory(symbol);
      if (premiumRows.length < 1000) throw new Error(`${symbol}:insufficient_premium_history:${premiumRows.length}`);
      const startTime = Number(premiumRows[0]?.[0]);
      const fundingRows = await fetchFundingHistory(symbol, startTime);
      if (fundingRows.length < 100) throw new Error(`${symbol}:insufficient_funding_history:${fundingRows.length}`);
      return { symbol, premiumRows, fundingRows, trades: simulate(symbol, premiumRows, fundingRows) };
    }));
    const allTrades = datasets.flatMap((dataset) => dataset.trades).sort((a, b) => a.openedAt - b.openedAt);
    if (allTrades.length < 20) throw new Error(`insufficient_trade_sample:${allTrades.length}`);
    const minTs = Math.min(...datasets.map((dataset) => Number(dataset.premiumRows[0]?.[0])));
    const maxTs = Math.max(...datasets.map((dataset) => Number(dataset.premiumRows.at(-1)?.[0])));
    const devEnd = minTs + (maxTs - minTs) * 0.40;
    const validationEnd = minTs + (maxTs - minTs) * 0.70;
    const developmentTrades = allTrades.filter((trade) => trade.openedAt < devEnd);
    const validationTrades = allTrades.filter((trade) => trade.openedAt >= devEnd && trade.openedAt < validationEnd);
    const holdoutTrades = allTrades.filter((trade) => trade.openedAt >= validationEnd);
    const development = metrics(developmentTrades), validation = metrics(validationTrades), validationGate = gate(validation);
    const holdout = validationGate.pass ? metrics(holdoutTrades) : null;
    const holdoutGate = holdout ? gate(holdout) : null;
    const verdict = validationGate.pass && holdoutGate?.pass ? 'RESEARCH_GO' : 'NO_GO';
    const holdoutState = validationGate.pass ? 'EVALUATED' : 'SEALED';
    const rawHash = await sha256(JSON.stringify(datasets.map((dataset) => ({ symbol: dataset.symbol, premiumRows: dataset.premiumRows, fundingRows: dataset.fundingRows }))));
    const payload = {
      ok: true,
      engineVersion: ENGINE_VERSION,
      family: 'CRYPTO_BASIS_MEAN_REVERSION',
      strategyName: 'Crypto Basis Mean Reversion',
      strategyVersion: 'v1',
      hypothesisFingerprint: 'a9c735c7a703047fe0f1a4d1e1bf53601760bf4f3172b18670e840b75d135e7d',
      hypothesisProposalId: '2292dfc0-697b-4db0-80cf-35a04bcf4ece',
      mode: 'RESEARCH_ONLY', executionAuthority: false, capitalEligible: false, liveOrders: false,
      dataPolicy: 'BINANCE_USDM_FUTURES_PUBLIC_REAL_ONLY', spotReferenceUsed: false,
      fixedParams: { interval: INTERVAL, zLookbackBars: Z_LOOKBACK, entryZ: ENTRY_Z, exitZ: EXIT_Z, maxHoldBars: MAX_HOLD_BARS, roundTripCostPct: ROUND_TRIP_COST * 100 },
      gatesPolicy: GATES,
      splitPolicy: { development: 'first_40pct_time', validation: 'next_30pct_time', holdout: 'last_30pct_time', holdoutEvaluatedOnlyIfValidationPasses: true },
      coverage: datasets.map((dataset) => ({ symbol: dataset.symbol, premiumBars: dataset.premiumRows.length, fundingEvents: dataset.fundingRows.length, trades: dataset.trades.length, startAt: new Date(Number(dataset.premiumRows[0]?.[0])).toISOString(), endAt: new Date(Number(dataset.premiumRows.at(-1)?.[0])).toISOString() })),
      development, validation, validationGate, holdout, holdoutGate, holdoutState, verdict,
      evidenceHashSha256: rawHash,
      startedAt,
      completedAt: new Date().toISOString(),
    };
    await writeState(payload);
    return json(payload);
  } catch (error) {
    const payload = { ok: false, engineVersion: ENGINE_VERSION, family: 'CRYPTO_BASIS_MEAN_REVERSION', mode: 'RESEARCH_ONLY', executionAuthority: false, capitalEligible: false, liveOrders: false, dataPolicy: 'BINANCE_USDM_FUTURES_PUBLIC_REAL_ONLY', spotReferenceUsed: false, error: error instanceof Error ? error.message : 'basis_research_failed', startedAt, completedAt: new Date().toISOString() };
    await writeState(payload);
    return json(payload, 500);
  }
});
