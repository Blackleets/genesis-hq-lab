const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
const BINANCE_BASE = Deno.env.get('BINANCE_BASE') || 'https://data-api.binance.vision/api/v3';
const RUNNER_TOKEN_SHA256 = 'e9f02987e836a6eaf8ef8d7afaed805580cd31264aef5ed86fc3ebb756c59d91';
const RUNNER_VERSION = 'v7';
const MIN_INTERVAL_MS = 4 * 60 * 1000;
const MAX_OPEN_POSITIONS = 6;
const MIN_EXPECTED_NET_USD = 18;
const MIN_REWARD_RISK = 1.8;
const EVIDENCE_MIN_CLOSED = 10;
const EVIDENCE_MAX_BAD_PROFIT_FACTOR = 0.8;

const FUTURES_TYPES = [
  'crypto_futures_breakout_short_micro',
  'crypto_futures_breakout_short',
  'crypto_futures_breakout_short_alt',
  'crypto_futures_breakout_long',
] as const;

const PROFILES = [
  { id: 'short_micro', type: FUTURES_TYPES[0], pairs: ['BTCUSDT', 'ETHUSDT'], tf: '5m', lane: 'SHORT', period: 20, margin: 150, leverage: 3, timeoutHours: 2 },
  { id: 'short_core', type: FUTURES_TYPES[1], pairs: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'], tf: '1h', lane: 'SHORT', period: 34, margin: 250, leverage: 5, timeoutHours: 4 },
  { id: 'short_alt', type: FUTURES_TYPES[2], pairs: ['XRPUSDT', 'DOGEUSDT'], tf: '15m', lane: 'SHORT', period: 12, margin: 200, leverage: 3, timeoutHours: 3 },
  { id: 'long_probe', type: FUTURES_TYPES[3], pairs: ['BTCUSDT', 'ETHUSDT'], tf: '4h', lane: 'LONG', period: 55, margin: 220, leverage: 3, timeoutHours: 6 },
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
function round(value: number, decimals = 3) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
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
  const sma55 = closes.slice(-55).reduce((sum, value) => sum + value, 0) / 55;
  const side = last > high ? 'LONG' : last < low ? 'SHORT' : null;
  if (!side) return { go: false, reason: 'inside_channel' };
  if (side !== lane) return { go: false, reason: 'lane_filter' };
  if ((side === 'LONG' && last <= sma55) || (side === 'SHORT' && last >= sma55)) return { go: false, reason: 'regime_filter' };
  return { go: true, side, reason: `donchian_${side.toLowerCase()}_regime_aligned` };
}

function quoteVolume(rows: any[]) {
  return rows.slice(-6).reduce((sum, row) => sum + (Number(row?.[7]) || 0), 0);
}

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
  return await rest(`trades?trade_type=in.(${FUTURES_TYPES.join(',')})&status=eq.open&select=id,trade_type,asset_pair,outcome,entry_price,shares,target_price,stop_price,opened_at,notional_usd,entry_volume24h,funding_rate&limit=100`) || [];
}

function timeoutHoursFor(tradeType: string) {
  return PROFILES.find((profile) => profile.type === tradeType)?.timeoutHours ?? 6;
}

