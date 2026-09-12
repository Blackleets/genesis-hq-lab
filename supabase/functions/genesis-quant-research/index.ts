const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
const BINANCE_BASE = Deno.env.get('BINANCE_BASE') || 'https://data-api.binance.vision/api/v3';
const RUNNER_TOKEN_SHA256 = 'e9f02987e836a6eaf8ef8d7afaed805580cd31264aef5ed86fc3ebb756c59d91';
const RESEARCH_VERSION = 'qre_v1';
const STATE_KEY = 'quant_research_evidence_v1';
const CANDLE_LIMIT = 1000;
const OOS_FRACTION = 0.25;
const FORWARD_START_FRACTION = 0.50;
const FORWARD_FOLDS = 3;

const PROFILES = [
  { id: 'short_micro', versionId: 'futures_breakout_short_micro:v8', pairs: ['BTCUSDT', 'ETHUSDT'], tf: '5m', lane: 'SHORT', period: 20, margin: 150, leverage: 3, timeoutHours: 2 },
  { id: 'short_core', versionId: 'futures_breakout_short_core:v8', pairs: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'], tf: '1h', lane: 'SHORT', period: 34, margin: 250, leverage: 5, timeoutHours: 4 },
  { id: 'short_alt', versionId: 'futures_breakout_short_alt:v8', pairs: ['XRPUSDT', 'DOGEUSDT'], tf: '15m', lane: 'SHORT', period: 12, margin: 200, leverage: 3, timeoutHours: 3 },
  { id: 'long_probe', versionId: 'futures_breakout_long_probe:v8', pairs: ['BTCUSDT', 'ETHUSDT'], tf: '4h', lane: 'LONG', period: 55, margin: 220, leverage: 3, timeoutHours: 6 },
] as const;

const REST_HEADERS = {
  apikey: SERVICE_KEY,
  authorization: `Bearer ${SERVICE_KEY}`,
  'content-type': 'application/json',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
function nowIso() { return new Date().toISOString(); }
function round(value: number, digits = 4) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
function mean(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function std(values: number[]) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / (values.length - 1));
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
  });
  if (!response.ok) throw new Error(`supabase_${response.status}:${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
async function writeState(key: string, value: unknown) {
  await rest('org_state?on_conflict=key', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key, value: JSON.stringify(value), updated_at: nowIso() }),
  });
}

async function fetchKlines(pair: string, tf: string) {
  const response = await fetch(`${BINANCE_BASE}/klines?symbol=${encodeURIComponent(pair)}&interval=${encodeURIComponent(tf)}&limit=${CANDLE_LIMIT}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`binance_klines_${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length < 150) throw new Error('binance_history_insufficient');
  return rows;
}

function tfMinutes(tf: string) {
  const match = tf.match(/^(\d+)([mhd])$/);
  if (!match) return 60;
  const value = Number(match[1]);
  return match[2] === 'm' ? value : match[2] === 'h' ? value * 60 : value * 1440;
}
function quoteVolume(rows: any[], endIndex: number) {
  return rows.slice(Math.max(0, endIndex - 5), endIndex + 1).reduce((sum, row) => sum + (Number(row?.[7]) || 0), 0);
}
function slippagePct(orderSizeUsd: number, volumeUsd: number) {
  if (orderSizeUsd <= 0) return 0;
  if (volumeUsd <= 0) return 0.0008;
  const ratio = orderSizeUsd / volumeUsd;
  if (ratio < 0.0005) return 0.0001;
  if (ratio < 0.005) return 0.0003;
  return 0.0008;
}
function signalAt(rows: any[], index: number, period: number, lane: string) {
  if (index < Math.max(56, period)) return null;
  const closes = rows.slice(0, index + 1).map((row) => Number(row?.[4]));
  if (closes.some((value) => !Number.isFinite(value))) return null;
  const last = closes[index];
  const channel = closes.slice(index - period, index);
  const high = Math.max(...channel), low = Math.min(...channel);
  const sma55 = mean(closes.slice(index - 54, index + 1));
  const side = last > high ? 'LONG' : last < low ? 'SHORT' : null;
  if (!side || side !== lane) return null;
  if ((side === 'LONG' && last <= sma55) || (side === 'SHORT' && last >= sma55)) return null;
  return side;
}

type SimTrade = {
  pair: string;
  pnl: number;
  openedAt: number;
  closedAt: number;
  entryIndex: number;
  relativeIndex: number;
  oos: boolean;
  fold: number | null;
  exitReason: string;
};

function replayPair(profile: typeof PROFILES[number], pair: string, rows: any[]): SimTrade[] {
  const trades: SimTrade[] = [];
  const minutes = tfMinutes(profile.tf);
  const timeoutBars = Math.max(1, Math.ceil((profile.timeoutHours * 60) / minutes));
  const notional = profile.margin * profile.leverage;
  const oosStartIndex = Math.floor(rows.length * (1 - OOS_FRACTION));
  const forwardStartIndex = Math.floor(rows.length * FORWARD_START_FRACTION);
  const foldSize = Math.max(1, Math.floor((rows.length - forwardStartIndex) / FORWARD_FOLDS));

  for (let i = Math.max(56, profile.period); i < rows.length - 2; i++) {
    const side = signalAt(rows, i, profile.period, profile.lane);
    if (!side) continue;
    const entryIndex = i + 1;
    const rawEntry = Number(rows[entryIndex]?.[1]);
    if (!Number.isFinite(rawEntry) || rawEntry <= 0) continue;
    const entrySlip = slippagePct(notional, quoteVolume(rows, i));
    const entry = side === 'LONG' ? rawEntry * (1 + entrySlip) : rawEntry * (1 - entrySlip);
    const shares = Math.floor((notional / entry) * 10000) / 10000;
    if (shares <= 0) continue;
    const target = side === 'LONG' ? entry * 1.12 : entry * 0.88;
    const stop = side === 'LONG' ? entry * 0.97 : entry * 1.03;
    const maxExitIndex = Math.min(rows.length - 1, entryIndex + timeoutBars);
    let exitIndex = maxExitIndex;
    let rawExit = Number(rows[maxExitIndex]?.[4]);
    let exitReason = 'timeout';

    for (let j = entryIndex; j <= maxExitIndex; j++) {
      const high = Number(rows[j]?.[2]), low = Number(rows[j]?.[3]);
      if (![high, low].every(Number.isFinite)) continue;
      const stopHit = side === 'LONG' ? low <= stop : high >= stop;
      const targetHit = side === 'LONG' ? high >= target : low <= target;
      if (stopHit) { exitIndex = j; rawExit = stop; exitReason = 'stop_loss'; break; }
      if (targetHit) { exitIndex = j; rawExit = target; exitReason = 'take_profit'; break; }
    }
    if (!Number.isFinite(rawExit) || rawExit <= 0) continue;
    const exitSlip = slippagePct(notional, quoteVolume(rows, exitIndex));
    const exit = side === 'LONG' ? rawExit * (1 - exitSlip) : rawExit * (1 + exitSlip);
    const gross = side === 'LONG' ? (exit - entry) * shares : (entry - exit) * shares;
    const fees = 0.0004 * (entry * shares + exit * shares);
    const heldHours = Math.max(minutes / 60, ((exitIndex - entryIndex + 1) * minutes) / 60);
    const fundingEstimate = notional * 0.0001 * heldHours / 8;
    const pnl = gross - fees - fundingEstimate;
    let fold: number | null = null;
    if (entryIndex >= forwardStartIndex) fold = Math.min(FORWARD_FOLDS - 1, Math.floor((entryIndex - forwardStartIndex) / foldSize));
    trades.push({
      pair,
      pnl: round(pnl, 4),
      openedAt: Number(rows[entryIndex]?.[0]),
      closedAt: Number(rows[exitIndex]?.[6] ?? rows[exitIndex]?.[0]),
      entryIndex,
      relativeIndex: entryIndex / rows.length,
      oos: entryIndex >= oosStartIndex,
      fold,
      exitReason,
    });
    i = exitIndex;
  }
  return trades;
}

function summarize(trades: SimTrade[]) {
  const ordered = [...trades].sort((a, b) => a.closedAt - b.closedAt);
  const pnl = ordered.map((trade) => trade.pnl);
  const wins = pnl.filter((value) => value > 0), losses = pnl.filter((value) => value < 0);
  const grossProfit = wins.reduce((sum, value) => sum + value, 0), grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  const realizedPnl = pnl.reduce((sum, value) => sum + value, 0), expectancy = pnl.length ? realizedPnl / pnl.length : null;
  const pnlStd = std(pnl);
  const tStat = pnl.length >= 2 && pnlStd > 0 && expectancy != null ? expectancy / (pnlStd / Math.sqrt(pnl.length)) : null;
  let curve = 0, peak = 0, maxDrawdown = 0;
  for (const value of pnl) { curve += value; peak = Math.max(peak, curve); maxDrawdown = Math.max(maxDrawdown, peak - curve); }
  return {
    trades: pnl.length,
    wins: wins.length,
    losses: losses.length,
    winRate: pnl.length ? round(wins.length / pnl.length, 4) : null,
    realizedPnl: round(realizedPnl, 3),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 4) : null,
    expectancy: expectancy == null ? null : round(expectancy, 4),
    maxDrawdownUsd: round(maxDrawdown, 3),
    tStat: tStat == null ? null : round(tStat, 4),
  };
}

async function evaluateProfile(profile: typeof PROFILES[number]) {
  const pairResults = await Promise.all(profile.pairs.map(async (pair) => {
    const rows = await fetchKlines(pair, profile.tf);
    return { pair, bars: rows.length, trades: replayPair(profile, pair, rows), startAt: new Date(Number(rows[0]?.[0])).toISOString(), endAt: new Date(Number(rows.at(-1)?.[6] ?? rows.at(-1)?.[0])).toISOString() };
  }));
  const trades = pairResults.flatMap((result) => result.trades).sort((a, b) => a.openedAt - b.openedAt);
  const total = summarize(trades);
  const oosTrades = trades.filter((trade) => trade.oos);
  const oos = summarize(oosTrades);
  const oosPass = oos.trades >= 8 && oos.profitFactor != null && oos.profitFactor >= 1.1 && oos.expectancy != null && oos.expectancy > 0;
  const folds = Array.from({ length: FORWARD_FOLDS }, (_, fold) => {
    const metrics = summarize(trades.filter((trade) => trade.fold === fold));
    const pass = metrics.trades >= 3 && metrics.profitFactor != null && metrics.profitFactor >= 1 && metrics.expectancy != null && metrics.expectancy > 0;
    return { fold: fold + 1, pass, ...metrics };
  });
  const positiveFolds = folds.filter((fold) => fold.pass).length;
  const forwardTrades = folds.reduce((sum, fold) => sum + fold.trades, 0);
  const walkForwardPass = forwardTrades >= 12 && positiveFolds >= 2;
  const insufficient = oos.trades < 8 || forwardTrades < 12;
  return {
    profileId: profile.id,
    strategyVersionId: profile.versionId,
    source: 'binance_spot_public_klines',
    sourceRole: 'signal_research_reference',
    caveat: 'Historical spot-reference replay validates signal stability only. It is not futures mark/index/OI/liquidation evidence and cannot unlock live execution.',
    parameters: { tf: profile.tf, lane: profile.lane, donchianPeriod: profile.period, marginUsd: profile.margin, leverage: profile.leverage, timeoutHours: profile.timeoutHours },
    coverage: pairResults.map(({ pair, bars, startAt, endAt }) => ({ pair, bars, startAt, endAt })),
    total,
    oos: { split: 'last_25pct_chronological_holdout', pass: oosPass, ...oos },
    walkForward: { method: 'fixed_parameter_rolling_forward_3fold', startFraction: FORWARD_START_FRACTION, positiveFolds, requiredPositiveFolds: 2, forwardTrades, pass: walkForwardPass, folds },
    pass: oosPass && walkForwardPass,
    status: insufficient ? 'INSUFFICIENT_SAMPLE' : oosPass && walkForwardPass ? 'PASS' : 'FAIL',
  };
}

async function runResearch() {
  const startedAt = nowIso();
  const settled = await Promise.allSettled(PROFILES.map(evaluateProfile));
  const profiles: Record<string, unknown> = {};
  const errors: Array<{ profileId: string; error: string }> = [];
  settled.forEach((result, index) => {
    const profile = PROFILES[index];
    if (result.status === 'fulfilled') profiles[profile.id] = result.value;
    else errors.push({ profileId: profile.id, error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
  });
  const payload = {
    ok: errors.length === 0,
    researchVersion: RESEARCH_VERSION,
    dataPolicy: 'real_public_market_data_only',
    paperOnly: true,
    liveOrders: false,
    startedAt,
    completedAt: nowIso(),
    profiles,
    errors,
  };
  await writeState(STATE_KEY, payload);
  return payload;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (!['GET', 'POST'].includes(req.method)) return json({ ok: false, error: 'method_not_allowed' }, 405);
  if (!await authorized(req)) return json({ ok: false, error: 'research_auth_invalid' }, 403);
  try { return json(await runResearch()); }
  catch (error) { return json({ ok: false, researchVersion: RESEARCH_VERSION, paperOnly: true, liveOrders: false, error: error instanceof Error ? error.message : 'research_failed' }, 500); }
});
