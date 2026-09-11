const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
const BINANCE_BASE = Deno.env.get('BINANCE_BASE') || 'https://data-api.binance.vision/api/v3';
const RUNNER_TOKEN_SHA256 = 'e9f02987e836a6eaf8ef8d7afaed805580cd31264aef5ed86fc3ebb756c59d91';
const RUNNER_VERSION = 'v8.4';
const POLICY_KEY = 'quant_validation_policy_v1';
const RUNTIME_KEY = 'quant_validation_runtime_v1';
const RESEARCH_KEY = 'quant_research_evidence_v1';
const PROFIT_RATCHET_KEY = 'futures_profit_ratchet_v1';
const MIN_INTERVAL_MS = 4 * 60 * 1000;
const MAX_OPEN_POSITIONS = 6;
const MIN_EXPECTED_NET_USD = 18;
const MIN_REWARD_RISK = 1.8;

const SHORT_EXIT_POLICY = {
  version: 'adaptive_profit_ratchet_v1',
  targetPct: 0.06,
  stopPct: 0.03,
  activationNetUsd: 5,
  minProtectedUsd: 1,
  timedProfitAfterFraction: 0.35,
  orderBookLevels: 20,
  strongGivebackFraction: 0.50,
  neutralGivebackFraction: 0.35,
  weakGivebackFraction: 0.20,
} as const;

const FUTURES_TYPES = [
  'crypto_futures_breakout_short_micro',
  'crypto_futures_breakout_short',
  'crypto_futures_breakout_short_alt',
  'crypto_futures_breakout_long',
] as const;

const PROFILES = [
  { id: 'short_micro', strategyId: 'futures_breakout_short_micro', versionId: 'futures_breakout_short_micro:v9', parentVersionId: 'futures_breakout_short_micro:v8', type: FUTURES_TYPES[0], pairs: ['BTCUSDT', 'ETHUSDT'], tf: '5m', lane: 'SHORT', period: 20, margin: 150, leverage: 3, timeoutHours: 2, targetPct: SHORT_EXIT_POLICY.targetPct, stopPct: SHORT_EXIT_POLICY.stopPct, exitPolicyVersion: SHORT_EXIT_POLICY.version },
  { id: 'short_core', strategyId: 'futures_breakout_short_core', versionId: 'futures_breakout_short_core:v9', parentVersionId: 'futures_breakout_short_core:v8', type: FUTURES_TYPES[1], pairs: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'], tf: '1h', lane: 'SHORT', period: 34, margin: 250, leverage: 5, timeoutHours: 4, targetPct: SHORT_EXIT_POLICY.targetPct, stopPct: SHORT_EXIT_POLICY.stopPct, exitPolicyVersion: SHORT_EXIT_POLICY.version },
  { id: 'short_alt', strategyId: 'futures_breakout_short_alt', versionId: 'futures_breakout_short_alt:v9', parentVersionId: 'futures_breakout_short_alt:v8', type: FUTURES_TYPES[2], pairs: ['XRPUSDT', 'DOGEUSDT'], tf: '15m', lane: 'SHORT', period: 12, margin: 200, leverage: 3, timeoutHours: 3, targetPct: SHORT_EXIT_POLICY.targetPct, stopPct: SHORT_EXIT_POLICY.stopPct, exitPolicyVersion: SHORT_EXIT_POLICY.version },
  { id: 'long_probe', strategyId: 'futures_breakout_long_probe', versionId: 'futures_breakout_long_probe:v8', parentVersionId: 'futures_breakout_long_probe:v7', type: FUTURES_TYPES[3], pairs: ['BTCUSDT', 'ETHUSDT'], tf: '4h', lane: 'LONG', period: 55, margin: 220, leverage: 3, timeoutHours: 6, targetPct: 0.12, stopPct: 0.03, exitPolicyVersion: 'fixed_tp_v1' },
] as const;

const DEFAULT_POLICY = {
  version: 'institutional_v1',
  quarantine: { minClosed: 10, maxProfitFactor: 0.8, requireNegativeExpectancy: true },
  validating: { minClosed: 30, minProfitFactor: 1.1, minExpectancy: 0 },
  validated: {
    minClosed: 50,
    minProfitFactor: 1.3,
    minExpectancy: 0,
    minWinRate: 0.45,
    minTStat: 2,
    maxDrawdownPct: 0.25,
    requireWalkForward: true,
    requireOos: true,
    minPositiveRegimes: 2,
  },
  capitalEligible: {
    requiresFounderGate: true,
    requiresCanonicalReconciliation: true,
    requiresLivePreflight: true,
  },
};

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
function round(value: number, decimals = 3) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}
function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
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

async function readState(key: string) {
  const rows = await rest(`org_state?key=eq.${encodeURIComponent(key)}&select=value,updated_at&limit=1`);
  return { value: parseJson(rows?.[0]?.value, null), updatedAt: rows?.[0]?.updated_at ?? null };
}
async function writeState(key: string, value: unknown) {
  await rest('org_state?on_conflict=key', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key, value: JSON.stringify(value), updated_at: nowIso() }),
  });
}
async function loadPolicy() {
  try {
    const state = await readState(POLICY_KEY);
    const parsed: any = state.value;
    if (parsed && typeof parsed === 'object' && typeof parsed.version === 'string') return parsed;
  } catch { /* fail closed to built-in policy */ }
  return DEFAULT_POLICY;
}

