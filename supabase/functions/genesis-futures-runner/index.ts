const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
const BINANCE_BASE = Deno.env.get('BINANCE_BASE') || 'https://data-api.binance.vision/api/v3';
const RUNNER_TOKEN_SHA256 = 'e9f02987e836a6eaf8ef8d7afaed805580cd31264aef5ed86fc3ebb756c59d91';
const RUNNER_VERSION = 'v8.1';
const POLICY_KEY = 'quant_validation_policy_v1';
const RUNTIME_KEY = 'quant_validation_runtime_v1';
const RESEARCH_KEY = 'quant_research_evidence_v1';
const MIN_INTERVAL_MS = 4 * 60 * 1000;
const MAX_OPEN_POSITIONS = 6;
const MIN_EXPECTED_NET_USD = 18;
const MIN_REWARD_RISK = 1.8;

const FUTURES_TYPES = [
  'crypto_futures_breakout_short_micro',
  'crypto_futures_breakout_short',
  'crypto_futures_breakout_short_alt',
  'crypto_futures_breakout_long',
] as const;

const PROFILES = [
  { id: 'short_micro', strategyId: 'futures_breakout_short_micro', versionId: 'futures_breakout_short_micro:v8', type: FUTURES_TYPES[0], pairs: ['BTCUSDT', 'ETHUSDT'], tf: '5m', lane: 'SHORT', period: 20, margin: 150, leverage: 3, timeoutHours: 2 },
  { id: 'short_core', strategyId: 'futures_breakout_short_core', versionId: 'futures_breakout_short_core:v8', type: FUTURES_TYPES[1], pairs: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'], tf: '1h', lane: 'SHORT', period: 34, margin: 250, leverage: 5, timeoutHours: 4 },
  { id: 'short_alt', strategyId: 'futures_breakout_short_alt', versionId: 'futures_breakout_short_alt:v8', type: FUTURES_TYPES[2], pairs: ['XRPUSDT', 'DOGEUSDT'], tf: '15m', lane: 'SHORT', period: 12, margin: 200, leverage: 3, timeoutHours: 3 },
  { id: 'long_probe', strategyId: 'futures_breakout_long_probe', versionId: 'futures_breakout_long_probe:v8', type: FUTURES_TYPES[3], pairs: ['BTCUSDT', 'ETHUSDT'], tf: '4h', lane: 'LONG', period: 55, margin: 220, leverage: 3, timeoutHours: 6 },
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
  const target = side === 'LONG' ? entry * 1.12 : entry * 0.88;
  const stop = side === 'LONG' ? entry * 0.97 : entry * 1.03;
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
    version: 2,
    source: 'family_protection_plus_version_clean_cohorts',
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
    return { status: 'EXPERIMENT', capitalEligible: false, gates, reason: `Clean v8 sample ${closed}/${q.minClosed}.` };
  }

  const versionBad = pf != null && pf < Number(q.maxProfitFactor)
    && (!q.requireNegativeExpectancy || (ev != null && ev < 0));
  if (versionBad) {
    return { status: 'QUARANTINED', capitalEligible: false, gates, reason: `v8 cohort negative: PF=${pf}, EV=${ev}.` };
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
    engineVersion: 'qve_v1.1',
    runnerVersion: RUNNER_VERSION,
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
  for (const row of rows) {
    const mark = await fetchPrice(row.asset_pair);
    if (!mark) continue;
    const ageHours = Math.max(0, (Date.now() - Date.parse(row.opened_at)) / 3_600_000);
    let reason: string | null = null;
    if (row.outcome === 'LONG' && row.target_price && mark >= Number(row.target_price)) reason = 'take_profit';
    if (row.outcome === 'LONG' && row.stop_price && mark <= Number(row.stop_price)) reason = 'stop_loss';
    if (row.outcome === 'SHORT' && row.target_price && mark <= Number(row.target_price)) reason = 'take_profit';
    if (row.outcome === 'SHORT' && row.stop_price && mark >= Number(row.stop_price)) reason = 'stop_loss';
    if (!reason && ageHours >= timeoutHoursFor(row.trade_type)) reason = 'timeout';
    if (!reason) continue;
    const entry = Number(row.entry_price), shares = Number(row.shares), notional = Number(row.notional_usd || entry * shares), volumeUsd = Number(row.entry_volume24h || 0);
    const slip = slippagePct(notional, volumeUsd), effectiveEntry = row.outcome === 'LONG' ? entry * (1 + slip) : entry * (1 - slip), effectiveExit = row.outcome === 'LONG' ? mark * (1 - slip) : mark * (1 + slip);
    const gross = row.outcome === 'LONG' ? (effectiveExit - effectiveEntry) * shares : (effectiveEntry - effectiveExit) * shares;
    const fees = 0.0004 * (effectiveEntry * shares + effectiveExit * shares), fundingRate = Number(row.funding_rate || 0.0001), fundingPaid = notional * fundingRate * Math.max(1, ageHours) / 8;
    const pnl = round(gross - fees - fundingPaid);
    await rest(`trades?id=eq.${encodeURIComponent(row.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'closed', exit_price: mark, pnl, closed_at: nowIso(), exit_reason: reason, funding_paid: fundingPaid }) });
    closed.push({ id: row.id, pair: row.asset_pair, side: row.outcome, reason, pnl, mark: round(mark, 6), strategyVersionId: row.strategy_version_id ?? null });
  }
  return closed;
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
      evidence: JSON.stringify([reason, `DONCHIAN${profile.period}`, 'SMA55', 'HOSTED_PAPER', `RUNNER_${RUNNER_VERSION.toUpperCase()}`, `REGIME_${context.regime}`, `SESSION_${context.session}`, `STRATEGY_VERSION_${profile.versionId}`]),
      status: 'open', opened_at: nowIso(), days_to_close: 1, asset_pair: pair, trade_type: profile.type, target_price: round(econ.target, 8), stop_price: round(econ.stop, 8), entry_volume24h: volumeUsd,
      instrument_type: 'futures', exchange: 'binance', margin_mode: 'isolated', leverage: profile.leverage, notional_usd: round(econ.notional), funding_rate: 0.0001, liquidation_price: null, maintenance_margin: round(econ.notional * 0.005), mode: 'paper',
      strategy_version_id: profile.versionId, entry_regime: context.regime, entry_session: context.session, runner_version: RUNNER_VERSION, validation_status: validationStatus,
    }),
  });
  return { opened: true, tradeId: id, entry: round(econ.entry, 8), target: round(econ.target, 8), stop: round(econ.stop, 8), tpNet: round(econ.tpNet), rr: round(econ.rr, 2), runnerVersion: RUNNER_VERSION, strategyVersionId: profile.versionId, regime: context.regime, session: context.session, validationStatus };
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
  if (previousAt && Date.now() - previousAt < MIN_INTERVAL_MS) return { ok: true, mode: 'throttled', paperOnly: true, liveOrders: false, runnerVersion: RUNNER_VERSION, lastTickAt: previous.lastTickAt };
  const startedAt = nowIso();
  const beforeClose = await openRows();
  const closedPositions = await closePositions(beforeClose);
  const currentOpen = await openRows();
  const openKeys = new Set(currentOpen.map((row: any) => `${row.trade_type}:${row.asset_pair}`));
  const policy = await loadPolicy();
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
    ok: true, runnerVersion: RUNNER_VERSION, validationEngineVersion: 'qve_v1.1', paperOnly: true, liveOrders: false,
    scanned, qualified, executed, skipped, closed: closedPositions.length, cyclePnl, openPositions: openCount, closedPositions,
    evidenceGuard: { version: evidence.version, source: evidence.source, blockedProfiles: evidence.blockedProfiles, familyProfiles: evidence.familyProfiles },
    validationEngine, decisions: decisions.slice(-24),
  };
  await writeState('external_runner_heartbeat', { source: 'supabase_futures_runner', runnerVersion: RUNNER_VERSION, validationEngineVersion: 'qve_v1.1', lastTickAt: completedAt, totalCycles: Number(previous?.totalCycles || 0) + 1, claudeEnabled: false, paperOnly: true, liveOrders: false, lastResult: result });
  const historyState = await readState('futures_cycle_history');
  const history = Array.isArray(historyState.value) ? historyState.value : [];
  await writeState('futures_cycle_history', [...history, { ...result, startedAt, completedAt }].slice(-80));
  await logCycle({ runnerVersion: RUNNER_VERSION, validationEngineVersion: 'qve_v1.1', scanned, qualified, executed, skipped, closed: closedPositions.length, cyclePnl, openPositions: openCount, blockedProfiles: evidence.blockedProfiles, lifecycle: Object.fromEntries(Object.entries(validationEngine.validations).map(([id, value]: any) => [id, value.status])) });
  return { ...result, mode: 'executed', lastTickAt: completedAt };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (!['GET', 'POST'].includes(req.method)) return json({ ok: false, error: 'method_not_allowed' }, 405);
  if (!await authorized(req)) return json({ ok: false, error: 'runner_auth_invalid' }, 403);
  try { return json(await tick()); }
  catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : 'runner_failed', paperOnly: true, liveOrders: false, runnerVersion: RUNNER_VERSION, validationEngineVersion: 'qve_v1.1' }, 500); }
});
