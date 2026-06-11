import { createClient } from "@supabase/supabase-js";

const FUTURES_TYPES = [
  "crypto_futures_breakout_short_micro",
  "crypto_futures_breakout_short",
  "crypto_futures_breakout_short_alt",
  "crypto_futures_breakout_long",
];
const BINANCE_BASE = Deno.env.get("BINANCE_BASE") || "https://data-api.binance.vision/api/v3";
const MIN_INTERVAL_MS = 4 * 60 * 1000;
const MAX_OPEN_POSITIONS = Number.parseInt(Deno.env.get("EDGE_RUNNER_MAX_OPEN_POSITIONS") ?? "6", 10);
const START_CAPITAL = Number.parseFloat(Deno.env.get("FUTURES_DESK_START_CAPITAL") ?? "10000");
const RUNNER_TOKEN = Deno.env.get("GENESIS_RUNNER_TOKEN")?.trim() ?? "";
const RUNNER_TOKEN_SHA256 = Deno.env.get("GENESIS_RUNNER_TOKEN_SHA256")?.trim()
  || "cb7babc91d08408bb16d6196cc38158ad7760fe4a1ddcd6d12a0590aa3ff4502";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY");
if (!supabaseUrl || !supabaseKey) throw new Error("supabase_env_missing");

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization,x-genesis-runner-token",
    },
  });
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sha256Hex(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function runnerAuth(req: Request) {
  if (!RUNNER_TOKEN && !RUNNER_TOKEN_SHA256) return { ok: false, status: 503, error: "runner_token_not_configured" };
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const headerToken = req.headers.get("x-genesis-runner-token")?.trim() ?? "";
  const supplied = headerToken || bearer;
  if (!supplied) return { ok: false, status: 401, error: "runner_auth_required" };
  const matchesRawToken = RUNNER_TOKEN ? timingSafeEqual(supplied, RUNNER_TOKEN) : false;
  const matchesHash = RUNNER_TOKEN_SHA256 ? timingSafeEqual(await sha256Hex(supplied), RUNNER_TOKEN_SHA256) : false;
  if (!matchesRawToken && !matchesHash) return { ok: false, status: 403, error: "runner_auth_invalid" };
  return { ok: true, status: 200, error: null };
}

function nowIso() {
  return new Date().toISOString();
}

function round(value: number | null | undefined, decimals = 2) {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

async function fetchRows(table: string, select: string, build?: (query: any) => any) {
  let query = supabase.from(table).select(select);
  if (build) query = build(query);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

async function writeOrgState(key: string, value: unknown) {
  const { error } = await supabase
    .from("org_state")
    .upsert({ key, value: JSON.stringify(value), updated_at: nowIso() }, { onConflict: "key" });
  if (error) throw error;
}

async function readHeartbeat() {
  const rows = await fetchRows("org_state", "value,updated_at", (q) => q.eq("key", "external_runner_heartbeat").limit(1));
  const row = rows[0] as any;
  const payload = parseJson<any>(row?.value, null);
  const lastTickAt = payload?.lastTickAt ?? null;
  const msSinceLastTick = lastTickAt ? Date.now() - new Date(lastTickAt).getTime() : null;
  return {
    source: payload?.source ?? "supabase_edge",
    lastTickAt,
    totalCycles: Number(payload?.totalCycles ?? 0),
    msSinceLastTick: Number.isFinite(msSinceLastTick) ? msSinceLastTick : null,
  };
}

async function writeHeartbeat(lastResult: Record<string, unknown>) {
  const current = await readHeartbeat();
  await writeOrgState("external_runner_heartbeat", {
    source: "supabase_edge",
    lastTickAt: nowIso(),
    totalCycles: current.totalCycles + 1,
    claudeEnabled: false,
    lastResult,
  });
}

async function logEvent(reason: string, metadata: Record<string, unknown>) {
  const { error } = await supabase.from("operator_events").insert({
    id: crypto.randomUUID(),
    ts: nowIso(),
    category: "SCAN",
    severity: "info",
    subsystem: "supabase_edge_futures_runner",
    reason,
    metadata: JSON.stringify(metadata),
  });
  if (error) throw error;
}

async function getCurrentPrice(pair: string) {
  const res = await fetch(`${BINANCE_BASE}/ticker/price?symbol=${encodeURIComponent(pair)}`, {
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) return null;
  const payload = await res.json();
  const price = Number.parseFloat(payload?.price);
  return Number.isFinite(price) ? price : null;
}

async function fetchKlines(pair: string, interval: string, limit: number) {
  const res = await fetch(`${BINANCE_BASE}/klines?symbol=${encodeURIComponent(pair)}&interval=${interval}&limit=${limit}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`binance_klines_${res.status}`);
  const payload = await res.json();
  if (!Array.isArray(payload)) throw new Error("binance_klines_invalid");
  return payload;
}

function simpleSma(values: number[], period: number) {
  if (values.length < period) return null;
  return values.slice(-period).reduce((sum, value) => sum + value, 0) / period;
}

function signal(closes: number[], breakoutPeriod: number, regimeSmaPeriod: number, lane: "short" | "long") {
  if (closes.length < breakoutPeriod + 2 || closes.length < regimeSmaPeriod) return { action: "SKIP", reason: "insufficient_history" };
  const last = closes[closes.length - 1];
  const channel = closes.slice(closes.length - 1 - breakoutPeriod, closes.length - 1);
  const hi = Math.max(...channel);
  const lo = Math.min(...channel);
  const sma = simpleSma(closes, regimeSmaPeriod);
  if (!sma) return { action: "SKIP", reason: "regime_unknown" };
  const side = last > hi ? "LONG" : last < lo ? "SHORT" : null;
  if (!side) return { action: "SKIP", reason: "inside_channel" };
  if (lane === "short" && side !== "SHORT") return { action: "SKIP", reason: "regime_long_filtered" };
  if (lane === "long" && side !== "LONG") return { action: "SKIP", reason: "regime_short_filtered" };
  if (side === "LONG" && last <= sma) return { action: "SKIP", reason: "breakout_LONG_vs_regime" };
  if (side === "SHORT" && last >= sma) return { action: "SKIP", reason: "breakout_SHORT_vs_regime" };
  return { action: "TRADE", side, reason: `donchian_${side.toLowerCase()}_regime_aligned` };
}

function profiles() {
  return [
    { id: "short_micro", agentId: "futures-breakout-short-0", tradeType: FUTURES_TYPES[0], pairs: ["BTCUSDT", "ETHUSDT"], interval: "5m", lane: "short" as const, breakoutPeriod: 20, regimeSmaPeriod: 55, maxMargin: 150, leverage: 3, timeoutHours: 2, minExpectedNetUsd: 18, minRewardRisk: 1.8 },
    { id: "short_core", agentId: "futures-breakout-short-1", tradeType: FUTURES_TYPES[1], pairs: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"], interval: "1h", lane: "short" as const, breakoutPeriod: 34, regimeSmaPeriod: 55, maxMargin: 250, leverage: 5, timeoutHours: 4, minExpectedNetUsd: 18, minRewardRisk: 1.8 },
    { id: "short_alt", agentId: "futures-breakout-short-2", tradeType: FUTURES_TYPES[2], pairs: ["XRPUSDT", "DOGEUSDT"], interval: "15m", lane: "short" as const, breakoutPeriod: 12, regimeSmaPeriod: 55, maxMargin: 200, leverage: 3, timeoutHours: 3, minExpectedNetUsd: 18, minRewardRisk: 1.8 },
    { id: "long_probe", agentId: "futures-breakout-long-1", tradeType: FUTURES_TYPES[3], pairs: ["BTCUSDT", "ETHUSDT"], interval: "4h", lane: "long" as const, breakoutPeriod: 55, regimeSmaPeriod: 55, maxMargin: 220, leverage: 3, timeoutHours: 6, minExpectedNetUsd: 18, minRewardRisk: 1.8 },
  ];
}

function quoteVolume24h(klines: any[]) {
  return klines.slice(-6).reduce((sum, row) => sum + (Number.parseFloat(row?.[7]) || 0), 0);
}

function slippagePct(orderSizeUsd: number, volume24hUsd: number) {
  if (orderSizeUsd <= 0) return 0;
  if (volume24hUsd <= 0) return 0.0008;
  const ratio = orderSizeUsd / volume24hUsd;
  if (ratio < 0.0005) return 0.0001;
  if (ratio < 0.005) return 0.0003;
  return 0.0008;
}

function netPnl(side: string, entryPrice: number, exitPrice: number, shares: number, slip: number, funding = 0) {
  const entry = side === "LONG" ? entryPrice * (1 + slip) : entryPrice * (1 - slip);
  const exit = side === "LONG" ? exitPrice * (1 - slip) : exitPrice * (1 + slip);
  const gross = side === "LONG" ? (exit - entry) * shares : (entry - exit) * shares;
  const fees = 0.0004 * (entry * shares + exit * shares);
  return Math.round((gross - fees - funding) * 1000) / 1000;
}

function setupEconomics(profile: any, side: string, price: number, volume24h: number) {
  const notional = profile.maxMargin * profile.leverage;
  const slip = slippagePct(notional, volume24h);
  const entry = side === "LONG" ? price * (1 + slip) : price * (1 - slip);
  const shares = entry > 0 ? Math.floor((notional / entry) * 10000) / 10000 : 0;
  const target = side === "LONG" ? entry * 1.12 : entry * 0.88;
  const stop = side === "LONG" ? entry * 0.97 : entry * 1.03;
  const tpNet = netPnl(side, entry, target, shares, slip, notional * 0.0001);
  const slNet = netPnl(side, entry, stop, shares, slip);
  const rr = slNet < 0 ? tpNet / Math.abs(slNet) : 0;
  return { notional, slip, entry, shares, target, stop, tpNet, slNet, rr };
}

async function closePositions(openRows: any[]) {
  const closed = [];
  for (const row of openRows) {
    const mark = await getCurrentPrice(row.asset_pair);
    if (!mark) continue;
    const ageHours = (Date.now() - new Date(row.opened_at).getTime()) / 3_600_000;
    let reason: string | null = null;
    if (row.outcome === "LONG" && row.target_price && mark >= Number(row.target_price)) reason = "take_profit";
    if (row.outcome === "LONG" && row.stop_price && mark <= Number(row.stop_price)) reason = "stop_loss";
    if (row.outcome === "SHORT" && row.target_price && mark <= Number(row.target_price)) reason = "take_profit";
    if (row.outcome === "SHORT" && row.stop_price && mark >= Number(row.stop_price)) reason = "stop_loss";
    if (!reason && Number(row.days_to_close ?? 0) > 0 && ageHours >= Number(row.days_to_close) * 24) reason = "timeout";
    if (!reason) continue;
    const notional = Number(row.notional_usd ?? 0);
    const funding = notional * 0.0001 * Math.max(1, ageHours) / 8;
    const pnl = netPnl(row.outcome, Number(row.entry_price), mark, Number(row.shares), slippagePct(notional, Number(row.entry_volume24h ?? 0)), funding);
    const { error } = await supabase.from("trades").update({
      status: "closed",
      exit_price: mark,
      pnl,
      closed_at: nowIso(),
      exit_reason: reason,
      funding_paid: funding,
    }).eq("id", row.id);
    if (error) throw error;
    closed.push({ id: row.id, pair: row.asset_pair, side: row.outcome, reason, pnl: round(pnl), mark: round(mark) });
  }
  return closed;
}

async function openPosition(profile: any, pair: string, side: string, price: number, volume24h: number, reason: string) {
  const econ = setupEconomics(profile, side, price, volume24h);
  if (econ.shares <= 0) return { opened: false, reason: "size_too_small" };
  if (econ.tpNet < profile.minExpectedNetUsd) return { opened: false, reason: "expected_net_too_low", tpNet: round(econ.tpNet), rr: round(econ.rr) };
  if (econ.rr < profile.minRewardRisk) return { opened: false, reason: "reward_risk_too_low", tpNet: round(econ.tpNet), rr: round(econ.rr) };
  const id = `edge-futures-${profile.id}-${pair}-${Date.now()}`;
  const evidence = JSON.stringify([reason, `SMA${profile.regimeSmaPeriod}`, `DONCHIAN${profile.breakoutPeriod}`, "SUPABASE_EDGE_RUNNER"]);
  const { error } = await supabase.from("trades").insert({
    id,
    agent_id: profile.agentId,
    market_id: `binance-futures:${pair}`,
    market_source: "binance_futures_paper",
    market_question: `${side} ${pair} futures breakout paper position`,
    market_category: "crypto_futures",
    outcome: side,
    entry_price: round(econ.entry, 5),
    shares: econ.shares,
    capital_used: profile.maxMargin,
    confidence: 0.75,
    reason: `Supabase edge futures runner ${side}: ${reason}`,
    evidence,
    status: "open",
    opened_at: nowIso(),
    days_to_close: Math.max(1, Math.ceil(profile.timeoutHours / 24)),
    asset_pair: pair,
    trade_type: profile.tradeType,
    target_price: round(econ.target, 5),
    stop_price: round(econ.stop, 5),
    entry_volume24h: volume24h,
    instrument_type: "futures",
    exchange: "binance",
    margin_mode: "isolated",
    leverage: profile.leverage,
    notional_usd: round(econ.notional),
    funding_rate: 0.0001,
    liquidation_price: null,
    maintenance_margin: round(econ.notional * 0.005),
  });
  if (error) throw error;
  return { opened: true, tradeId: id, entry: round(econ.entry, 5), tpNet: round(econ.tpNet), rr: round(econ.rr) };
}

async function writeCycleHistory(cycle: Record<string, unknown>) {
  const rows = await fetchRows("org_state", "value", (q) => q.eq("key", "futures_cycle_history").limit(1));
  const row = rows[0] as any;
  const history = parseJson<any[]>(row?.value, []);
  history.push(cycle);
  await writeOrgState("futures_cycle_history", history.slice(-80));
}

async function runTick() {
  const heartbeat = await readHeartbeat();
  if (heartbeat.msSinceLastTick != null && heartbeat.msSinceLastTick < MIN_INTERVAL_MS) {
    return { ok: true, mode: "throttled", lastTickAt: heartbeat.lastTickAt, msSinceLastTick: heartbeat.msSinceLastTick };
  }

  const startedAt = nowIso();
  const openRows = await fetchRows(
    "trades",
    "id,trade_type,asset_pair,outcome,entry_price,shares,notional_usd,target_price,stop_price,entry_volume24h,opened_at,days_to_close",
    (q) => q.in("trade_type", FUTURES_TYPES).eq("status", "open").order("opened_at", { ascending: false }).limit(100),
  );
  const closed = await closePositions(openRows);
  const currentOpen = await fetchRows("trades", "id,trade_type,asset_pair", (q) => q.in("trade_type", FUTURES_TYPES).eq("status", "open").limit(100));
  const openKeys = new Set(currentOpen.map((row: any) => `${row.trade_type}:${row.asset_pair}`));
  const result: any = { scanned: 0, qualified: 0, executed: 0, skipped: 0, closed: closed.length, closedPositions: closed, profiles: [] };

  for (const profile of profiles()) {
    const p: any = { profile: profile.id, scanned: 0, qualified: 0, executed: 0, skipped: 0, pairResults: [] };
    if (currentOpen.length >= MAX_OPEN_POSITIONS) {
      p.blocked = true;
      p.blockReason = "max_open_positions";
      result.profiles.push(p);
      continue;
    }
    for (const pair of profile.pairs) {
      result.scanned++;
      p.scanned++;
      if (openKeys.has(`${profile.tradeType}:${pair}`)) {
        result.skipped++;
        p.skipped++;
        p.pairResults.push({ pair, status: "skipped", reason: "position_open" });
        continue;
      }
      try {
        const klines = await fetchKlines(pair, profile.interval, 230);
        const closedKlines = klines.length > 1 ? klines.slice(0, -1) : klines;
        const closes = closedKlines.map((row: any) => Number.parseFloat(row?.[4])).filter(Number.isFinite);
        const sig = signal(closes, profile.breakoutPeriod, profile.regimeSmaPeriod, profile.lane);
        if (sig.action !== "TRADE" || !("side" in sig)) {
          result.skipped++;
          p.skipped++;
          p.pairResults.push({ pair, status: "skipped", reason: sig.reason });
          continue;
        }
        const price = await getCurrentPrice(pair);
        if (!price) throw new Error("price_unavailable");
        result.qualified++;
        p.qualified++;
        const side = sig.side === "LONG" ? "LONG" : "SHORT";
        const opened = await openPosition(profile, pair, side, price, quoteVolume24h(closedKlines), sig.reason);
        if (opened.opened) {
          result.executed++;
          p.executed++;
          openKeys.add(`${profile.tradeType}:${pair}`);
          p.pairResults.push({ pair, status: "executed", side, ...opened });
        } else {
          result.skipped++;
          p.skipped++;
          p.pairResults.push({ pair, status: "skipped", side, ...opened });
        }
      } catch (error) {
        result.skipped++;
        p.skipped++;
        p.pairResults.push({ pair, status: "skipped", reason: error instanceof Error ? error.message : String(error) });
      }
    }
    result.profiles.push(p);
  }

  const completedAt = nowIso();
  const cycle = { ...result, startedAt, completedAt, runner: "supabase_edge", startCapital: START_CAPITAL };
  await writeCycleHistory({
    startedAt,
    completedAt,
    scanned: result.scanned,
    qualified: result.qualified,
    executed: result.executed,
    skipped: result.skipped,
    closed: result.closed,
    profiles: result.profiles.map((p: any) => ({
      profile: p.profile,
      scanned: p.scanned,
      qualified: p.qualified,
      executed: p.executed,
      skipped: p.skipped,
      blocked: Boolean(p.blocked),
      blockReason: p.blockReason ?? null,
    })),
  });
  await writeHeartbeat({ ok: true, scanned: result.scanned, qualified: result.qualified, executed: result.executed, skipped: result.skipped, closed: result.closed });
  await logEvent("SUPABASE EDGE FUTURES TICK", { scanned: result.scanned, qualified: result.qualified, executed: result.executed, closed: result.closed });
  return { ok: true, mode: "executed", cycle };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "GET" && req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const auth = await runnerAuth(req);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  try {
    return json(await runTick());
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "runner_failed" }, 500);
  }
});