async function ensureStrategyVersions() {
  const rows = PROFILES
    .filter((profile) => profile.versionId.endsWith(':v9'))
    .map((profile) => ({
      id: profile.versionId,
      strategy_id: profile.strategyId,
      profile_id: profile.id,
      version: 'v9',
      trade_type: profile.type,
      status: 'EXPERIMENT',
      params: {
        tf: profile.tf,
        lane: profile.lane,
        donchianPeriod: profile.period,
        marginUsd: profile.margin,
        leverage: profile.leverage,
        timeoutHours: profile.timeoutHours,
        targetPct: profile.targetPct,
        stopPct: profile.stopPct,
        exitPolicyVersion: profile.exitPolicyVersion,
        activationNetUsd: SHORT_EXIT_POLICY.activationNetUsd,
        minProtectedUsd: SHORT_EXIT_POLICY.minProtectedUsd,
        timedProfitAfterFraction: SHORT_EXIT_POLICY.timedProfitAfterFraction,
        orderBookLevels: SHORT_EXIT_POLICY.orderBookLevels,
        strongGivebackFraction: SHORT_EXIT_POLICY.strongGivebackFraction,
        neutralGivebackFraction: SHORT_EXIT_POLICY.neutralGivebackFraction,
        weakGivebackFraction: SHORT_EXIT_POLICY.weakGivebackFraction,
      },
      parent_version_id: profile.parentVersionId,
      source: `genesis_futures_runner_${RUNNER_VERSION}`,
      activated_at: nowIso(),
    }));
  if (!rows.length) return;
  await rest('strategy_versions?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
}

async function fetchKlines(pair: string, tf: string) {
  const response = await fetch(`${BINANCE_BASE}/klines?symbol=${encodeURIComponent(pair)}&interval=${encodeURIComponent(tf)}&limit=230`, {
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`binance_klines_${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('binance_klines_invalid');
  return rows;
}
async function fetchPrice(pair: string) {
  const response = await fetch(`${BINANCE_BASE}/ticker/price?symbol=${encodeURIComponent(pair)}`, {
    signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok) return null;
  const payload = await response.json();
  const value = Number(payload?.price);
  return Number.isFinite(value) ? value : null;
}
async function fetchDepth(pair: string) {
  try {
    const response = await fetch(`${BINANCE_BASE}/depth?symbol=${encodeURIComponent(pair)}&limit=${SHORT_EXIT_POLICY.orderBookLevels}`, {
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    if (!Array.isArray(payload?.bids) || !Array.isArray(payload?.asks)) return null;
    return payload;
  } catch {
    return null;
  }
}

function signal(rows: any[], period: number, lane: string) {
  const closes = rows.slice(0, -1).map((row) => Number(row?.[4])).filter(Number.isFinite);
  if (closes.length < Math.max(57, period + 2)) return { go: false, reason: 'insufficient_history' };
  const last = closes.at(-1)!;
  const channel = closes.slice(-period - 1, -1);
  const high = Math.max(...channel);
  const low = Math.min(...channel);
  const sma55 = mean(closes.slice(-55));
  const side = last > high ? 'LONG' : last < low ? 'SHORT' : null;
  if (!side) return { go: false, reason: 'inside_channel' };
  if (side !== lane) return { go: false, reason: 'lane_filter' };
  if ((side === 'LONG' && last <= sma55) || (side === 'SHORT' && last >= sma55)) return { go: false, reason: 'regime_filter' };
  return { go: true, side, reason: `donchian_${side.toLowerCase()}_regime_aligned` };
}

function hourInZone(date: Date, timeZone: string) {
  const formatted = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(date);
  const hour = Number(formatted);
  return Number.isFinite(hour) ? hour : -1;
}
function sessionLabel(date = new Date()) {
  const tokyo = hourInZone(date, 'Asia/Tokyo');
  const london = hourInZone(date, 'Europe/London');
  const ny = hourInZone(date, 'America/New_York');
  const asiaOpen = tokyo >= 9 && tokyo < 17;
  const londonOpen = london >= 8 && london < 16;
  const nyOpen = ny >= 8 && ny < 16;
  if (londonOpen && nyOpen) return 'LONDON_NY_OVERLAP';
  if (asiaOpen && londonOpen) return 'ASIA_LONDON_OVERLAP';
  if (asiaOpen) return 'ASIA';
  if (londonOpen) return 'LONDON';
  if (nyOpen) return 'NEW_YORK';
  return 'OFF_HOURS';
}
function classifyMarketContext(rows: any[]) {
  const closes = rows.slice(0, -1).map((row) => Number(row?.[4])).filter(Number.isFinite);
  if (closes.length < 100) return { regime: 'UNKNOWN', session: sessionLabel(), volRatio: null, momentum20: null, smaSpreadPct: null };
  const source = closes.slice(-101);
  const returns = source.slice(1).map((value, index) => source[index] > 0 ? (value / source[index]) - 1 : 0);
  const recentVol = std(returns.slice(-20));
  const baselineVol = std(returns);
  const volRatio = baselineVol > 0 ? recentVol / baselineVol : 1;
  const sma20 = mean(closes.slice(-20));
  const sma55 = mean(closes.slice(-55));
  const last = closes.at(-1)!;
  const momentum20 = closes.at(-21)! > 0 ? (last / closes.at(-21)!) - 1 : 0;
  const smaSpreadPct = sma55 > 0 ? (sma20 / sma55) - 1 : 0;
  const trendingUp = smaSpreadPct > 0.0015 && momentum20 > 0;
  const trendingDown = smaSpreadPct < -0.0015 && momentum20 < 0;
  let regime = 'RANGE';
  if (trendingUp) regime = volRatio >= 1.35 ? 'HIGH_VOL_TREND_UP' : 'TREND_UP';
  else if (trendingDown) regime = volRatio >= 1.35 ? 'HIGH_VOL_TREND_DOWN' : 'TREND_DOWN';
  else if (volRatio >= 1.35) regime = 'HIGH_VOL_RANGE';
  else if (volRatio <= 0.75) regime = 'LOW_VOL_RANGE';
  return { regime, session: sessionLabel(), volRatio: round(volRatio, 3), momentum20: round(momentum20, 5), smaSpreadPct: round(smaSpreadPct, 5) };
}
function atrPct(rows: any[], period = 14) {
  const candles = rows.slice(0, -1).slice(-(period + 1));
  if (candles.length < period + 1) return 0;
  const ranges: number[] = [];
  for (let index = 1; index < candles.length; index++) {
    const high = Number(candles[index]?.[2]);
    const low = Number(candles[index]?.[3]);
    const prevClose = Number(candles[index - 1]?.[4]);
    if (![high, low, prevClose].every(Number.isFinite) || prevClose <= 0) continue;
    ranges.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  const close = Number(candles.at(-1)?.[4]);
  return ranges.length && Number.isFinite(close) && close > 0 ? mean(ranges) / close : 0;
}
function orderBookImbalance(depth: any) {
  if (!depth) return null;
  const bidUsd = depth.bids.slice(0, SHORT_EXIT_POLICY.orderBookLevels).reduce((sum: number, level: any[]) => sum + ((Number(level?.[0]) || 0) * (Number(level?.[1]) || 0)), 0);
  const askUsd = depth.asks.slice(0, SHORT_EXIT_POLICY.orderBookLevels).reduce((sum: number, level: any[]) => sum + ((Number(level?.[0]) || 0) * (Number(level?.[1]) || 0)), 0);
  const total = bidUsd + askUsd;
  return total > 0 ? round((bidUsd - askUsd) / total, 4) : null;
}
function exitContext(side: string, rows: any[], depth: any) {
  const market = classifyMarketContext(rows);
  const imbalance = orderBookImbalance(depth);
  const momentum = Number(market.momentum20 || 0);
  const regimeAligned = side === 'LONG'
    ? market.regime === 'TREND_UP' || market.regime === 'HIGH_VOL_TREND_UP'
    : market.regime === 'TREND_DOWN' || market.regime === 'HIGH_VOL_TREND_DOWN';
  const momentumAligned = side === 'LONG' ? momentum > 0 : momentum < 0;
  const bookAligned = imbalance == null ? null : (side === 'LONG' ? imbalance >= 0.08 : imbalance <= -0.08);
  const bookOpposed = imbalance == null ? false : (side === 'LONG' ? imbalance <= -0.12 : imbalance >= 0.12);
  let score = 0;
  if (regimeAligned) score += 2;
  if (momentumAligned) score += 1;
  if (bookAligned === true) score += 1;
  if (bookOpposed) score -= 1;
  const strength = score >= 3 ? 'STRONG' : score <= 0 ? 'WEAK' : 'NEUTRAL';
  return {
    strength,
    score,
    regime: market.regime,
    momentum20: market.momentum20,
    volRatio: market.volRatio,
    orderBookImbalance: imbalance,
    atrPct: round(atrPct(rows), 6),
    orderBookSource: 'binance_spot_public',
  };
}
function protectedTierFloor(mfeUsd: number) {
  if (mfeUsd >= 200) return 150;
  if (mfeUsd >= 100) return 70;
  if (mfeUsd >= 50) return 30;
  if (mfeUsd >= 25) return 15;
  if (mfeUsd >= 10) return 5;
  if (mfeUsd >= SHORT_EXIT_POLICY.activationNetUsd) return SHORT_EXIT_POLICY.minProtectedUsd;
  return 0;
}
function adaptiveProfitFloor(mfeUsd: number, context: ReturnType<typeof exitContext>, notionalUsd: number) {
  if (mfeUsd < SHORT_EXIT_POLICY.activationNetUsd) return 0;
  const givebackFraction = context.strength === 'STRONG'
    ? SHORT_EXIT_POLICY.strongGivebackFraction
    : context.strength === 'WEAK'
      ? SHORT_EXIT_POLICY.weakGivebackFraction
      : SHORT_EXIT_POLICY.neutralGivebackFraction;
  const atrRoomMultiplier = context.strength === 'STRONG' ? 1.5 : context.strength === 'WEAK' ? 0.55 : 1;
  const atrRoomUsd = Math.max(0, Number(context.atrPct || 0) * notionalUsd * atrRoomMultiplier);
  const givebackUsd = Math.max(mfeUsd * givebackFraction, atrRoomUsd);
  const contextualFloor = Math.max(SHORT_EXIT_POLICY.minProtectedUsd, mfeUsd - givebackUsd);
  return round(Math.max(protectedTierFloor(mfeUsd), contextualFloor));
}

function quoteVolume(rows: any[]) { return rows.slice(-6).reduce((sum, row) => sum + (Number(row?.[7]) || 0), 0); }
function slippagePct(orderSizeUsd: number, volumeUsd: number) {
  if (orderSizeUsd <= 0) return 0;
  if (volumeUsd <= 0) return 0.0008;
  const ratio = orderSizeUsd / volumeUsd;
  if (ratio < 0.0005) return 0.0001;
  if (ratio < 0.005) return 0.0003;
  return 0.0008;
}
function economics(profile: typeof PROFILES[number], side: string, price: number, volumeUsd: number) {
  const notional = profile.margin * profile.leverage;
  const slip = slippagePct(notional, volumeUsd);
  const entry = side === 'LONG' ? price * (1 + slip) : price * (1 - slip);
  const shares = Math.floor((notional / entry) * 10000) / 10000;
  const target = side === 'LONG' ? entry * (1 + profile.targetPct) : entry * (1 - profile.targetPct);
  const stop = side === 'LONG' ? entry * (1 - profile.stopPct) : entry * (1 + profile.stopPct);
  const grossTp = side === 'LONG' ? (target - entry) * shares : (entry - target) * shares;
  const grossSl = side === 'LONG' ? (stop - entry) * shares : (entry - stop) * shares;
  const tpFees = 0.0004 * (entry * shares + target * shares);
  const slFees = 0.0004 * (entry * shares + stop * shares);
  const fundingEstimate = notional * 0.0001;
  const tpNet = grossTp - tpFees - fundingEstimate;
  const slNet = grossSl - slFees;
  const rr = slNet < 0 ? tpNet / Math.abs(slNet) : 0;
  return { notional, slip, entry, shares, target, stop, tpNet, slNet, rr };
}

async function openRows() {
  return await rest(`trades?trade_type=in.(${FUTURES_TYPES.join(',')})&status=eq.open&select=id,trade_type,asset_pair,outcome,entry_price,shares,target_price,stop_price,opened_at,notional_usd,entry_volume24h,funding_rate,strategy_version_id,runner_version&limit=100`) || [];
}
function timeoutHoursFor(tradeType: string) { return PROFILES.find((profile) => profile.type === tradeType)?.timeoutHours ?? 6; }
function profileForTradeType(tradeType: string) { return PROFILES.find((profile) => profile.type === tradeType) ?? null; }

function markEconomics(row: any, mark: number, ageHours: number) {
  const entry = Number(row.entry_price);
  const shares = Number(row.shares);
  const notional = Number(row.notional_usd || entry * shares);
  const volumeUsd = Number(row.entry_volume24h || 0);
  const slip = slippagePct(notional, volumeUsd);
  const v9 = String(row.strategy_version_id || '').endsWith(':v9');
  const effectiveEntry = v9 ? entry : (row.outcome === 'LONG' ? entry * (1 + slip) : entry * (1 - slip));
  const effectiveExit = row.outcome === 'LONG' ? mark * (1 - slip) : mark * (1 + slip);
  const gross = row.outcome === 'LONG' ? (effectiveExit - effectiveEntry) * shares : (effectiveEntry - effectiveExit) * shares;
  const fees = 0.0004 * (effectiveEntry * shares + effectiveExit * shares);
  const fundingRate = Number(row.funding_rate || 0.0001);
  const fundingPaid = notional * fundingRate * Math.max(1, ageHours) / 8;
  const pnl = round(gross - fees - fundingPaid);

  const stop = Number(row.stop_price);
  let riskUsd = 0;
  if (Number.isFinite(stop) && stop > 0) {
    const effectiveStop = row.outcome === 'LONG' ? stop * (1 - slip) : stop * (1 + slip);
    const grossStop = row.outcome === 'LONG'
      ? (effectiveStop - effectiveEntry) * shares
      : (effectiveEntry - effectiveStop) * shares;
    const stopFees = 0.0004 * (effectiveEntry * shares + effectiveStop * shares);
    riskUsd = Math.abs(grossStop - stopFees);
  }
  return { pnl, fundingPaid, riskUsd: round(riskUsd) };
}
function markForNetPnl(row: any, targetPnl: number, ageHours: number) {
  const entry = Number(row.entry_price);
  if (!(entry > 0)) return null;
  let low = entry * 0.5;
  let high = entry * 1.5;
  for (let index = 0; index < 48; index++) {
    const mid = (low + high) / 2;
    const pnl = markEconomics(row, mid, ageHours).pnl;
    if (row.outcome === 'LONG') {
      if (pnl < targetPnl) low = mid; else high = mid;
    } else {
      if (pnl > targetPnl) low = mid; else high = mid;
    }
  }
  const result = (low + high) / 2;
  return Number.isFinite(result) && result > 0 ? round(result, 8) : null;
}
function ratchetStopIsTighter(row: any, nextStop: number | null) {
  if (!(nextStop && nextStop > 0)) return false;
  const current = Number(row.stop_price);
  if (!(current > 0)) return true;
  return row.outcome === 'LONG' ? nextStop > current : nextStop < current;
}

function summarize(rows: any[]) {
  const closed = rows.filter((row) => row.status === 'closed' && Number.isFinite(Number(row.pnl)));
  const pnl = closed.map((row) => Number(row.pnl));
  const wins = pnl.filter((value) => value > 0);
  const losses = pnl.filter((value) => value < 0);
  const grossProfit = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  const realizedPnl = pnl.reduce((sum, value) => sum + value, 0);
  const avgWin = wins.length ? grossProfit / wins.length : null;
  const avgLoss = losses.length ? grossLoss / losses.length : null;
  const expectancy = pnl.length ? realizedPnl / pnl.length : null;
  const pnlStd = std(pnl);
  const downside = pnl.filter((value) => value < 0);
  const downsideStd = std(downside);
  const tStat = pnl.length >= 2 && pnlStd > 0 && expectancy != null ? expectancy / (pnlStd / Math.sqrt(pnl.length)) : null;
  const sharpeProxy = pnlStd > 0 && expectancy != null ? expectancy / pnlStd : null;
  const sortinoProxy = downsideStd > 0 && expectancy != null ? expectancy / downsideStd : null;
  const ordered = [...closed].sort((a, b) => (Date.parse(a.closed_at ?? a.opened_at ?? '') || 0) - (Date.parse(b.closed_at ?? b.opened_at ?? '') || 0));
  let curve = 0, peak = 0, maxDrawdown = 0, lossStreak = 0, maxLossStreak = 0;
  for (const trade of ordered) {
    const value = Number(trade.pnl);
    curve += value;
    peak = Math.max(peak, curve);
    maxDrawdown = Math.max(maxDrawdown, peak - curve);
    if (value < 0) { lossStreak += 1; maxLossStreak = Math.max(maxLossStreak, lossStreak); } else lossStreak = 0;
  }
  return {
    trades: rows.length, closed: closed.length, wins: wins.length, losses: losses.length,
    winRate: closed.length ? wins.length / closed.length : null,
    realizedPnl: round(realizedPnl), grossProfit: round(grossProfit), grossLoss: round(grossLoss),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 4) : null,
    expectancy: expectancy == null ? null : round(expectancy, 4), avgWin: avgWin == null ? null : round(avgWin),
    avgLoss: avgLoss == null ? null : round(avgLoss), payoffRatio: avgWin != null && avgLoss != null && avgLoss > 0 ? round(avgWin / avgLoss, 4) : null,
    maxDrawdown: round(maxDrawdown), maxDrawdownPct: null,
    sharpeProxy: sharpeProxy == null ? null : round(sharpeProxy, 4), sortinoProxy: sortinoProxy == null ? null : round(sortinoProxy, 4),
    tStat: tStat == null ? null : round(tStat, 4), maxLossStreak,
  };
}
function breakdown(rows: any[], field: 'entry_regime' | 'entry_session') {
  const groups: Record<string, any[]> = {};
  for (const row of rows) { const key = String(row[field] || 'UNATTRIBUTED'); (groups[key] ||= []).push(row); }
  return Object.fromEntries(Object.entries(groups).map(([key, sample]) => [key, summarize(sample)]));
}
function positiveRegimeCount(regimes: Record<string, any>) {
  return Object.values(regimes).filter((metric: any) => metric.closed >= 5 && metric.profitFactor != null && metric.profitFactor >= 1 && metric.expectancy != null && metric.expectancy > 0).length;
}

async function evidenceSnapshot(policy: any) {
  const rows = await rest(`trades?trade_type=in.(${FUTURES_TYPES.join(',')})&status=eq.closed&select=trade_type,pnl,opened_at,closed_at,strategy_version_id,entry_regime,entry_session,runner_version,status&order=closed_at.desc&limit=240`) || [];
  const familyProfiles: Record<string, any> = {};
  const versionProfiles: Record<string, any> = {};

  for (const profile of PROFILES) {
    const familyRows = rows.filter((row: any) => row.trade_type === profile.type);
    const versionRows = familyRows.filter((row: any) => row.strategy_version_id === profile.versionId);
    const family = summarize(familyRows);
    const version = summarize(versionRows);
    const allocationBaselineUsd = profile.margin * profile.pairs.length;
    family.maxDrawdownPct = allocationBaselineUsd > 0 ? round(family.maxDrawdown / allocationBaselineUsd, 4) : null;
    version.maxDrawdownPct = allocationBaselineUsd > 0 ? round(version.maxDrawdown / allocationBaselineUsd, 4) : null;
    family.allocationBaselineUsd = allocationBaselineUsd;
    version.allocationBaselineUsd = allocationBaselineUsd;
    const familyBlocked = family.closed >= Number(policy?.quarantine?.minClosed ?? 10)
      && family.profitFactor != null
      && family.profitFactor < Number(policy?.quarantine?.maxProfitFactor ?? 0.8)
      && (!policy?.quarantine?.requireNegativeExpectancy || (family.expectancy != null && family.expectancy < 0));

    familyProfiles[profile.id] = { ...family, blocked: familyBlocked };
    versionProfiles[profile.id] = {
      ...version,
      strategyVersionId: profile.versionId,
      regimeBreakdown: breakdown(versionRows, 'entry_regime'),
      sessionBreakdown: breakdown(versionRows, 'entry_session'),
    };
  }

  return {
    version: 5,
    source: 'family_protection_plus_version_clean_cohorts_adaptive_profit_ratchet',
    familyProfiles,
    versionProfiles,
    blockedProfiles: Object.entries(familyProfiles).filter(([, value]: any) => value.blocked).map(([id]) => id),
  };
}

function evaluateLifecycle(profile: typeof PROFILES[number], family: any, version: any, policy: any, research: any) {
  const q = policy?.quarantine ?? DEFAULT_POLICY.quarantine;
  const validating = policy?.validating ?? DEFAULT_POLICY.validating;
  const validated = policy?.validated ?? DEFAULT_POLICY.validated;
  const gates: any[] = [];

  const familyRiskPass = family?.blocked !== true;
  gates.push({ code: 'FAMILY_RISK', pass: familyRiskPass, detail: familyRiskPass ? 'family evidence not quarantined' : `family PF=${family?.profitFactor ?? 'NA'} EV=${family?.expectancy ?? 'NA'}` });

  if (!familyRiskPass) {
    return { status: 'QUARANTINED', capitalEligible: false, gates, reason: 'Inherited family evidence is materially negative; new entries blocked.' };
  }

  const researchMatches = research?.strategyVersionId === profile.versionId;
  const researchOosTrades = Number(research?.oos?.trades ?? 0);
  const researchForwardTrades = Number(research?.walkForward?.forwardTrades ?? 0);
  const researchSufficient = researchMatches && researchOosTrades >= 8 && researchForwardTrades >= 12;
  const researchHardFail = researchSufficient && research?.status === 'FAIL';
  gates.push({
    code: 'RESEARCH_VETO',
    pass: !researchHardFail,
    detail: !researchMatches ? 'no matching research evidence' : `${research?.status ?? 'UNKNOWN'} · OOS N=${researchOosTrades} · FWD N=${researchForwardTrades}`,
  });
  if (researchHardFail) {
    return { status: 'QUARANTINED', capitalEligible: false, gates, reason: 'Historical OOS / rolling-forward research rejected this exact version; new paper entries blocked.' };
  }

  const closed = Number(version?.closed ?? 0);
  const pf = version?.profitFactor;
  const ev = version?.expectancy;
  const wr = version?.winRate;
  const tStat = version?.tStat;
  const ddPct = version?.maxDrawdownPct;
  const positiveRegimes = positiveRegimeCount(version?.regimeBreakdown ?? {});

  const validationGates = [
    { code: 'SAMPLE', pass: closed >= Number(validated.minClosed), detail: `${closed}/${validated.minClosed}` },
    { code: 'PROFIT_FACTOR', pass: pf != null && pf >= Number(validated.minProfitFactor), detail: `PF=${pf ?? 'NA'} need>=${validated.minProfitFactor}` },
    { code: 'EXPECTANCY', pass: ev != null && ev > Number(validated.minExpectancy), detail: `EV=${ev ?? 'NA'} need>${validated.minExpectancy}` },
    { code: 'WIN_RATE', pass: wr != null && wr >= Number(validated.minWinRate), detail: `WR=${wr ?? 'NA'} need>=${validated.minWinRate}` },
    { code: 'TSTAT', pass: tStat != null && tStat >= Number(validated.minTStat), detail: `t=${tStat ?? 'NA'} need>=${validated.minTStat}` },
    { code: 'DRAWDOWN_PCT', pass: ddPct != null && ddPct <= Number(validated.maxDrawdownPct), detail: ddPct == null ? 'allocation baseline not reconciled' : `DD=${ddPct}` },
    { code: 'REGIME_BREADTH', pass: positiveRegimes >= Number(validated.minPositiveRegimes), detail: `${positiveRegimes}/${validated.minPositiveRegimes} positive regimes` },
    {
      code: 'WALK_FORWARD',
      pass: validated.requireWalkForward !== true || (researchMatches && research?.walkForward?.pass === true),
      detail: validated.requireWalkForward
        ? (researchMatches ? `${research?.walkForward?.positiveFolds ?? 0}/${research?.walkForward?.requiredPositiveFolds ?? 2} positive forward folds` : 'matching research evidence unavailable')
        : 'not required',
    },
    {
      code: 'OOS',
      pass: validated.requireOos !== true || (researchMatches && research?.oos?.pass === true),
      detail: validated.requireOos
        ? (researchMatches ? `OOS N=${researchOosTrades} PF=${research?.oos?.profitFactor ?? 'NA'} EV=${research?.oos?.expectancy ?? 'NA'}` : 'matching research evidence unavailable')
        : 'not required',
    },
  ];
  gates.push(...validationGates);

  const canValidate = validationGates.every((gate) => gate.pass);
  if (canValidate) {
    return {
      status: 'VALIDATED',
      capitalEligible: false,
      gates,
      reason: 'Quant gates passed, but capital eligibility remains founder-controlled and LIVE_LOCKED.',
    };
  }

  const validatingPass = closed >= Number(validating.minClosed)
    && pf != null && pf >= Number(validating.minProfitFactor)
    && ev != null && ev > Number(validating.minExpectancy);

  if (validatingPass) {
    return { status: 'VALIDATING', capitalEligible: false, gates, reason: 'Positive clean cohort; accumulating institutional OOS/walk-forward evidence.' };
  }

  if (closed < Number(q.minClosed)) {
    return { status: 'EXPERIMENT', capitalEligible: false, gates, reason: `Clean ${profile.versionId} sample ${closed}/${q.minClosed}.` };
  }

  const versionBad = pf != null && pf < Number(q.maxProfitFactor)
    && (!q.requireNegativeExpectancy || (ev != null && ev < 0));
  if (versionBad) {
    return { status: 'QUARANTINED', capitalEligible: false, gates, reason: `${profile.versionId} cohort negative: PF=${pf}, EV=${ev}.` };
  }

  return { status: 'PAPER', capitalEligible: false, gates, reason: 'Paper cohort accumulating evidence.' };
}

async function persistValidation(evidence: any, policy: any, researchEvidence: any) {
  const ids = PROFILES.map((profile) => profile.versionId);
  const latestRows = await rest(`strategy_validation_snapshots?strategy_version_id=in.(${ids.map(encodeURIComponent).join(',')})&select=strategy_version_id,sample_closed,verdict,evaluated_at&order=evaluated_at.desc&limit=24`) || [];
  const latestByVersion = new Map<string, any>();
  for (const row of latestRows) {
    if (!latestByVersion.has(row.strategy_version_id)) latestByVersion.set(row.strategy_version_id, row);
  }

  const validations: Record<string, any> = {};
  const snapshots: any[] = [];

  for (const profile of PROFILES) {
    const family = evidence.familyProfiles[profile.id];
    const version = evidence.versionProfiles[profile.id];
    const research = researchEvidence?.profiles?.[profile.id] ?? null;
    const verdict = evaluateLifecycle(profile, family, version, policy, research);
    validations[profile.id] = {
      profileId: profile.id,
      strategyId: profile.strategyId,
      strategyVersionId: profile.versionId,
      runnerVersion: RUNNER_VERSION,
      exitPolicyVersion: profile.exitPolicyVersion,
      ...verdict,
      metrics: version,
    };

    await rest(`strategy_versions?id=eq.${encodeURIComponent(profile.versionId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: verdict.status, updated_at: nowIso() }),
    });

    const latest = latestByVersion.get(profile.versionId);
    if (!latest || Number(latest.sample_closed) !== Number(version.closed) || latest.verdict !== verdict.status) {
      snapshots.push({
        strategy_version_id: profile.versionId,
        sample_closed: version.closed,
        wins: version.wins,
        losses: version.losses,
        win_rate: version.winRate,
        realized_pnl: version.realizedPnl,
        gross_profit: version.grossProfit,
        gross_loss: version.grossLoss,
        profit_factor: version.profitFactor,
        expectancy: version.expectancy,
        avg_win: version.avgWin,
        avg_loss: version.avgLoss,
        payoff_ratio: version.payoffRatio,
        max_drawdown_usd: version.maxDrawdown,
        max_drawdown_pct: version.maxDrawdownPct,
        sharpe_proxy: version.sharpeProxy,
        sortino_proxy: version.sortinoProxy,
        t_stat: version.tStat,
        max_loss_streak: version.maxLossStreak,
        regime_breakdown: version.regimeBreakdown,
        session_breakdown: version.sessionBreakdown,
        walk_forward: research?.walkForward ?? null,
        oos_evidence: research?.oos ?? null,
        gates: verdict.gates,
        verdict: verdict.status,
        reason: verdict.reason,
        policy_version: policy.version ?? DEFAULT_POLICY.version,
        runner_version: RUNNER_VERSION,
      });
    }
  }

  if (snapshots.length) {
    await rest('strategy_validation_snapshots', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(snapshots),
    });
  }

  const runtime = {
    ok: true,
    engineVersion: 'qve_v1.4',
    runnerVersion: RUNNER_VERSION,
    exitPolicyVersion: SHORT_EXIT_POLICY.version,
    policy,
    validations,
    familyEvidence: evidence.familyProfiles,
    blockedProfiles: evidence.blockedProfiles,
    researchEvidence: researchEvidence ?? null,
    evaluatedAt: nowIso(),
  };
  await writeState(RUNTIME_KEY, runtime);
  return runtime;
}