async function evidenceSnapshot() {
  const rows = await rest(`trades?trade_type=in.(${FUTURES_TYPES.join(',')})&status=eq.closed&select=trade_type,pnl,closed_at&order=closed_at.desc&limit=80`) || [];
  const profiles: Record<string, { closed: number; realizedPnl: number; profitFactor: number | null; expectancy: number | null; blocked: boolean }> = {};
  for (const profile of PROFILES) {
    const sample = rows.filter((row: any) => row.trade_type === profile.type && Number.isFinite(Number(row.pnl)));
    const pnl = sample.map((row: any) => Number(row.pnl));
    const grossProfit = pnl.filter((value: number) => value > 0).reduce((sum: number, value: number) => sum + value, 0);
    const grossLoss = Math.abs(pnl.filter((value: number) => value < 0).reduce((sum: number, value: number) => sum + value, 0));
    const realizedPnl = pnl.reduce((sum: number, value: number) => sum + value, 0);
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : null;
    const expectancy = sample.length ? realizedPnl / sample.length : null;
    const blocked = sample.length >= EVIDENCE_MIN_CLOSED && profitFactor !== null
      && profitFactor < EVIDENCE_MAX_BAD_PROFIT_FACTOR && expectancy !== null && expectancy < 0;
    profiles[profile.id] = {
      closed: sample.length,
      realizedPnl: round(realizedPnl),
      profitFactor: profitFactor == null ? null : round(profitFactor, 4),
      expectancy: expectancy == null ? null : round(expectancy, 4),
      blocked,
    };
  }
  return {
    version: 1,
    source: 'recent_closed_futures_sample',
    minClosed: EVIDENCE_MIN_CLOSED,
    maxBadProfitFactor: EVIDENCE_MAX_BAD_PROFIT_FACTOR,
    profiles,
    blockedProfiles: Object.entries(profiles).filter(([, value]) => value.blocked).map(([id]) => id),
  };
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

    const entry = Number(row.entry_price);
    const shares = Number(row.shares);
    const notional = Number(row.notional_usd || entry * shares);
    const volumeUsd = Number(row.entry_volume24h || 0);
    const slip = slippagePct(notional, volumeUsd);
    const effectiveEntry = row.outcome === 'LONG' ? entry * (1 + slip) : entry * (1 - slip);
    const effectiveExit = row.outcome === 'LONG' ? mark * (1 - slip) : mark * (1 + slip);
    const gross = row.outcome === 'LONG' ? (effectiveExit - effectiveEntry) * shares : (effectiveEntry - effectiveExit) * shares;
    const fees = 0.0004 * (effectiveEntry * shares + effectiveExit * shares);
    const fundingRate = Number(row.funding_rate || 0.0001);
    const fundingPaid = notional * fundingRate * Math.max(1, ageHours) / 8;
    const pnl = round(gross - fees - fundingPaid);

    await rest(`trades?id=eq.${encodeURIComponent(row.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'closed', exit_price: mark, pnl, closed_at: nowIso(), exit_reason: reason, funding_paid: fundingPaid }),
    });
    closed.push({ id: row.id, pair: row.asset_pair, side: row.outcome, reason, pnl, mark: round(mark, 6) });
  }
  return closed;
}

async function openPaperPosition(profile: typeof PROFILES[number], pair: string, side: string, price: number, volumeUsd: number, reason: string) {
  const econ = economics(profile, side, price, volumeUsd);
  if (econ.shares <= 0) return { opened: false, reason: 'size_too_small' };
  if (econ.tpNet < MIN_EXPECTED_NET_USD) return { opened: false, reason: 'expected_net_too_low', tpNet: round(econ.tpNet), rr: round(econ.rr, 2) };
  if (econ.rr < MIN_REWARD_RISK) return { opened: false, reason: 'reward_risk_too_low', tpNet: round(econ.tpNet), rr: round(econ.rr, 2) };

  const id = `edge-futures-${profile.id}-${pair}-${Date.now()}`;
  await rest('trades', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      id,
      agent_id: `hosted-${profile.id}-${RUNNER_VERSION}`,
      market_id: `binance-futures:${pair}`,
      market_source: 'binance_futures_paper',
      market_question: `${side} ${pair} paper futures breakout`,
      market_category: 'crypto_futures',
      outcome: side,
      entry_price: round(econ.entry, 8),
      shares: econ.shares,
      capital_used: profile.margin,
      confidence: 0.75,
      reason: `Hosted paper runner ${RUNNER_VERSION}: ${reason}`,
      evidence: JSON.stringify([reason, `DONCHIAN${profile.period}`, 'SMA55', 'HOSTED_PAPER', `RUNNER_${RUNNER_VERSION.toUpperCase()}`]),
      status: 'open',
      opened_at: nowIso(),
      days_to_close: 1,
      asset_pair: pair,
      trade_type: profile.type,
      target_price: round(econ.target, 8),
      stop_price: round(econ.stop, 8),
      entry_volume24h: volumeUsd,
      instrument_type: 'futures',
      exchange: 'binance',
      margin_mode: 'isolated',
      leverage: profile.leverage,
      notional_usd: round(econ.notional),
      funding_rate: 0.0001,
      liquidation_price: null,
      maintenance_margin: round(econ.notional * 0.005),
      mode: 'paper',
    }),
  });
  return { opened: true, tradeId: id, entry: round(econ.entry, 8), target: round(econ.target, 8), stop: round(econ.stop, 8), tpNet: round(econ.tpNet), rr: round(econ.rr, 2), runnerVersion: RUNNER_VERSION };
}

async function logCycle(metadata: Record<string, unknown>) {
  try {
    await rest('operator_events', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        id: crypto.randomUUID(), ts: nowIso(), category: 'SCAN', severity: 'info',
        subsystem: 'supabase_futures_runner', reason: `HOSTED FUTURES PAPER TICK ${RUNNER_VERSION}`, metadata: JSON.stringify(metadata),
      }),
    });
  } catch { /* observability must never break the runner */ }
}

async function tick() {
  const heartbeat = await readState('external_runner_heartbeat');
  const previous: any = heartbeat.value;
  const previousAt = previous?.lastTickAt ? Date.parse(previous.lastTickAt) : 0;
  if (previousAt && Date.now() - previousAt < MIN_INTERVAL_MS) {
    return { ok: true, mode: 'throttled', paperOnly: true, liveOrders: false, runnerVersion: RUNNER_VERSION, lastTickAt: previous.lastTickAt };
  }

  const startedAt = nowIso();
  const beforeClose = await openRows();
  const closedPositions = await closePositions(beforeClose);
  const currentOpen = await openRows();
  const openKeys = new Set(currentOpen.map((row: any) => `${row.trade_type}:${row.asset_pair}`));
  const evidenceGuard = await evidenceSnapshot();
  let openCount = currentOpen.length;
  let scanned = 0;
  let qualified = 0;
  let executed = 0;
  let skipped = 0;
  const decisions: any[] = [];

  for (const profile of PROFILES) {
    const evidence = evidenceGuard.profiles[profile.id];
    for (const pair of profile.pairs) {
      scanned++;
      if (evidence?.blocked) {
        skipped++;
        decisions.push({ profile: profile.id, pair, status: 'skip', reason: 'evidence_guard', closed: evidence.closed, profitFactor: evidence.profitFactor, expectancy: evidence.expectancy });
        continue;
      }
      if (openCount >= MAX_OPEN_POSITIONS) {
        skipped++;
        decisions.push({ profile: profile.id, pair, status: 'skip', reason: 'max_open_positions' });
        continue;
      }
      if (openKeys.has(`${profile.type}:${pair}`)) {
        skipped++;
        decisions.push({ profile: profile.id, pair, status: 'skip', reason: 'position_open' });
        continue;
      }
      try {
        const rows = await fetchKlines(pair, profile.tf);
        const sig = signal(rows, profile.period, profile.lane);
        if (!sig.go || !('side' in sig)) {
          skipped++;
          decisions.push({ profile: profile.id, pair, status: 'skip', reason: sig.reason });
          continue;
        }
        qualified++;
        const price = await fetchPrice(pair);
        if (!price) {
          skipped++;
          decisions.push({ profile: profile.id, pair, status: 'skip', reason: 'price_unavailable' });
          continue;
        }
        const opened = await openPaperPosition(profile, pair, sig.side, price, quoteVolume(rows), sig.reason);
        if (opened.opened) {
          executed++;
          openCount++;
          openKeys.add(`${profile.type}:${pair}`);
          decisions.push({ profile: profile.id, pair, status: 'paper_open', side: sig.side, ...opened });
        } else {
          skipped++;
          decisions.push({ profile: profile.id, pair, status: 'skip', side: sig.side, ...opened });
        }
      } catch (error) {
        skipped++;
        decisions.push({ profile: profile.id, pair, status: 'skip', reason: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  const completedAt = nowIso();
  const cyclePnl = round(closedPositions.reduce((sum, item) => sum + Number(item.pnl || 0), 0));
  const result = {
    ok: true,
    runnerVersion: RUNNER_VERSION,
    paperOnly: true,
    liveOrders: false,
    scanned,
    qualified,
    executed,
    skipped,
    closed: closedPositions.length,
    cyclePnl,
    openPositions: openCount,
    closedPositions,
    evidenceGuard,
    decisions: decisions.slice(-24),
  };

  await writeState('external_runner_heartbeat', {
    source: 'supabase_futures_runner',
    runnerVersion: RUNNER_VERSION,
    lastTickAt: completedAt,
    totalCycles: Number(previous?.totalCycles || 0) + 1,
    claudeEnabled: false,
    paperOnly: true,
    liveOrders: false,
    lastResult: result,
  });

  const historyState = await readState('futures_cycle_history');
  const history = Array.isArray(historyState.value) ? historyState.value : [];
  await writeState('futures_cycle_history', [...history, { ...result, startedAt, completedAt }].slice(-80));
  await logCycle({ runnerVersion: RUNNER_VERSION, scanned, qualified, executed, skipped, closed: closedPositions.length, cyclePnl, openPositions: openCount, blockedProfiles: evidenceGuard.blockedProfiles });

  return { ...result, mode: 'executed', lastTickAt: completedAt };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (!['GET', 'POST'].includes(req.method)) return json({ ok: false, error: 'method_not_allowed' }, 405);
  if (!await authorized(req)) return json({ ok: false, error: 'runner_auth_invalid' }, 403);
  try { return json(await tick()); }
  catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : 'runner_failed', paperOnly: true, liveOrders: false, runnerVersion: RUNNER_VERSION }, 500); }
});
