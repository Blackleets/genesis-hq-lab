import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const CRYPTO_TRADE_TYPES = ["crypto_scalp", "scalp_v2", "swing_v1", "breakout_v1"];
const FUTURES_TRADE_TYPES = [
  "crypto_futures_breakout_short_micro",
  "crypto_futures_breakout_short",
  "crypto_futures_breakout_short_alt",
  "crypto_futures_breakout_long",
];
const ALL_CRYPTO_TYPES = [...CRYPTO_TRADE_TYPES, ...FUTURES_TRADE_TYPES];
const FUTURES_START_CAPITAL = Number.parseFloat(Deno.env.get("FUTURES_DESK_START_CAPITAL") ?? "10000");
const BINANCE_BASE = Deno.env.get("BINANCE_BASE") || "https://data-api.binance.vision/api/v3";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY");

if (!supabaseUrl || !supabaseKey) {
  throw new Error("supabase_env_missing");
}

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
      "access-control-allow-methods": "GET,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
    },
  });
}

function round2(value: number | null | undefined) {
  return value == null ? null : Math.round(value * 100) / 100;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

async function getHostedRunnerHeartbeat() {
  const rows = await fetchRows(
    "org_state",
    "value,updated_at",
    (q) => q.eq("key", "external_runner_heartbeat").limit(1),
  );
  const row: any = rows[0] ?? null;
  const payload = parseJson(row?.value, null);
  const lastTickAt = payload?.lastTickAt ?? null;
  const msSinceLastTick = lastTickAt
    ? Date.now() - new Date(lastTickAt).getTime()
    : null;
  return {
    source: payload?.source ?? "external",
    lastTickAt,
    totalCycles: Number(payload?.totalCycles ?? 0),
    claudeEnabled: Boolean(payload?.claudeEnabled),
    lastResult: payload?.lastResult ?? null,
    msSinceLastTick: Number.isFinite(msSinceLastTick) ? msSinceLastTick : null,
    agentAlive: Number.isFinite(msSinceLastTick) ? msSinceLastTick < 10 * 60 * 1000 : false,
    neverStarted: !lastTickAt,
    updatedAt: row?.updated_at ?? null,
  };
}

function exitKind(exitReason: string | null | undefined) {
  switch (exitReason) {
    case "take_profit": return "TP";
    case "stop_loss": return "SL";
    case "timeout": return "TIMEOUT";
    case "confidence_collapse": return "CONFIDENCE";
    case null:
    case undefined: return null;
    default: return "EXIT";
  }
}

async function fetchRows(table: string, select: string, build?: (query: any) => any) {
  let query = supabase.from(table).select(select);
  if (build) query = build(query);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

async function countRows(table: string) {
  const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

function aggregateClosedTrades(rows: Array<Record<string, unknown>>) {
  const total = rows.length;
  const wins = rows.filter((row) => Number(row.pnl ?? 0) > 0).length;
  const losses = rows.filter((row) => Number(row.pnl ?? 0) < 0).length;
  const pnls = rows.map((row) => Number(row.pnl ?? 0));
  const totalPnl = pnls.reduce((sum, value) => sum + value, 0);
  const bestTrade = pnls.length ? Math.max(...pnls) : 0;
  const worstTrade = pnls.length ? Math.min(...pnls) : 0;
  const avgPnl = total > 0 ? totalPnl / total : 0;
  const totalRisked = rows.reduce((sum, row) => sum + Number(row.capital_used ?? 0), 0);
  return { total, wins, losses, totalPnl, bestTrade, worstTrade, avgPnl, totalRisked };
}

async function getCurrentPrice(pair: string) {
  try {
    const res = await fetch(`${BINANCE_BASE}/ticker/price?symbol=${pair}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const payload = await res.json();
    const price = Number.parseFloat(payload?.price);
    return Number.isFinite(price) ? price : null;
  } catch {
    return null;
  }
}

async function getCurrentPrices(pairs: string[]) {
  const prices = new Map<string, number | null>();
  await Promise.all(
    Array.from(new Set(pairs.filter(Boolean))).map(async (pair) => {
      prices.set(pair, await getCurrentPrice(pair));
    }),
  );
  return prices;
}

function defaultFuturesConfig() {
  return {
    breakoutPeriod: Number.parseInt(Deno.env.get("FUTURES_BREAKOUT_SHORT_CORE_PERIOD") ?? "34", 10),
    regimeSmaPeriod: 55,
    tpPct: Number.parseFloat(Deno.env.get("FUTURES_BREAKOUT_TP_PCT") ?? "0.12"),
    slPct: Number.parseFloat(Deno.env.get("FUTURES_BREAKOUT_SL_PCT") ?? "0.03"),
    minExpectedNetUsd: Number.parseFloat(Deno.env.get("FUTURES_BREAKOUT_MIN_EXPECTED_NET_USD") ?? "18"),
    minRewardRisk: Number.parseFloat(Deno.env.get("FUTURES_BREAKOUT_MIN_REWARD_RISK") ?? "1.8"),
    timeoutHours: 4,
    maxMargin: Number.parseFloat(Deno.env.get("FUTURES_BREAKOUT_SHORT_CORE_MARGIN") ?? "250"),
    leverage: Number.parseFloat(Deno.env.get("FUTURES_BREAKOUT_SHORT_CORE_LEVERAGE") ?? "4"),
    governor: {
      windowDays: 14,
      degradeMinSamples: 8,
      pauseMinSamples: 12,
      evaluatedAt: new Date().toISOString(),
      supervisor: { maxDailyLoss: 0, maxConsecutiveLosses: 0, cooldownHours: 0 },
      profiles: [
        { id: "short_micro", tradeType: FUTURES_TRADE_TYPES[0] },
        { id: "short_core", tradeType: FUTURES_TRADE_TYPES[1] },
        { id: "short_alt", tradeType: FUTURES_TRADE_TYPES[2] },
        { id: "long_probe", tradeType: FUTURES_TRADE_TYPES[3] },
      ].map((profile) => ({
        ...profile,
        trades: 0,
        wins: 0,
        winRate: null,
        totalPnl: 0,
        avgPnl: 0,
        expectancy: 0,
        profitFactor: null,
        maxDrawdown: 0,
        rankScore: 0,
        mode: "learning",
        capitalMultiplier: 1,
        leverageMultiplier: 1,
        reason: "supabase_snapshot",
        supervisor: {
          dailyTrades: 0,
          dailyPnl: 0,
          consecutiveLosses: 0,
          cooldownUntil: null,
          mode: "live",
          reason: null,
        },
      })),
    },
    profiles: [
      {
        id: "short_micro",
        enabled: true,
        agentId: "futures_breakout_short_micro",
        tradeType: FUTURES_TRADE_TYPES[0],
        tier: "fast",
        interval: "5m",
        breakoutPeriod: Number.parseInt(Deno.env.get("FUTURES_BREAKOUT_SHORT_MICRO_PERIOD") ?? "20", 10),
        maxMargin: Number.parseFloat(Deno.env.get("FUTURES_BREAKOUT_SHORT_MICRO_MARGIN") ?? "150"),
        timeoutHours: 2,
        minExpectedNetUsd: Number.parseFloat(Deno.env.get("FUTURES_BREAKOUT_MIN_EXPECTED_NET_USD") ?? "18"),
        minRewardRisk: Number.parseFloat(Deno.env.get("FUTURES_BREAKOUT_MIN_REWARD_RISK") ?? "1.8"),
        pairs: (Deno.env.get("FUTURES_BREAKOUT_SHORT_MICRO_PAIRS") ?? "BTCUSDT,ETHUSDT").split(","),
      },
      {
        id: "short_core",
        enabled: true,
        agentId: "futures_breakout_short_core",
        tradeType: FUTURES_TRADE_TYPES[1],
        tier: "mid",
        interval: "1h",
        breakoutPeriod: Number.parseInt(Deno.env.get("FUTURES_BREAKOUT_SHORT_CORE_PERIOD") ?? "34", 10),
        maxMargin: Number.parseFloat(Deno.env.get("FUTURES_BREAKOUT_SHORT_CORE_MARGIN") ?? "250"),
        timeoutHours: 4,
        minExpectedNetUsd: Number.parseFloat(Deno.env.get("FUTURES_BREAKOUT_MIN_EXPECTED_NET_USD") ?? "18"),
        minRewardRisk: Number.parseFloat(Deno.env.get("FUTURES_BREAKOUT_MIN_REWARD_RISK") ?? "1.8"),
        pairs: (Deno.env.get("FUTURES_BREAKOUT_SHORT_PAIRS") ?? "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT").split(","),
      },
      {
        id: "short_alt",
        enabled: true,
        agentId: "futures_breakout_short_alt",
        tradeType: FUTURES_TRADE_TYPES[2],
        tier: "alt",
        interval: "15m",
        breakoutPeriod: Number.parseInt(Deno.env.get("FUTURES_BREAKOUT_SHORT_ALT_PERIOD") ?? "12", 10),
        maxMargin: Number.parseFloat(Deno.env.get("FUTURES_BREAKOUT_SHORT_ALT_MARGIN") ?? "200"),
        timeoutHours: 3,
        minExpectedNetUsd: Number.parseFloat(Deno.env.get("FUTURES_BREAKOUT_MIN_EXPECTED_NET_USD") ?? "18"),
        minRewardRisk: Number.parseFloat(Deno.env.get("FUTURES_BREAKOUT_MIN_REWARD_RISK") ?? "1.8"),
        pairs: (Deno.env.get("FUTURES_BREAKOUT_SHORT_ALT_PAIRS") ?? "XRPUSDT,DOGEUSDT").split(","),
      },
      {
        id: "long_probe",
        enabled: true,
        agentId: "futures_breakout_long_probe",
        tradeType: FUTURES_TRADE_TYPES[3],
        tier: "slow",
        interval: "4h",
        breakoutPeriod: Number.parseInt(Deno.env.get("FUTURES_BREAKOUT_LONG_PROBE_PERIOD") ?? "55", 10),
        maxMargin: Number.parseFloat(Deno.env.get("FUTURES_BREAKOUT_LONG_PROBE_MARGIN") ?? "220"),
        timeoutHours: 6,
        minExpectedNetUsd: Number.parseFloat(Deno.env.get("FUTURES_BREAKOUT_MIN_EXPECTED_NET_USD") ?? "18"),
        minRewardRisk: Number.parseFloat(Deno.env.get("FUTURES_BREAKOUT_MIN_REWARD_RISK") ?? "1.8"),
        pairs: (Deno.env.get("FUTURES_BREAKOUT_LONG_PAIRS") ?? "BTCUSDT,ETHUSDT").split(","),
      },
    ],
  };
}

function mapRun(row: Record<string, unknown> | null) {
  if (!row) return null;
  return {
    id: row.id,
    missionId: row.mission_id,
    source: row.source,
    scope: row.scope,
    status: row.status,
    advisoryOnly: Boolean(row.advisory_only),
    providerStatus: row.provider_status,
    mission: parseJson(row.mission, null),
    candidateSummary: parseJson(row.candidate_summary, null),
    recommendedPrompt: row.recommended_prompt ?? null,
    recommendedRules: parseJson(row.recommended_rules, []),
    score: row.score == null ? null : Math.round(Number(row.score) * 1000) / 1000,
    riskNotes: parseJson(row.risk_notes, []),
    justification: parseJson(row.justification, []),
    proposedChanges: parseJson(row.proposed_changes, []),
    artifacts: parseJson(row.artifacts, null),
    createdAt: row.created_at,
  };
}

async function getCryptoOverview() {
  const closedRows = await fetchRows(
    "trades",
    "id,asset_pair,pnl,capital_used,status,trade_type,entry_price,exit_price,target_price,stop_price,confidence,exit_reason,opened_at,closed_at,outcome",
    (q) => q.in("trade_type", CRYPTO_TRADE_TYPES).eq("status", "closed").order("closed_at", { ascending: false }).range(0, 4999),
  );
  const openRows = await fetchRows(
    "trades",
    "id,asset_pair,outcome,entry_price,target_price,stop_price,capital_used,confidence,opened_at,status,trade_type",
    (q) => q.in("trade_type", CRYPTO_TRADE_TYPES).eq("status", "open").order("opened_at", { ascending: false }).range(0, 499),
  );
  const closed = aggregateClosedTrades(closedRows);
  const byAsset = Array.from(closedRows.reduce((map, row: any) => {
    const key = row.asset_pair || "UNKNOWN";
    const current = map.get(key) ?? { pair: key, trades: 0, pnl: 0, wins: 0 };
    current.trades += 1;
    current.pnl += Number(row.pnl ?? 0);
    if (Number(row.pnl ?? 0) > 0) current.wins += 1;
    map.set(key, current);
    return map;
  }, new Map<string, { pair: string; trades: number; pnl: number; wins: number }>()).values())
    .sort((a, b) => b.pnl - a.pnl)
    .map((row) => ({
      pair: row.pair,
      trades: row.trades,
      pnl: round2(row.pnl) ?? 0,
      wins: row.wins,
      winRate: row.trades > 0 ? row.wins / row.trades : 0,
    }));

  return {
    ok: true,
    params: {
      targetPct: 0.12,
      stopPct: 0.03,
      timeoutHours: 4,
      emaMarginPct: 0,
      momentumPct: 0,
      rsiLongMin: 0,
      rsiLongMax: 100,
      rsiShortMin: 0,
      rsiShortMax: 100,
      minVolume24h: 0,
    },
    paramsMeta: { meta: { source: "supabase_edge_fallback" }, updatedAt: new Date().toISOString() },
    pnl: {
      closed: {
        total: closed.total,
        wins: closed.wins,
        losses: closed.losses,
        winRate: closed.total > 0 ? closed.wins / closed.total : 0,
        totalPnl: round2(closed.totalPnl) ?? 0,
        bestTrade: round2(closed.bestTrade) ?? 0,
        worstTrade: round2(closed.worstTrade) ?? 0,
        avgPnl: round2(closed.avgPnl) ?? 0,
        totalRisked: round2(closed.totalRisked) ?? 0,
        roi: closed.totalRisked > 0 ? closed.totalPnl / closed.totalRisked : 0,
      },
      open: {
        count: openRows.length,
        atRisk: round2(openRows.reduce((sum: number, row: any) => sum + Number(row.capital_used ?? 0), 0)) ?? 0,
      },
      byAsset,
    },
    positions: openRows.map((row: any) => ({
      id: row.id,
      pair: row.asset_pair,
      side: row.outcome,
      entry_price: Number(row.entry_price),
      target_price: Number(row.target_price),
      stop_price: Number(row.stop_price),
      capital_used: Number(row.capital_used),
      confidence: Number(row.confidence ?? 0),
      opened_at: row.opened_at,
    })),
    recent: closedRows.slice(0, 25).map((row: any) => ({
      id: row.id,
      pair: row.asset_pair,
      side: row.outcome,
      entry_price: Number(row.entry_price),
      exit_price: row.exit_price == null ? null : Number(row.exit_price),
      pnl: row.pnl == null ? null : round2(Number(row.pnl)),
      exit_reason: row.exit_reason,
      confidence: Number(row.confidence ?? 0),
      opened_at: row.opened_at,
      closed_at: row.closed_at,
    })),
    optimizerRuns: [],
    optimizerHeartbeat: null,
  };
}

async function getTradeStories(limit: number, pair: string | null) {
  const rows = await fetchRows(
    "trades",
    "id,asset_pair,outcome,agent_id,trade_type,capital_used,leverage,entry_price,exit_price,target_price,stop_price,pnl,confidence,reason,evidence,exit_reason,opened_at,closed_at,status",
    (q) => {
      let next = q.in("trade_type", ALL_CRYPTO_TYPES);
      if (pair) next = next.eq("asset_pair", pair);
      return next.order("opened_at", { ascending: false }).limit(Math.min(120, Math.max(1, limit)));
    },
  );
  return rows.map((row: any) => ({
    id: row.id,
    pair: row.asset_pair ?? "",
    side: row.outcome === "SHORT" ? "SHORT" : "LONG",
    agent_id: row.agent_id ?? null,
    trade_type: row.trade_type ?? null,
    capital_used: row.capital_used == null ? null : Number(row.capital_used),
    leverage: row.leverage == null ? null : Number(row.leverage),
    entry_price: Number(row.entry_price),
    exit_price: row.exit_price == null ? null : Number(row.exit_price),
    target_price: row.target_price == null ? null : Number(row.target_price),
    stop_price: row.stop_price == null ? null : Number(row.stop_price),
    pnl: row.pnl == null ? null : round2(Number(row.pnl)),
    confidence: Number(row.confidence ?? 0),
    reason: row.reason ?? "",
    evidence: parseJson(row.evidence, []),
    exit_reason: row.exit_reason ?? null,
    exit_kind: exitKind(row.exit_reason),
    opened_at: row.opened_at,
    closed_at: row.closed_at ?? null,
    status: row.status ?? "open",
  }));
}

async function getCommentary(limit: number) {
  const events = await fetchRows(
    "operator_events",
    "ts,category,reason,subsystem,severity,metadata",
    (q) => q.order("ts", { ascending: false }).limit(Math.min(120, Math.max(1, limit))),
  );
  if (events.length > 0) {
    return events.map((row: any) => {
      const meta = parseJson(row.metadata, {});
      const detail = typeof meta.detail === "string"
        ? meta.detail
        : typeof meta.note === "string"
          ? meta.note
          : row.subsystem ?? "fallback";
      return {
        ts: row.ts,
        type: row.category ?? "INFO",
        text: row.reason ?? "monitoring",
        detail,
        severity: row.severity ?? "info",
        source: "deterministic",
      };
    });
  }
  const trades = await getTradeStories(Math.min(8, limit), null);
  return trades.map((trade) => ({
    ts: trade.closed_at ?? trade.opened_at,
    type: trade.status === "closed" ? "TRADE_CLOSED" : "TRADE_OPEN",
    text: trade.status === "closed"
      ? `${trade.pair} ${trade.exit_kind ?? "EXIT"} ${trade.pnl == null ? "" : `${trade.pnl >= 0 ? "+" : ""}$${Math.abs(trade.pnl).toFixed(2)}`}`.trim()
      : `${trade.pair} ${trade.side} monitoring`,
    detail: trade.reason ?? "monitoring",
    severity: trade.pnl != null && trade.pnl < 0 ? "warning" : "info",
    source: "deterministic",
  }));
}

async function getSupervisorLatest() {
  const rows = await fetchRows(
    "intelligence_runs",
    "*",
    (q) => q.eq("scope", "futures_supervisor").order("created_at", { ascending: false }).limit(10),
  );
  const latestRecommended = rows.find((row: any) => row.status === "draft" || row.status === "recommended") ?? null;
  const latestAttempt = rows[0] ?? null;
  return {
    scope: "futures_supervisor",
    latest: mapRun(latestRecommended),
    latestAttempt: mapRun(latestAttempt),
    appliedPolicy: {
      active: false,
      sourceRunId: null,
      appliedAt: null,
      appliedBy: null,
      expiresAt: null,
      overrides: [],
      latestApply: null,
      impact: null,
    },
  };
}

async function getFuturesDesk() {
  const config = defaultFuturesConfig();
  const allRows = await fetchRows(
    "trades",
    "id,trade_type,agent_id,asset_pair,outcome,entry_price,exit_price,shares,capital_used,notional_usd,leverage,target_price,stop_price,liquidation_price,opened_at,closed_at,status,pnl,reason,exit_reason",
    (q) => q.in("trade_type", FUTURES_TRADE_TYPES).order("opened_at", { ascending: false }).range(0, 4999),
  );
  const openRows = allRows.filter((row: any) => row.status === "open");
  const closedRows = allRows.filter((row: any) => row.status === "closed");
  const prices = await getCurrentPrices(openRows.map((row: any) => row.asset_pair));
  const openPositions = openRows.map((row: any) => {
    const markPrice = prices.get(row.asset_pair) ?? null;
    const shares = Number(row.shares ?? 0);
    const entry = Number(row.entry_price ?? 0);
    const grossMarkPnl = markPrice == null
      ? null
      : row.outcome === "LONG"
        ? (markPrice - entry) * shares
        : (entry - markPrice) * shares;
    return {
      id: row.id,
      tradeType: row.trade_type,
      agentId: row.agent_id ?? null,
      pair: row.asset_pair,
      side: row.outcome,
      openedAt: row.opened_at,
      entryPrice: round2(entry),
      markPrice: round2(markPrice),
      grossMarkPnlApproxUsd: round2(grossMarkPnl),
      capitalUsed: round2(Number(row.capital_used ?? 0)),
      notionalUsd: round2(Number(row.notional_usd ?? 0)),
      leverage: row.leverage == null ? null : Number(row.leverage),
      targetPrice: round2(Number(row.target_price ?? 0)),
      stopPrice: round2(Number(row.stop_price ?? 0)),
      liquidationPrice: row.liquidation_price == null ? null : round2(Number(row.liquidation_price)),
    };
  });

  const byTradeType = new Map<string, any[]>();
  for (const row of closedRows) {
    const list = byTradeType.get((row as any).trade_type) ?? [];
    list.push(row as any);
    byTradeType.set((row as any).trade_type, list);
  }

  const closedSummary = FUTURES_TRADE_TYPES.map((tradeType) => {
    const rows = byTradeType.get(tradeType) ?? [];
    const totalPnl = rows.reduce((sum, row) => sum + Number(row.pnl ?? 0), 0);
    const wins = rows.filter((row) => Number(row.pnl ?? 0) > 0).length;
    return {
      tradeType,
      closedTrades: rows.length,
      wins,
      winRate: rows.length > 0 ? wins / rows.length : null,
      totalPnl: round2(totalPnl) ?? 0,
      avgPnl: rows.length > 0 ? round2(totalPnl / rows.length) ?? 0 : 0,
    };
  });

  const realizedPnl = closedSummary.reduce((sum, row) => sum + (row.totalPnl ?? 0), 0);
  const reservedMargin = openPositions.reduce((sum, row) => sum + (row.capitalUsed ?? 0), 0);
  const unrealizedPnl = openPositions.reduce((sum, row) => sum + (row.grossMarkPnlApproxUsd ?? 0), 0);
  const equity = FUTURES_START_CAPITAL + realizedPnl + unrealizedPnl;
  const available = equity - reservedMargin;

  let cumulative = 0;
  const equityCurve = closedRows
    .filter((row: any) => row.closed_at)
    .sort((a: any, b: any) => String(a.closed_at).localeCompare(String(b.closed_at)))
    .slice(-40)
    .map((row: any) => {
      cumulative += Number(row.pnl ?? 0);
      return {
        ts: row.closed_at,
        tradeId: row.id,
        pair: row.asset_pair,
        pnl: round2(Number(row.pnl ?? 0)) ?? 0,
        equity: round2(cumulative) ?? 0,
      };
    });

  const recentLifecycle = [...allRows]
    .sort((a: any, b: any) => String(b.closed_at ?? b.opened_at).localeCompare(String(a.closed_at ?? a.opened_at)))
    .slice(0, 12)
    .map((row: any) => ({
      id: row.id,
      tradeType: row.trade_type,
      pair: row.asset_pair,
      side: row.outcome,
      event: row.status === "closed" ? "closed" : "opened",
      eventAt: row.closed_at ?? row.opened_at,
      pnl: row.pnl == null ? null : round2(Number(row.pnl)),
      reason: row.status === "closed" ? (row.exit_reason ?? row.reason) : row.reason,
      status: row.status,
    }));

  const todayIso = new Date();
  todayIso.setUTCHours(0, 0, 0, 0);
  const todayStart = todayIso.toISOString();
  const todayClosed = closedRows.filter((row: any) => row.closed_at && String(row.closed_at) >= todayStart);
  const todayWins = todayClosed.filter((row: any) => Number(row.pnl ?? 0) > 0).length;
  const todayLosses = todayClosed.filter((row: any) => Number(row.pnl ?? 0) < 0).length;
  const todayTotalPnl = todayClosed.reduce((sum: number, row: any) => sum + Number(row.pnl ?? 0), 0);

  const profileScoreboard = FUTURES_TRADE_TYPES.map((tradeType) => {
    const rows = byTradeType.get(tradeType) ?? [];
    const totalPnl = rows.reduce((sum, row) => sum + Number(row.pnl ?? 0), 0);
    const wins = rows.filter((row) => Number(row.pnl ?? 0) > 0).length;
    const losses = rows.filter((row) => Number(row.pnl ?? 0) < 0).length;
    const pairsMap = rows.reduce((map, row: any) => {
      const key = row.asset_pair;
      const current = map.get(key) ?? { pair: key, closedTrades: 0, wins: 0, losses: 0, totalPnl: 0, avgPnl: 0, profitFactor: null, firstOpenedAt: row.opened_at, lastClosedAt: row.closed_at };
      current.closedTrades += 1;
      if (Number(row.pnl ?? 0) > 0) current.wins += 1;
      if (Number(row.pnl ?? 0) < 0) current.losses += 1;
      current.totalPnl += Number(row.pnl ?? 0);
      current.firstOpenedAt = current.firstOpenedAt && current.firstOpenedAt < row.opened_at ? current.firstOpenedAt : row.opened_at;
      current.lastClosedAt = current.lastClosedAt && current.lastClosedAt > row.closed_at ? current.lastClosedAt : row.closed_at;
      map.set(key, current);
      return map;
    }, new Map<string, any>());
    const pairs = Array.from(pairsMap.values()).map((item: any) => ({
      ...item,
      winRate: item.closedTrades > 0 ? item.wins / item.closedTrades : null,
      totalPnl: round2(item.totalPnl) ?? 0,
      avgPnl: item.closedTrades > 0 ? round2(item.totalPnl / item.closedTrades) ?? 0 : 0,
    }));
    return {
      tradeType,
      closedTrades: rows.length,
      wins,
      losses,
      winRate: rows.length > 0 ? wins / rows.length : null,
      totalPnl: round2(totalPnl) ?? 0,
      expectancy: rows.length > 0 ? round2(totalPnl / rows.length) : 0,
      profitFactor: null,
      maxDrawdown: null,
      rankScore: round2(totalPnl),
      mode: "learning",
      capitalMultiplier: 1,
      leverageMultiplier: 1,
      pairs,
    };
  });

  const recentEntries = [...allRows]
    .sort((a: any, b: any) => String(b.opened_at).localeCompare(String(a.opened_at)))
    .slice(0, 20)
    .map((row: any) => ({
      id: row.id,
      tradeType: row.trade_type,
      agentId: row.agent_id ?? null,
      pair: row.asset_pair,
      side: row.outcome,
      entryPrice: round2(Number(row.entry_price ?? 0)),
      capitalUsed: round2(Number(row.capital_used ?? 0)),
      leverage: row.leverage == null ? null : Number(row.leverage),
      openedAt: row.opened_at,
      reason: row.reason ?? null,
    }));

  return {
    ok: true,
    mode: "status",
    generatedAt: new Date().toISOString(),
    warnings: [{
      section: "fallback",
      error: "Render backend unavailable; serving Supabase snapshot from edge function.",
      at: new Date().toISOString(),
    }],
    config,
    cycle: null,
    governorJournal: [],
    baseline: null,
    treasury: {
      total: round2(FUTURES_START_CAPITAL) ?? FUTURES_START_CAPITAL,
      available: round2(available) ?? 0,
      inTrades: round2(reservedMargin) ?? 0,
      unrealizedPnl: round2(unrealizedPnl) ?? 0,
      netWorth: round2(equity) ?? 0,
      drawdownPct: equity < FUTURES_START_CAPITAL ? (FUTURES_START_CAPITAL - equity) / FUTURES_START_CAPITAL : 0,
      isPaused: false,
    },
    futuresCapital: {
      startCapital: FUTURES_START_CAPITAL,
      reservedMargin: round2(reservedMargin),
      realizedPnl: round2(realizedPnl),
      unrealizedPnl: round2(unrealizedPnl),
      netPnl: round2(realizedPnl + unrealizedPnl),
      equity: round2(equity),
      available: round2(available),
      openPositions: openPositions.length,
    },
    openPositions,
    closedSummary,
    equityCurve,
    recentLifecycle,
    today: {
      openCount: openRows.length,
      closedTrades: todayClosed.length,
      wins: todayWins,
      losses: todayLosses,
      winRate: todayClosed.length > 0 ? todayWins / todayClosed.length : null,
      totalPnl: round2(todayTotalPnl) ?? 0,
      avgPnl: todayClosed.length > 0 ? round2(todayTotalPnl / todayClosed.length) ?? 0 : 0,
    },
    cycleHistory: [],
    profileScoreboard,
    learningCohorts: { strongest: [], weakest: [] },
    supervisor: await getSupervisorLatest(),
    recentEntries,
  };
}

async function getDiagnostics() {
  const rows = await fetchRows(
    "trades",
    "status,pnl,trade_type",
    (q) => q.in("trade_type", ALL_CRYPTO_TYPES).range(0, 4999),
  );
  const recentScans = await fetchRows(
    "operator_events",
    "ts,reason,subsystem,category",
    (q) => q.eq("category", "SCAN").order("ts", { ascending: false }).limit(12),
  );
  const total = rows.length;
  const open = rows.filter((row: any) => row.status === "open").length;
  const closed = rows.filter((row: any) => row.status === "closed").length;
  const wins = rows.filter((row: any) => row.status === "closed" && Number(row.pnl ?? 0) > 0).length;
  const totalPnl = rows.filter((row: any) => row.status === "closed").reduce((sum: number, row: any) => sum + Number(row.pnl ?? 0), 0);
  return {
    ok: true,
    loops: {
      scalping: { running: false, ticks: 0, lastRun: null, errors: 0, expectedMs: 5000 },
      event: { running: false, ticks: 0, lastRun: null, errors: 0, expectedMs: 30000 },
      swing: { running: false, ticks: 0, lastRun: null, errors: 0, expectedMs: 300000 },
    },
    gates: {
      scalp: { minConfidence: 0, tpPct: 0.12, slPct: 0.03 },
      swing: { minConfidence: 0 },
      event: { evThreshold: 0, minConfidence: 0 },
    },
    training: {
      total,
      open,
      closed,
      wins,
      winRate: closed > 0 ? wins / closed : null,
      totalPnl: round2(totalPnl) ?? 0,
      bestEngine: null,
      trainingDay: 1,
      confidenceAccuracy: null,
    },
    mode: "supabase_snapshot",
    recentScans: recentScans.map((row: any) => ({ ts: row.ts, reason: row.reason, subsystem: row.subsystem })),
    scanSnapshot: { at: null, assets: [] },
    regimePerformance: [],
    autopsy: null,
    llm: {
      provider: "fallback",
      usedByLiveScalp: false,
      usedByLegacyCryptoLoop: false,
      configured: false,
      available: null,
      fallbackActive: true,
      verification: "verified",
      lastProviderError: null,
      checkedAt: new Date().toISOString(),
      lastModel: null,
      note: "Supabase edge snapshot while Render is unavailable.",
    },
  };
}

async function getMarketIntelligence() {
  const rows = await fetchRows(
    "trades",
    "pnl,outcome,closed_at,trade_type,status",
    (q) => q.in("trade_type", ALL_CRYPTO_TYPES).eq("status", "closed").order("closed_at", { ascending: false }).limit(30),
  );
  const wins = rows.filter((row: any) => Number(row.pnl ?? 0) > 0).length;
  const recentWinRate = rows.length > 0 ? wins / rows.length : null;
  const btc = await getCurrentPrice("BTCUSDT");
  let change = 0;
  try {
    const res = await fetch(`${BINANCE_BASE}/klines?symbol=BTCUSDT&interval=1h&limit=2`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const payload = await res.json();
      const old = payload?.[0] ? Number.parseFloat(payload[0][1]) : null;
      if (btc && old) change = ((btc - old) / old) * 100;
    }
  } catch {
    change = 0;
  }
  return {
    momentum: change > 0.35 ? "Bullish" : change < -0.35 ? "Bearish" : "Neutral",
    volatility: "Medium",
    trend: recentWinRate == null ? "Unknown" : recentWinRate >= 0.55 ? "Strong" : recentWinRate >= 0.4 ? "Mixed" : "Weak",
    regime: "Scalp",
    recommendation: recentWinRate == null ? "WAIT" : recentWinRate >= 0.55 ? "WATCH" : "WAIT",
    confidence: { score: recentWinRate == null ? 0 : Math.max(0, Math.min(1, recentWinRate)), band: "fallback" },
    risk: { band: recentWinRate != null && recentWinRate < 0.4 ? "ELEVATED" : "HEALTHY", score: 0.5, safeMode: false },
    activity: {
      signalsLast3h: 0,
      longs: rows.filter((row: any) => row.outcome === "LONG").length,
      shorts: rows.filter((row: any) => row.outcome === "SHORT").length,
      recentWinRate,
    },
  };
}

async function getHealth() {
  const futures = await getFuturesDesk();
  const runner = await getHostedRunnerHeartbeat();
  return {
    ok: true,
    service: "genesis-hq-supabase-fallback",
    now: new Date().toISOString(),
    futuresMode: true,
    futuresCapital: futures.futuresCapital,
    agent: {
      capital: futures.futuresCapital.equity ?? FUTURES_START_CAPITAL,
      isPaused: false,
      openTrades: futures.openPositions.length,
      lastTickAt: runner.lastTickAt,
      agentAlive: runner.agentAlive,
      totalCycles: runner.totalCycles,
      claudeEnabled: runner.claudeEnabled,
    },
  };
}

async function getSystemHealth() {
  const futures = await getFuturesDesk();
  const runner = await getHostedRunnerHeartbeat();
  const totalTrades = await countRows("trades");
  const lessons = await countRows("lessons");
  return {
    ok: true,
    timestamp: new Date().toISOString(),
    probeMs: 0,
    websocket: { connectedClients: 0, active: false },
    database: { ok: true, totalTrades, tables: 5 },
    treasury: {
      ok: true,
      total: futures.treasury.total,
      available: futures.treasury.available,
      inTrades: futures.treasury.inTrades,
      isPaused: futures.treasury.isPaused,
      drawdownPct: futures.treasury.drawdownPct,
    },
    agentRunner: {
      ok: runner.agentAlive || runner.neverStarted,
      openTrades: futures.openPositions.length,
      lastTickAt: runner.lastTickAt,
      agentAlive: runner.agentAlive,
      msSinceLastTick: runner.msSinceLastTick,
      totalCycles: runner.totalCycles,
      claudeEnabled: runner.claudeEnabled,
      neverStarted: runner.neverStarted,
    },
    kalshi: { ok: false, hasApiKey: false, wsConnected: false, mode: "fallback" },
    optimizer: { ok: false, mode: "fallback" },
    learning: {
      ok: true,
      lessons,
      activeVetoes: 0,
      agentsTracked: 0,
      lastConsensusDecision: null,
      lastConsensusAt: null,
      outcomeEngine: null,
    },
    founderMode: {
      ok: true,
      mode: "supabase_snapshot",
      focus: "supabase contingency",
      goal: "keep read-only visibility alive while Render is down",
      deptMarkets: "standby",
      deptCrypto: "monitoring",
    },
    execution: {
      capital: futures.futuresCapital.equity ?? FUTURES_START_CAPITAL,
      available: futures.futuresCapital.available ?? 0,
      openTrades: futures.openPositions.length,
      isPaused: false,
      drawdownPct: futures.treasury.drawdownPct ?? 0,
      agentAlive: runner.agentAlive,
      lastTickAt: runner.lastTickAt,
      realizedPnl: futures.futuresCapital.realizedPnl,
      winRate: futures.today.winRate,
      totalTrades: futures.closedSummary.reduce((sum: number, row: any) => sum + row.closedTrades, 0),
      stalePositionCount: 0,
      unrealizedDegraded: false,
      pnlFresh: true,
      unrealizedPnl: futures.futuresCapital.unrealizedPnl,
      drawdownProtection: null,
      startupReconciliation: null,
      confidenceEngine: null,
      globalRisk: {
        score: 0.5,
        band: "WATCH",
        safeMode: false,
        activeFlags: ["render_unavailable"],
        dimensions: {},
        lastRefreshAt: new Date().toISOString(),
      },
    },
    issues: [{ severity: "warn", system: "backend", message: "Render unavailable. Serving Supabase snapshot from edge function." }],
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "GET") return json({ ok: false, error: "method_not_allowed" }, 405);
  try {
    const url = new URL(req.url);
    const route = url.searchParams.get("route") ?? "health";
    const limit = Number.parseInt(url.searchParams.get("limit") ?? "40", 10);
    const pair = url.searchParams.get("pair");
    switch (route) {
      case "health": return json(await getHealth());
      case "system-health": return json(await getSystemHealth());
      case "crypto-overview": return json(await getCryptoOverview());
      case "crypto-trades": return json({ ok: true, trades: await getTradeStories(limit, pair) });
      case "crypto-commentary": return json({ ok: true, commentary: await getCommentary(limit) });
      case "crypto-diagnostics": return json(await getDiagnostics());
      case "crypto-futures-desk": return json(await getFuturesDesk());
      case "crypto-market-intelligence": return json(await getMarketIntelligence());
      case "supervisor-latest": return json({ ok: true, advisoryOnly: true, applied: false, ...(await getSupervisorLatest()) });
      default: return json({ ok: false, error: "route_not_found" }, 404);
    }
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "supabase_fallback_failed" }, 500);
  }
});