async function closePositions(rows: any[]) {
  const closed: any[] = [];
  const state = await readState(PROFIT_RATCHET_KEY);
  const ratchets: Record<string, any> = state.value && typeof state.value === 'object' ? { ...state.value } : {};
  const openIds = new Set(rows.map((row: any) => String(row.id)));
  for (const id of Object.keys(ratchets)) if (!openIds.has(id)) delete ratchets[id];

  for (const row of rows) {
    const mark = await fetchPrice(row.asset_pair);
    if (!mark) continue;
    const ageHours = Math.max(0, (Date.now() - Date.parse(row.opened_at)) / 3_600_000);
    const markState = markEconomics(row, mark, ageHours);
    const isV9Short = row.outcome === 'SHORT' && String(row.strategy_version_id || '').endsWith(':v9');
    const existingRatchet = ratchets[row.id] ?? null;
    let reason: string | null = null;

    if (row.outcome === 'LONG' && row.target_price && mark >= Number(row.target_price)) reason = 'take_profit';
    if (row.outcome === 'LONG' && row.stop_price && mark <= Number(row.stop_price)) reason = existingRatchet?.floorUsd > 0 ? 'profit_ratchet_stop' : 'stop_loss';
    if (row.outcome === 'SHORT' && row.target_price && mark <= Number(row.target_price)) reason = 'take_profit';
    if (row.outcome === 'SHORT' && row.stop_price && mark >= Number(row.stop_price)) reason = existingRatchet?.floorUsd > 0 ? 'profit_ratchet_stop' : 'stop_loss';

    let ratchetSnapshot: any = existingRatchet;
    if (!reason && isV9Short) {
      const profile = profileForTradeType(row.trade_type);
      const marketRows = profile ? await fetchKlines(row.asset_pair, profile.tf) : null;
      const depth = marketRows ? await fetchDepth(row.asset_pair) : null;
      const context = marketRows ? exitContext(row.outcome, marketRows, depth) : {
        strength: 'NEUTRAL', score: 1, regime: 'UNKNOWN', momentum20: null, volRatio: null,
        orderBookImbalance: null, atrPct: 0, orderBookSource: 'unavailable',
      };
      const previousMfe = Number(existingRatchet?.mfeUsd || 0);
      const previousFloor = Number(existingRatchet?.floorUsd || 0);
      const mfeUsd = round(Math.max(previousMfe, markState.pnl));
      const notionalUsd = Number(row.notional_usd || 0);
      const candidateFloor = adaptiveProfitFloor(mfeUsd, context as any, notionalUsd);
      const floorUsd = round(Math.max(previousFloor, candidateFloor));
      const active = mfeUsd >= SHORT_EXIT_POLICY.activationNetUsd && floorUsd > 0;
      const ratchetStopPrice = active ? markForNetPnl(row, floorUsd, ageHours) : null;
      ratchetSnapshot = {
        tradeId: row.id,
        pair: row.asset_pair,
        side: row.outcome,
        strategyVersionId: row.strategy_version_id,
        runnerVersion: RUNNER_VERSION,
        exitPolicyVersion: SHORT_EXIT_POLICY.version,
        active,
        mfeUsd,
        floorUsd,
        ratchetStopPrice,
        currentNetPnlUsd: markState.pnl,
        context,
        updatedAt: nowIso(),
      };
      ratchets[row.id] = ratchetSnapshot;

      if (active && markState.pnl <= floorUsd) {
        reason = 'profit_ratchet';
      } else if (active && ratchetStopIsTighter(row, ratchetStopPrice)) {
        await rest(`trades?id=eq.${encodeURIComponent(row.id)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ stop_price: ratchetStopPrice }),
        });
        row.stop_price = ratchetStopPrice;
      }

      const timeoutHours = timeoutHoursFor(row.trade_type);
      const ageFraction = timeoutHours > 0 ? ageHours / timeoutHours : 0;
      if (!reason && !active && markState.pnl > 0 && ageFraction >= SHORT_EXIT_POLICY.timedProfitAfterFraction) {
        reason = 'timed_profit_capture';
      }
    }

    if (!reason && ageHours >= timeoutHoursFor(row.trade_type)) reason = 'timeout';
    if (!reason) continue;

    await rest(`trades?id=eq.${encodeURIComponent(row.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'closed', exit_price: mark, pnl: markState.pnl, closed_at: nowIso(), exit_reason: reason, funding_paid: markState.fundingPaid }),
    });
    delete ratchets[row.id];
    closed.push({
      id: row.id,
      pair: row.asset_pair,
      side: row.outcome,
      reason,
      pnl: markState.pnl,
      mark: round(mark, 6),
      riskUsd: markState.riskUsd,
      mfeUsd: ratchetSnapshot?.mfeUsd ?? null,
      protectedFloorUsd: ratchetSnapshot?.floorUsd ?? null,
      exitContext: ratchetSnapshot?.context ?? null,
      strategyVersionId: row.strategy_version_id ?? null,
      runnerVersion: row.runner_version ?? null,
      exitPolicyVersion: String(row.strategy_version_id || '').endsWith(':v9') ? SHORT_EXIT_POLICY.version : 'legacy_fixed_tp',
    });
  }
  await writeState(PROFIT_RATCHET_KEY, ratchets);
  return { closed, ratchets };
}

async function openPaperPosition(profile: typeof PROFILES[number], pair: string, side: string, price: number, volumeUsd: number, reason: string, context: ReturnType<typeof classifyMarketContext>, validationStatus: string) {
  const econ = economics(profile, side, price, volumeUsd);
  if (econ.shares <= 0) return { opened: false, reason: 'size_too_small' };
  if (econ.tpNet < MIN_EXPECTED_NET_USD) return { opened: false, reason: 'expected_net_too_low', tpNet: round(econ.tpNet), rr: round(econ.rr, 2) };
  if (econ.rr < MIN_REWARD_RISK) return { opened: false, reason: 'reward_risk_too_low', tpNet: round(econ.tpNet), rr: round(econ.rr, 2) };
  const id = `edge-futures-${profile.id}-${pair}-${Date.now()}`;
  await rest('trades', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      id, agent_id: `hosted-${profile.id}-${RUNNER_VERSION}`, market_id: `binance-futures:${pair}`, market_source: 'binance_futures_paper', market_question: `${side} ${pair} paper futures breakout`, market_category: 'crypto_futures', outcome: side,
      entry_price: round(econ.entry, 8), shares: econ.shares, capital_used: profile.margin, confidence: 0.75,
      reason: `Hosted paper runner ${RUNNER_VERSION}: ${reason}`,
      evidence: JSON.stringify([reason, `DONCHIAN${profile.period}`, 'SMA55', 'HOSTED_PAPER', `RUNNER_${RUNNER_VERSION.toUpperCase()}`, `REGIME_${context.regime}`, `SESSION_${context.session}`, `STRATEGY_VERSION_${profile.versionId}`, `EXIT_POLICY_${profile.exitPolicyVersion.toUpperCase()}`]),
      status: 'open', opened_at: nowIso(), days_to_close: 1, asset_pair: pair, trade_type: profile.type, target_price: round(econ.target, 8), stop_price: round(econ.stop, 8), entry_volume24h: volumeUsd,
      instrument_type: 'futures', exchange: 'binance', margin_mode: 'isolated', leverage: profile.leverage, notional_usd: round(econ.notional), funding_rate: 0.0001, liquidation_price: null, maintenance_margin: round(econ.notional * 0.005), mode: 'paper',
      strategy_version_id: profile.versionId, entry_regime: context.regime, entry_session: context.session, runner_version: RUNNER_VERSION, validation_status: validationStatus,
    }),
  });
  return {
    opened: true,
    tradeId: id,
    entry: round(econ.entry, 8),
    target: round(econ.target, 8),
    stop: round(econ.stop, 8),
    tpNet: round(econ.tpNet),
    rr: round(econ.rr, 2),
    runnerVersion: RUNNER_VERSION,
    strategyVersionId: profile.versionId,
    exitPolicyVersion: profile.exitPolicyVersion,
    regime: context.regime,
    session: context.session,
    validationStatus,
  };
}

