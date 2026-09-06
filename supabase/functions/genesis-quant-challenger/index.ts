declare const Deno: any;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
const BINANCE_BASE = Deno.env.get('BINANCE_BASE') || 'https://data-api.binance.vision/api/v3';
const RUNNER_TOKEN_SHA256 = 'e9f02987e836a6eaf8ef8d7afaed805580cd31264aef5ed86fc3ebb756c59d91';
const ENGINE_VERSION = 'qcl_v1';
const STATE_KEY = 'quant_challenger_lab_v1';
const HISTORY_KEY = 'quant_challenger_history_v1';
const CANDLE_LIMIT = 1000;
const TRAIN_END = 0.60;
const VALIDATION_END = 0.80;
const MIN_TRAIN_TRADES = 10;
const MIN_VALIDATION_TRADES = 5;
const MIN_HOLDOUT_TRADES = 5;

const PROFILES = [
  { id: 'short_micro', strategyId: 'futures_breakout_short_micro', parentVersionId: 'futures_breakout_short_micro:v8', tradeType: 'crypto_futures_breakout_short_micro', pairs: ['BTCUSDT', 'ETHUSDT'], tf: '5m', lane: 'SHORT', basePeriod: 20, margin: 150, leverage: 3, baseTimeoutHours: 2 },
  { id: 'short_core', strategyId: 'futures_breakout_short_core', parentVersionId: 'futures_breakout_short_core:v8', tradeType: 'crypto_futures_breakout_short', pairs: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'], tf: '1h', lane: 'SHORT', basePeriod: 34, margin: 250, leverage: 5, baseTimeoutHours: 4 },
  { id: 'short_alt', strategyId: 'futures_breakout_short_alt', parentVersionId: 'futures_breakout_short_alt:v8', tradeType: 'crypto_futures_breakout_short_alt', pairs: ['XRPUSDT', 'DOGEUSDT'], tf: '15m', lane: 'SHORT', basePeriod: 12, margin: 200, leverage: 3, baseTimeoutHours: 3 },
  { id: 'long_probe', strategyId: 'futures_breakout_long_probe', parentVersionId: 'futures_breakout_long_probe:v8', tradeType: 'crypto_futures_breakout_long', pairs: ['BTCUSDT', 'ETHUSDT'], tf: '4h', lane: 'LONG', basePeriod: 55, margin: 220, leverage: 3, baseTimeoutHours: 6 },
] as const;

type Profile = typeof PROFILES[number];
type Candidate = { period: number; targetPct: number; stopPct: number; timeoutHours: number };
type SimTrade = { pair: string; pnl: number; openedAt: number; closedAt: number; relativeIndex: number; exitReason: string };
type Metrics = { trades: number; wins: number; losses: number; winRate: number | null; realizedPnl: number; profitFactor: number | null; expectancy: number | null; maxDrawdownUsd: number; tStat: number | null };
type PreparedPair = { pair: string; rows: any[]; signalsByPeriod: Record<string, number[]> };

const REST_HEADERS = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
function nowIso() { return new Date().toISOString(); }
function round(value: number, digits = 4) { const scale = 10 ** digits; return Math.round(value * scale) / scale; }
function mean(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function std(values: number[]) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / (values.length - 1));
}
function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
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
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...REST_HEADERS, ...(init.headers || {}) } });
  if (!response.ok) throw new Error(`supabase_${response.status}:${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
async function readState(key: string) {
  const rows = await rest(`org_state?key=eq.${encodeURIComponent(key)}&select=value,updated_at&limit=1`);
  return { value: parseJson(rows?.[0]?.value, null), updatedAt: rows?.[0]?.updated_at ?? null };
}
async function writeState(key: string, value: unknown) {
  await rest('org_state?on_conflict=key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ key, value: JSON.stringify(value), updated_at: nowIso() }) });
}
async function fetchKlines(pair: string, tf: string) {
  const response = await fetch(`${BINANCE_BASE}/klines?symbol=${encodeURIComponent(pair)}&interval=${encodeURIComponent(tf)}&limit=${CANDLE_LIMIT}`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`binance_klines_${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length < 250) throw new Error('binance_history_insufficient');
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
function candidateGrid(profile: Profile): Candidate[] {
  const periods = [...new Set([0.6, 0.8, 1, 1.2].map((factor) => Math.max(6, Math.round(profile.basePeriod * factor))))];
  const targets = [0.04, 0.08, 0.12];
  const stops = [0.015, 0.03];
  const timeouts = [...new Set([0.5, 1].map((factor) => Math.max(0.5, round(profile.baseTimeoutHours * factor, 2))))];
  const out: Candidate[] = [];
  for (const period of periods) for (const targetPct of targets) for (const stopPct of stops) for (const timeoutHours of timeouts) out.push({ period, targetPct, stopPct, timeoutHours });
  return out;
}
function candidateId(profile: Profile, c: Candidate) {
  return `${profile.id}:p${c.period}:tp${Math.round(c.targetPct * 1000)}:sl${Math.round(c.stopPct * 1000)}:h${String(c.timeoutHours).replace('.', '_')}`;
}
function signalIndicesForPeriod(profile: Profile, rows: any[], period: number) {
  const closes = rows.map((row) => Number(row?.[4]));
  const prefix = new Array(closes.length + 1).fill(0);
  for (let i = 0; i < closes.length; i++) prefix[i + 1] = prefix[i] + (Number.isFinite(closes[i]) ? closes[i] : 0);
  const indices: number[] = [];
  for (let i = Math.max(56, period); i < rows.length - 2; i++) {
    const last = closes[i];
    if (!Number.isFinite(last) || last <= 0) continue;
    let high = -Infinity, low = Infinity, valid = true;
    for (let j = i - period; j < i; j++) {
      const value = closes[j];
      if (!Number.isFinite(value)) { valid = false; break; }
      if (value > high) high = value;
      if (value < low) low = value;
    }
    if (!valid) continue;
    const sma55 = (prefix[i + 1] - prefix[i - 54]) / 55;
    const side = last > high ? 'LONG' : last < low ? 'SHORT' : null;
    if (!side || side !== profile.lane) continue;
    if ((side === 'LONG' && last <= sma55) || (side === 'SHORT' && last >= sma55)) continue;
    indices.push(i);
  }
  return indices;
}
function preparePair(profile: Profile, pair: string, rows: any[], periods: number[]): PreparedPair {
  const signalsByPeriod: Record<string, number[]> = {};
  for (const period of periods) signalsByPeriod[String(period)] = signalIndicesForPeriod(profile, rows, period);
  return { pair, rows, signalsByPeriod };
}
function replayPrepared(profile: Profile, c: Candidate, prepared: PreparedPair): SimTrade[] {
  const { pair, rows } = prepared;
  const signalIndices = prepared.signalsByPeriod[String(c.period)] ?? [];
  const trades: SimTrade[] = [];
  const minutes = tfMinutes(profile.tf);
  const timeoutBars = Math.max(1, Math.ceil((c.timeoutHours * 60) / minutes));
  const notional = profile.margin * profile.leverage;
  let lastExitIndex = -1;
  for (const i of signalIndices) {
    if (i <= lastExitIndex) continue;
    const side = profile.lane;
    const entryIndex = i + 1;
    const rawEntry = Number(rows[entryIndex]?.[1]);
    if (!Number.isFinite(rawEntry) || rawEntry <= 0) continue;
    const entrySlip = slippagePct(notional, quoteVolume(rows, i));
    const entry = side === 'LONG' ? rawEntry * (1 + entrySlip) : rawEntry * (1 - entrySlip);
    const shares = Math.floor((notional / entry) * 10000) / 10000;
    if (shares <= 0) continue;
    const target = side === 'LONG' ? entry * (1 + c.targetPct) : entry * (1 - c.targetPct);
    const stop = side === 'LONG' ? entry * (1 - c.stopPct) : entry * (1 + c.stopPct);
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
    trades.push({ pair, pnl: round(gross - fees - fundingEstimate, 4), openedAt: Number(rows[entryIndex]?.[0]), closedAt: Number(rows[exitIndex]?.[6] ?? rows[exitIndex]?.[0]), relativeIndex: entryIndex / rows.length, exitReason });
    lastExitIndex = exitIndex;
  }
  return trades;
}

function summarize(trades: SimTrade[]): Metrics {
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
    trades: pnl.length, wins: wins.length, losses: losses.length,
    winRate: pnl.length ? round(wins.length / pnl.length, 4) : null,
    realizedPnl: round(realizedPnl, 3), profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 4) : null,
    expectancy: expectancy == null ? null : round(expectancy, 4), maxDrawdownUsd: round(maxDrawdown, 3), tStat: tStat == null ? null : round(tStat, 4),
  };
}
function robustScore(metrics: Metrics, profile: Profile) {
  if (metrics.trades < 3 || metrics.expectancy == null) return -1e9;
  const pf = Math.min(metrics.profitFactor ?? 0, 4);
  const t = Math.max(-4, Math.min(metrics.tStat ?? -4, 4));
  const evScale = Math.max(-3, Math.min(metrics.expectancy / Math.max(1, profile.margin * 0.01), 3));
  const ddPenalty = metrics.maxDrawdownUsd / Math.max(profile.margin * profile.pairs.length, 1);
  return round((pf * 2) + (t * 0.35) + evScale - ddPenalty + Math.min(metrics.trades / 40, 1) * 0.3, 6);
}
function passTrain(m: Metrics) { return m.trades >= MIN_TRAIN_TRADES && m.profitFactor != null && m.profitFactor >= 1.05 && m.expectancy != null && m.expectancy > 0; }
function passValidation(m: Metrics) { return m.trades >= MIN_VALIDATION_TRADES && m.profitFactor != null && m.profitFactor >= 1.05 && m.expectancy != null && m.expectancy > 0; }
function passHoldout(m: Metrics) { return m.trades >= MIN_HOLDOUT_TRADES && m.profitFactor != null && m.profitFactor >= 1.1 && m.expectancy != null && m.expectancy > 0; }
function walkForward(trades: SimTrade[]) {
  const dev = trades.filter((trade) => trade.relativeIndex < VALIDATION_END);
  const ranges = [[0.20, 0.40], [0.40, 0.60], [0.60, 0.80]] as const;
  const folds = ranges.map(([start, end], index) => {
    const metrics = summarize(dev.filter((trade) => trade.relativeIndex >= start && trade.relativeIndex < end));
    const pass = metrics.trades >= 3 && metrics.profitFactor != null && metrics.profitFactor >= 1 && metrics.expectancy != null && metrics.expectancy > 0;
    return { fold: index + 1, range: [start, end], pass, ...metrics };
  });
  const positiveFolds = folds.filter((fold) => fold.pass).length;
  const forwardTrades = folds.reduce((sum, fold) => sum + fold.trades, 0);
  return { method: 'fixed_candidate_3fold_before_holdout', positiveFolds, requiredPositiveFolds: 2, forwardTrades, pass: forwardTrades >= 12 && positiveFolds >= 2, folds };
}
async function evaluateProfile(profile: Profile) {
  const grid = candidateGrid(profile);
  const periods = [...new Set(grid.map((candidate) => candidate.period))];
  const pairRows = await Promise.all(profile.pairs.map(async (pair) => {
    const rows = await fetchKlines(pair, profile.tf);
    return preparePair(profile, pair, rows, periods);
  }));
  const trainRanking = grid.map((candidate) => {
    const trades = pairRows.flatMap((prepared) => replayPrepared(profile, candidate, prepared));
    const train = summarize(trades.filter((trade) => trade.relativeIndex < TRAIN_END));
    return { candidate, id: candidateId(profile, candidate), trades, train, trainPass: passTrain(train), trainScore: robustScore(train, profile) };
  }).sort((a, b) => b.trainScore - a.trainScore);
  const shortlist = trainRanking.slice(0, 10).map((item, index) => {
    const validation = summarize(item.trades.filter((trade) => trade.relativeIndex >= TRAIN_END && trade.relativeIndex < VALIDATION_END));
    const validationPass = item.trainPass && passValidation(validation);
    const wf = walkForward(item.trades);
    return { ...item, trainRank: index + 1, validation, validationPass, validationScore: robustScore(validation, profile), walkForward: wf };
  });
  const finalists = shortlist.filter((item) => item.validationPass && item.walkForward.pass).sort((a, b) => b.validationScore - a.validationScore);
  const inspected = finalists.slice(0, 5).map((item, index) => {
    const holdout = summarize(item.trades.filter((trade) => trade.relativeIndex >= VALIDATION_END));
    const holdoutPass = passHoldout(holdout);
    return {
      candidateId: item.id, params: item.candidate, trainRank: item.trainRank, validationRank: index + 1,
      train: item.train, validation: item.validation, walkForward: item.walkForward, holdout: { ...holdout, pass: holdoutPass },
      survivor: holdoutPass,
    };
  });
  const survivors = inspected.filter((item) => item.survivor);
  const winner = survivors[0] ?? null;
  return {
    profileId: profile.id, strategyId: profile.strategyId, parentVersionId: profile.parentVersionId,
    searchSpace: { candidateCount: grid.length, trainEnd: TRAIN_END, validationEnd: VALIDATION_END, holdoutStart: VALIDATION_END, holdoutUsedForRanking: false },
    coverage: pairRows.map(({ pair, rows }) => ({ pair, bars: rows.length, startAt: new Date(Number(rows[0]?.[0])).toISOString(), endAt: new Date(Number(rows.at(-1)?.[6] ?? rows.at(-1)?.[0])).toISOString() })),
    topTrain: trainRanking.slice(0, 5).map((item, index) => ({ rank: index + 1, candidateId: item.id, params: item.candidate, trainPass: item.trainPass, trainScore: item.trainScore, train: item.train })),
    finalists: inspected,
    survivorCount: survivors.length,
    winner,
    status: winner ? 'SHADOW_CHALLENGER_FOUND' : finalists.length ? 'FINALISTS_FAILED_HOLDOUT' : 'NO_ROBUST_FINALIST',
  };
}
async function runLab(profileId: string) {
  const profile = PROFILES.find((item) => item.id === profileId);
  if (!profile) throw new Error(`unknown_profile:${profileId}`);
  const startedAt = nowIso();
  const result = await evaluateProfile(profile);
  const previousState = await readState(STATE_KEY);
  const previous: any = previousState.value && typeof previousState.value === 'object' ? previousState.value : {};
  const profiles: Record<string, any> = { ...(previous.profiles ?? {}), [profile.id]: result };
  const survivorCount = Object.values(profiles).reduce((sum, item: any) => sum + Number(item?.survivorCount ?? 0), 0);
  const payload = {
    ok: true,
    engineVersion: ENGINE_VERSION,
    mode: 'RESEARCH_ONLY',
    executionAuthority: false,
    paperOnly: true,
    liveOrders: false,
    scopeProfile: profile.id,
    dataPolicy: 'binance_spot_public_signal_reference_only',
    antiOverfitPolicy: {
      train: 'first_60pct', validation: 'next_20pct', finalHoldout: 'last_20pct',
      holdoutUsedForRanking: false,
      rule: 'Only train metrics rank the grid. Validation filters. Holdout is opened only for finalists and never tunes parameters.',
    },
    startedAt, completedAt: nowIso(), survivorCount, profiles, errors: [],
  };
  await writeState(STATE_KEY, payload);
  const historyState = await readState(HISTORY_KEY);
  const history = Array.isArray(historyState.value) ? historyState.value : [];
  const compact = {
    engineVersion: ENGINE_VERSION, completedAt: payload.completedAt, scopeProfile: profile.id,
    status: result.status, survivorCount: result.survivorCount,
    winner: result.winner ? { candidateId: result.winner.candidateId, params: result.winner.params, validation: result.winner.validation, holdout: result.winner.holdout } : null,
  };
  await writeState(HISTORY_KEY, [...history, compact].slice(-40));
  return payload;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (!['GET', 'POST'].includes(req.method)) return json({ ok: false, error: 'method_not_allowed' }, 405);
  if (!await authorized(req)) return json({ ok: false, error: 'challenger_auth_invalid' }, 403);
  const profileId = new URL(req.url).searchParams.get('profile');
  if (!profileId) return json({ ok: false, error: 'profile_required', allowedProfiles: PROFILES.map((profile) => profile.id) }, 400);
  try { return json(await runLab(profileId)); }
  catch (error) { return json({ ok: false, engineVersion: ENGINE_VERSION, mode: 'RESEARCH_ONLY', executionAuthority: false, paperOnly: true, liveOrders: false, profileId, error: error instanceof Error ? error.message : 'challenger_failed' }, 500); }
});