async function logCycle(metadata: Record<string, unknown>) {
  try {
    await rest('operator_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ id: crypto.randomUUID(), ts: nowIso(), category: 'SCAN', severity: 'info', subsystem: 'supabase_futures_runner', reason: `HOSTED FUTURES PAPER TICK ${RUNNER_VERSION}`, metadata: JSON.stringify(metadata) }) });
  } catch { /* observability must never break runner */ }
}

async function tick() {
  const heartbeat = await readState('external_runner_heartbeat');
  const previous: any = heartbeat.value;
  const previousAt = previous?.lastTickAt ? Date.parse(previous.lastTickAt) : 0;
  if (previousAt && Date.now() - previousAt < MIN_INTERVAL_MS) return { ok: true, mode: 'throttled', paperOnly: true, liveOrders: false, runnerVersion: RUNNER_VERSION, exitPolicyVersion: SHORT_EXIT_POLICY.version, lastTickAt: previous.lastTickAt };
  const startedAt = nowIso();
  const beforeClose = await openRows();
  const closeResult = await closePositions(beforeClose);
  const closedPositions = closeResult.closed;
  const currentOpen = await openRows();
  const openKeys = new Set(currentOpen.map((row: any) => `${row.trade_type}:${row.asset_pair}`));
  const policy = await loadPolicy();
  await ensureStrategyVersions();
  const evidence = await evidenceSnapshot(policy);
  const researchState = await readState(RESEARCH_KEY);
  const researchEvidence: any = researchState.value && typeof researchState.value === 'object' ? researchState.value : null;
  const validationEngine = await persistValidation(evidence, policy, researchEvidence);
  let openCount = currentOpen.length, scanned = 0, qualified = 0, executed = 0, skipped = 0;
  const decisions: any[] = [];
  for (const profile of PROFILES) {
    const validation = validationEngine.validations[profile.id];
    for (const pair of profile.pairs) {
      scanned++;
      if (validation?.status === 'QUARANTINED') { skipped++; decisions.push({ profile: profile.id, strategyVersionId: profile.versionId, pair, status: 'skip', reason: 'validation_quarantine', validationStatus: validation.status, familyProfitFactor: evidence.familyProfiles[profile.id]?.profitFactor ?? null, familyExpectancy: evidence.familyProfiles[profile.id]?.expectancy ?? null }); continue; }
      if (openCount >= MAX_OPEN_POSITIONS) { skipped++; decisions.push({ profile: profile.id, strategyVersionId: profile.versionId, pair, status: 'skip', reason: 'max_open_positions', validationStatus: validation?.status ?? 'UNKNOWN' }); continue; }
      if (openKeys.has(`${profile.type}:${pair}`)) { skipped++; decisions.push({ profile: profile.id, strategyVersionId: profile.versionId, pair, status: 'skip', reason: 'position_open', validationStatus: validation?.status ?? 'UNKNOWN' }); continue; }
      try {
        const rows = await fetchKlines(pair, profile.tf), context = classifyMarketContext(rows), sig = signal(rows, profile.period, profile.lane);
        if (!sig.go || !('side' in sig)) { skipped++; decisions.push({ profile: profile.id, strategyVersionId: profile.versionId, pair, status: 'skip', reason: sig.reason, regime: context.regime, session: context.session, validationStatus: validation?.status ?? 'UNKNOWN' }); continue; }
        qualified++;
        const price = await fetchPrice(pair);
        if (!price) { skipped++; decisions.push({ profile: profile.id, strategyVersionId: profile.versionId, pair, status: 'skip', reason: 'price_unavailable', validationStatus: validation?.status ?? 'UNKNOWN' }); continue; }
        const opened = await openPaperPosition(profile, pair, sig.side, price, quoteVolume(rows), sig.reason, context, validation?.status ?? 'UNKNOWN');
        if (opened.opened) { executed++; openCount++; openKeys.add(`${profile.type}:${pair}`); decisions.push({ profile: profile.id, pair, status: 'paper_open', side: sig.side, ...opened }); }
        else { skipped++; decisions.push({ profile: profile.id, strategyVersionId: profile.versionId, pair, status: 'skip', side: sig.side, regime: context.regime, session: context.session, validationStatus: validation?.status ?? 'UNKNOWN', ...opened }); }
      } catch (error) {
        skipped++; decisions.push({ profile: profile.id, strategyVersionId: profile.versionId, pair, status: 'skip', reason: error instanceof Error ? error.message : String(error), validationStatus: validation?.status ?? 'UNKNOWN' });
      }
    }
  }
  const completedAt = nowIso(), cyclePnl = round(closedPositions.reduce((sum, item) => sum + Number(item.pnl || 0), 0));
  const result = {
    ok: true, runnerVersion: RUNNER_VERSION, validationEngineVersion: 'qve_v1.4', exitPolicyVersion: SHORT_EXIT_POLICY.version, paperOnly: true, liveOrders: false,
    scanned, qualified, executed, skipped, closed: closedPositions.length, cyclePnl, openPositions: openCount, closedPositions,
    profitRatchets: Object.values(closeResult.ratchets).slice(-12),
    evidenceGuard: { version: evidence.version, source: evidence.source, blockedProfiles: evidence.blockedProfiles, familyProfiles: evidence.familyProfiles },
    validationEngine, decisions: decisions.slice(-24),
  };
  await writeState('external_runner_heartbeat', { source: 'supabase_futures_runner', runnerVersion: RUNNER_VERSION, validationEngineVersion: 'qve_v1.4', exitPolicyVersion: SHORT_EXIT_POLICY.version, lastTickAt: completedAt, totalCycles: Number(previous?.totalCycles || 0) + 1, claudeEnabled: false, paperOnly: true, liveOrders: false, lastResult: result });
  const historyState = await readState('futures_cycle_history');
  const history = Array.isArray(historyState.value) ? historyState.value : [];
  await writeState('futures_cycle_history', [...history, { ...result, startedAt, completedAt }].slice(-80));
  await logCycle({ runnerVersion: RUNNER_VERSION, validationEngineVersion: 'qve_v1.4', exitPolicyVersion: SHORT_EXIT_POLICY.version, scanned, qualified, executed, skipped, closed: closedPositions.length, cyclePnl, openPositions: openCount, activeRatchets: Object.keys(closeResult.ratchets).length, blockedProfiles: evidence.blockedProfiles, lifecycle: Object.fromEntries(Object.entries(validationEngine.validations).map(([id, value]: any) => [id, value.status])) });
  return { ...result, mode: 'executed', lastTickAt: completedAt };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (!['GET', 'POST'].includes(req.method)) return json({ ok: false, error: 'method_not_allowed' }, 405);
  if (!await authorized(req)) return json({ ok: false, error: 'runner_auth_invalid' }, 403);
  try { return json(await tick()); }
  catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : 'runner_failed', paperOnly: true, liveOrders: false, runnerVersion: RUNNER_VERSION, validationEngineVersion: 'qve_v1.4', exitPolicyVersion: SHORT_EXIT_POLICY.version }, 500); }
});
