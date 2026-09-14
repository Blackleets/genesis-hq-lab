import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const RUNNER_TOKEN_SHA256 = "e9f02987e836a6eaf8ef8d7afaed805580cd31264aef5ed86fc3ebb756c59d91";

const JUPITER_QUOTE_URL = "https://lite-api.jup.ag/swap/v1/quote";
const SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
const JITO_TIP_URL = "https://bundles.jito.wtf/api/v1/bundles/tip_floor";
const TELEGRAM_API = "https://api.telegram.org";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const NOTIONAL_USDC = 25;
const USDC_SCALE = 1_000_000;
const LAMPORTS_PER_SOL = 1_000_000_000;
const SLIPPAGE_BPS_PER_LEG = 10;
const LATENCY_DEGRADATION_BPS = 5;
const ADVERSE_SELECTION_BPS = 5;
const FAILURE_PROBABILITY_RESERVE = 0.10;
const COMPUTE_UNIT_LIMIT = 1_000_000;
const BASE_FEE_LAMPORTS = 5_000;
const PRIORITY_FEE_PERCENTILE = 0.75;
const MAX_SLOT_DRIFT = 4;
const REQUEST_TIMEOUT_MS = 5_000;
const PAPER_CAPTURE_DELAY_MS = 1_500;

type Db = ReturnType<typeof createClient>;

type Economics = {
  startUsdc: number;
  endUsdc: number;
  solOut: number;
  solUsd: number;
  quotedProfitUsd: number;
  quotedEdgeBps: number;
  netPnlUsd: number | null;
  netEdgeBps: number | null;
  totalCostUsd: number | null;
  firstVenues: string[];
  secondVenues: string[];
  route: string;
  quoteLatencyMs: number;
  slot: number | null;
  slotDrift: number | null;
  blockers: string[];
  costs: {
    totalUsd: number | null;
    baseFeeUsd: number | null;
    priorityFeeUsd: number | null;
    jitoTipUsd: number | null;
    slippageReserveUsd: number;
    latencyDegradationUsd: number;
    adverseSelectionReserveUsd: number;
    failureReserveUsd: number | null;
  };
  evidenceErrors: { priorityFee: string | null; jitoTip: string | null };
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function authorized(req: Request) {
  const supplied = (req.headers.get("x-genesis-runner-token") || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "").trim();
  return Boolean(supplied) && await sha256Hex(supplied) === RUNNER_TOKEN_SHA256;
}

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`http_${response.status}${body ? `:${body.slice(0, 120)}` : ""}`);
  }
  return await response.json();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function quantile(values: number[], p: number) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const index = Math.min(clean.length - 1, Math.max(0, Math.ceil(p * clean.length) - 1));
  return clean[index];
}

function venueLabels(quote: any) {
  return [...new Set((quote?.routePlan ?? []).map((step: any) => step?.swapInfo?.label).filter(Boolean))] as string[];
}

async function jupiterQuote(inputMint: string, outputMint: string, amountRaw: bigint) {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: String(amountRaw),
    slippageBps: String(SLIPPAGE_BPS_PER_LEG),
    restrictIntermediateTokens: "true",
    instructionVersion: "V2",
  });
  const started = Date.now();
  const quote = await fetchJson(`${JUPITER_QUOTE_URL}?${params}`);
  if (!quote?.inAmount || !quote?.outAmount || !Array.isArray(quote?.routePlan)) throw new Error("invalid_jupiter_quote");
  return { quote, latencyMs: Date.now() - started };
}

async function priorityFeeEvidence() {
  const body = await fetchJson(SOLANA_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getRecentPrioritizationFees", params: [[]] }),
  });
  if (!Array.isArray(body?.result)) throw new Error("priority_fee_unavailable");
  const microLamportsPerCu = quantile(body.result.map((row: any) => Number(row?.prioritizationFee)), PRIORITY_FEE_PERCENTILE);
  if (!Number.isFinite(microLamportsPerCu)) throw new Error("priority_fee_unavailable");
  return Math.ceil((Number(microLamportsPerCu) * COMPUTE_UNIT_LIMIT) / 1_000_000);
}

async function jitoTipLamports() {
  const body = await fetchJson(JITO_TIP_URL);
  const row = Array.isArray(body) ? body[0] : null;
  const tipSol = Number(row?.ema_landed_tips_50th_percentile ?? row?.landed_tips_50th_percentile);
  if (!Number.isFinite(tipSol) || tipSol < 0) throw new Error("jito_tip_unavailable");
  return Math.ceil(tipSol * LAMPORTS_PER_SOL);
}

function usdFromLamports(lamports: number | null, solUsd: number) {
  return Number.isFinite(lamports) && Number.isFinite(solUsd) ? (Number(lamports) / LAMPORTS_PER_SOL) * solUsd : null;
}

function bps(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n >= 0 ? "+" : ""}${n.toFixed(2)} bps` : "—";
}

function money(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(4)}` : "—";
}

function usd(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? `$${Math.abs(n).toFixed(4)}` : "—";
}

function madridTime(value: unknown) {
  const date = new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) return String(value ?? "—");
  try {
    return new Intl.DateTimeFormat("es-ES", {
      timeZone: "Europe/Madrid",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date) + " Madrid";
  } catch {
    return date.toISOString();
  }
}

function humanReason(reason: unknown) {
  const code = String(reason ?? "");
  const labels: Record<string, string> = {
    net_not_positive: "El edge neto no cubre los costes",
    critical_cost_unknown: "Faltan costes críticos · fail-closed",
    context_slot_unknown: "No se pudo verificar el slot de mercado",
    slot_drift: "La cotización quedó desfasada entre slots",
    positive_expected_net_pnl: "Edge neto positivo después de costes",
    rejected: "No supera los gates económicos",
    capture_economics_incomplete: "La recotización PAPER quedó incompleta",
  };
  return (labels[code] ?? code.replaceAll("_", " ")) || "Sin motivo disponible";
}

function decisionLabel(event: any) {
  if (event.type === "OPPORTUNITY_DETECTED" || event.decision === "SHADOW_QUALIFIED") return "🟢 CANDIDATA · PAPER";
  return "⛔ DESCARTADA";
}

function captureStatusLabel(status: unknown) {
  if (status === "CAPTURED") return "✅ CAPTURADO";
  if (status === "DECAYED") return "🟠 EDGE DECAÍDO";
  if (status === "FAILED") return "🔴 FALLÓ";
  return `ℹ️ ${String(status ?? "UNKNOWN")}`;
}

async function telegramRequest(botToken: string, chatId: string, text: string) {
  const response = await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(8_000),
  });
  const body = await response.json().catch(() => null) as { ok?: boolean } | null;
  if (!response.ok || body?.ok !== true) throw new Error(`telegram_${response.status}`);
}

function notificationPreference(event: any) {
  if (event.type === "OPPORTUNITY_DETECTED") return "opportunities";
  if (event.type === "CAPTURE_MEASURED") return "executions";
  if (event.type === "SIMULATION_FAILED") return "important";
  return "debug";
}

function formatTelegramEvent(event: any) {
  if (event.type === "CAPTURE_MEASURED") {
    const capturedPositive = Number(event.capturedNetPnlUsd) > 0;
    return [
      "⚡ GENESIS HQ · PAPER CAPTURE",
      "━━━━━━━━━━━━━━━━━━━━",
      "🔀 RUTA",
      event.route,
      "",
      `🎯 ESPERADO     ${money(event.expectedNetPnlUsd)} · ${bps(event.expectedNetEdgeBps)}`,
      `${capturedPositive ? "✅" : "📉"} CAPTURADO    ${money(event.capturedNetPnlUsd)} · ${bps(event.capturedNetEdgeBps)}`,
      `🌊 EDGE DECAY   ${money(event.quoteDecayUsd)} · ${bps(event.quoteDecayBps)}`,
      `📊 CAPTURE      ${Number.isFinite(Number(event.captureRatio)) ? `${(Number(event.captureRatio) * 100).toFixed(1)}%` : "—"}`,
      "",
      "🧠 RESULTADO",
      captureStatusLabel(event.status),
      "",
      "🛡️ SEGURIDAD",
      "🧪 PAPER ONLY · 🔒 LIVE LOCKED",
      "🚫 Sin transacción real",
      "",
      `🕒 ${madridTime(event.timestamp)}`,
    ].join("\n");
  }

  if (event.type === "SIMULATION_FAILED") {
    return [
      "🚨 GENESIS HQ · PAPER CAPTURE",
      "━━━━━━━━━━━━━━━━━━━━",
      "🔀 RUTA",
      event.route,
      "",
      "❌ RECOTIZACIÓN FALLIDA",
      `⚙️ ${humanReason(event.reason)}`,
      "",
      "🛡️ SEGURIDAD",
      "🚫 No se envió ninguna transacción",
      "🔒 LIVE LOCKED",
      "",
      `🕒 ${madridTime(event.timestamp)}`,
    ].join("\n");
  }

  const opportunity = event.type === "OPPORTUNITY_DETECTED";
  const edgeIcon = Number(event.netEdgeBps) > 0 ? "🟢" : "🔴";
  const costValue = event.estimatedCosts?.totalUsd;
  return [
    opportunity ? "🔥 GENESIS HQ · OPORTUNIDAD SOLANA" : "🛰️ GENESIS HQ · SOLANA SCAN",
    "━━━━━━━━━━━━━━━━━━━━",
    "🔀 RUTA",
    event.route,
    "",
    `💵 CAPITAL       $${Number(event.inputAmountUsd).toFixed(2)}`,
    `📈 EDGE BRUTO    ${bps(event.quotedEdgeBps)}`,
    `💸 COSTES EST.   ${usd(costValue)}`,
    `${edgeIcon} EDGE NETO     ${bps(event.netEdgeBps)}`,
    `💰 PNL NETO      ${money(event.expectedNetPnlUsd)}`,
    "",
    "🧠 VEREDICTO",
    decisionLabel(event),
    `↳ ${humanReason(event.reason)}`,
    "",
    "⚙️ MERCADO",
    `⚡ Quote         ${Number.isFinite(Number(event.quoteLatencyMs)) ? `${Number(event.quoteLatencyMs)} ms` : "—"}`,
    `🧱 Slot drift    ${event.slotDrift ?? "—"}`,
    opportunity ? "🧪 PAPER capture: activado" : "🔎 Sigue buscando edge rentable",
    "",
    "🛡️ SEGURIDAD",
    "👻 SHADOW · 🔒 LIVE LOCKED",
    "🚫 Sin firma · sin transacción · sin capital real",
    "",
    `🕒 ${madridTime(event.timestamp)}`,
  ].join("\n");
}

async function dispatchTelegram(db: Db, event: any) {
  const { data: configs, error } = await db.rpc("genesis_telegram_configs_for_dispatch");
  if (error) throw new Error("telegram_config_store_unavailable");
  let sent = 0, skipped = 0, failed = 0;
  const preference = notificationPreference(event);
  for (const row of configs ?? []) {
    const config = row?.config && typeof row.config === "object" ? row.config : {};
    const notifications = row?.notifications && typeof row.notifications === "object" ? row.notifications : config.notifications ?? {};
    const wants = preference === "opportunities"
      ? notifications.opportunities !== false
      : preference === "executions"
        ? notifications.executions !== false
        : preference === "important"
          ? notifications.important !== false
          : notifications.debug === true;
    if (!wants) { skipped++; continue; }
    const botToken = typeof config.botToken === "string" ? config.botToken.trim() : "";
    const chatId = config.chatId == null ? "" : String(config.chatId).trim();
    if (!botToken || !chatId) { failed++; continue; }
    const eventId = String(event.eventId ?? event.id ?? "").trim();
    if (!eventId) { skipped++; continue; }
    const { data: existing } = await db.from("genesis_telegram_deliveries").select("event_id").eq("owner_hash", row.owner_hash).eq("event_id", eventId).maybeSingle();
    if (existing) { skipped++; continue; }
    try {
      await telegramRequest(botToken, chatId, formatTelegramEvent(event));
      const { error: insertError } = await db.from("genesis_telegram_deliveries").insert({ owner_hash: row.owner_hash, event_id: eventId });
      if (insertError && insertError.code !== "23505") throw insertError;
      sent++;
    } catch {
      failed++;
    }
  }
  return { configs: (configs ?? []).length, sent, skipped, failed };
}

async function calculateEconomics(): Promise<Economics> {
  const first = await jupiterQuote(USDC_MINT, SOL_MINT, BigInt(Math.round(NOTIONAL_USDC * USDC_SCALE)));
  const second = await jupiterQuote(SOL_MINT, USDC_MINT, BigInt(first.quote.outAmount));
  const [priority, jito] = await Promise.allSettled([priorityFeeEvidence(), jitoTipLamports()]);

  const startUsdc = Number(first.quote.inAmount) / USDC_SCALE;
  const solOut = Number(first.quote.outAmount) / LAMPORTS_PER_SOL;
  const endUsdc = Number(second.quote.outAmount) / USDC_SCALE;
  if (![startUsdc, solOut, endUsdc].every(Number.isFinite) || startUsdc <= 0 || solOut <= 0) throw new Error("invalid_cycle_amounts");

  const solUsd = startUsdc / solOut;
  const quotedProfitUsd = endUsdc - startUsdc;
  const quotedEdgeBps = (quotedProfitUsd / startUsdc) * 10_000;
  const slippageReserveUsd = startUsdc * ((SLIPPAGE_BPS_PER_LEG * 2) / 10_000);
  const latencyDegradationUsd = startUsdc * (LATENCY_DEGRADATION_BPS / 10_000);
  const adverseSelectionReserveUsd = startUsdc * (ADVERSE_SELECTION_BPS / 10_000);
  const baseFeeUsd = usdFromLamports(BASE_FEE_LAMPORTS, solUsd);
  const priorityFeeUsd = usdFromLamports(priority.status === "fulfilled" ? priority.value : null, solUsd);
  const jitoTipUsd = usdFromLamports(jito.status === "fulfilled" ? jito.value : null, solUsd);
  const criticalCostsKnown = [baseFeeUsd, priorityFeeUsd, jitoTipUsd].every((v) => Number.isFinite(v));
  const failureReserveUsd = criticalCostsKnown ? (Number(baseFeeUsd) + Number(priorityFeeUsd) + Number(jitoTipUsd)) * FAILURE_PROBABILITY_RESERVE : null;
  const totalCostUsd = criticalCostsKnown
    ? slippageReserveUsd + latencyDegradationUsd + adverseSelectionReserveUsd + Number(baseFeeUsd) + Number(priorityFeeUsd) + Number(jitoTipUsd) + Number(failureReserveUsd)
    : null;
  const netPnlUsd = totalCostUsd == null ? null : quotedProfitUsd - totalCostUsd;
  const netEdgeBps = netPnlUsd == null ? null : (netPnlUsd / startUsdc) * 10_000;
  const firstSlot = Number(first.quote.contextSlot);
  const secondSlot = Number(second.quote.contextSlot);
  const slotDrift = Number.isFinite(firstSlot) && Number.isFinite(secondSlot) ? Math.abs(secondSlot - firstSlot) : null;
  const blockers: string[] = [];
  if (!criticalCostsKnown) blockers.push("critical_cost_unknown");
  if (slotDrift == null) blockers.push("context_slot_unknown");
  else if (slotDrift > MAX_SLOT_DRIFT) blockers.push("slot_drift");
  if (netPnlUsd == null || netPnlUsd <= 0) blockers.push("net_not_positive");

  const firstVenues = venueLabels(first.quote);
  const secondVenues = venueLabels(second.quote);
  const route = `${firstVenues.join(" · ") || "Jupiter"} → ${secondVenues.join(" · ") || "Jupiter"}`;
  return {
    startUsdc,
    endUsdc,
    solOut,
    solUsd,
    quotedProfitUsd,
    quotedEdgeBps,
    netPnlUsd,
    netEdgeBps,
    totalCostUsd,
    firstVenues,
    secondVenues,
    route,
    quoteLatencyMs: first.latencyMs + second.latencyMs,
    slot: Number.isFinite(secondSlot) ? secondSlot : null,
    slotDrift,
    blockers,
    costs: {
      totalUsd: totalCostUsd,
      baseFeeUsd,
      priorityFeeUsd,
      jitoTipUsd,
      slippageReserveUsd,
      latencyDegradationUsd,
      adverseSelectionReserveUsd,
      failureReserveUsd,
    },
    evidenceErrors: {
      priorityFee: priority.status === "rejected" ? String((priority.reason as any)?.message ?? priority.reason) : null,
      jitoTip: jito.status === "rejected" ? String((jito.reason as any)?.message ?? jito.reason) : null,
    },
  };
}

async function persistObservation(db: Db, event: any) {
  const { error } = await db.from("solana_arbitrage_observations").insert({
    event_id: event.eventId,
    observed_at: event.observedAt,
    source: "supabase_pgcron",
    route: event.route,
    venues: event.venues,
    input_usd: event.inputAmountUsd,
    quoted_output_usdc: event.quotedOutputUsd,
    quoted_edge_bps: event.quotedEdgeBps,
    net_edge_bps: event.netEdgeBps,
    expected_net_pnl_usd: event.expectedNetPnlUsd,
    total_cost_usd: event.estimatedCosts?.totalUsd ?? null,
    quote_latency_ms: event.quoteLatencyMs,
    slot: event.slot,
    slot_drift: event.slotDrift,
    decision: event.decision,
    reason: event.reason,
    blockers: event.blockers,
    cost_model: event.estimatedCosts,
    mode: "SHADOW",
    execution_authority: false,
    live_locked: true,
    raw_event: event,
  });
  if (error) throw new Error(`observation_store_failed:${error.code}`);
}

async function persistCapture(db: Db, opportunityEvent: any, capture: any) {
  const { error } = await db.from("solana_paper_captures").insert({
    opportunity_event_id: opportunityEvent.eventId,
    captured_at: capture.timestamp,
    route: opportunityEvent.route,
    expected_net_pnl_usd: opportunityEvent.expectedNetPnlUsd,
    expected_net_edge_bps: opportunityEvent.netEdgeBps,
    captured_net_pnl_usd: capture.capturedNetPnlUsd,
    captured_net_edge_bps: capture.capturedNetEdgeBps,
    quote_decay_usd: capture.quoteDecayUsd,
    quote_decay_bps: capture.quoteDecayBps,
    capture_ratio: capture.captureRatio,
    initial_quote_end_usdc: opportunityEvent.quotedOutputUsd,
    capture_quote_end_usdc: capture.captureQuoteEndUsdc,
    initial_cost_usd: opportunityEvent.estimatedCosts?.totalUsd ?? null,
    capture_cost_usd: capture.captureCostUsd,
    initial_slot: opportunityEvent.slot,
    capture_slot: capture.captureSlot,
    slot_drift: capture.captureSlotDrift,
    venues: opportunityEvent.venues,
    capture_venues: capture.captureVenues,
    status: capture.status,
    failure_reason: capture.failureReason ?? null,
    mode: "PAPER",
    execution_authority: false,
    live_locked: true,
    raw_capture: capture,
  });
  if (error) throw new Error(`capture_store_failed:${error.code}`);
}

async function persistLatest(db: Db, payload: unknown) {
  await db.from("org_state").upsert({
    key: "solana_arbitrage_supabase_observer_v2",
    value: JSON.stringify(payload),
    updated_at: new Date().toISOString(),
  }, { onConflict: "key" });
}

async function paperCapture(db: Db, opportunityEvent: any) {
  await sleep(PAPER_CAPTURE_DELAY_MS);
  try {
    const economics = await calculateEconomics();
    const captured = Number(economics.netPnlUsd);
    const expected = Number(opportunityEvent.expectedNetPnlUsd);
    const capturedEdge = economics.netEdgeBps;
    const expectedEdge = Number(opportunityEvent.netEdgeBps);
    const capturedFinite = Number.isFinite(captured) && Number.isFinite(Number(capturedEdge));
    if (!capturedFinite) throw new Error("capture_economics_incomplete");
    const quoteDecayUsd = expected - captured;
    const quoteDecayBps = expectedEdge - Number(capturedEdge);
    const captureRatio = expected > 0 ? captured / expected : null;
    const captureEventId = `paper-capture-${crypto.randomUUID()}`;
    const capture = {
      eventId: captureEventId,
      id: captureEventId,
      type: "CAPTURE_MEASURED",
      chain: "SOLANA",
      mode: "PAPER",
      executionAuthority: false,
      liveLocked: true,
      timestamp: new Date().toISOString(),
      route: opportunityEvent.route,
      expectedNetPnlUsd: expected,
      expectedNetEdgeBps: expectedEdge,
      capturedNetPnlUsd: captured,
      capturedNetEdgeBps: Number(capturedEdge),
      quoteDecayUsd,
      quoteDecayBps,
      captureRatio,
      captureQuoteEndUsdc: economics.endUsdc,
      captureCostUsd: economics.totalCostUsd,
      captureSlot: economics.slot,
      captureSlotDrift: economics.slotDrift,
      captureVenues: [...economics.firstVenues, ...economics.secondVenues],
      actualSlippageBps: quoteDecayBps,
      actualFeesUsd: economics.totalCostUsd,
      status: captured > 0 ? "CAPTURED" : "DECAYED",
      failureReason: null,
    };
    await persistCapture(db, opportunityEvent, capture);
    const telegram = await dispatchTelegram(db, capture);
    return { ok: true, ...capture, telegram };
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : String(error);
    const failed = {
      eventId: `paper-capture-failed-${crypto.randomUUID()}`,
      id: `paper-capture-failed-${crypto.randomUUID()}`,
      type: "SIMULATION_FAILED",
      chain: "SOLANA",
      mode: "PAPER",
      executionAuthority: false,
      liveLocked: true,
      timestamp: new Date().toISOString(),
      route: opportunityEvent.route,
      reason: failureReason,
    };
    try {
      await persistCapture(db, opportunityEvent, {
        ...failed,
        expectedNetPnlUsd: opportunityEvent.expectedNetPnlUsd,
        expectedNetEdgeBps: opportunityEvent.netEdgeBps,
        capturedNetPnlUsd: null,
        capturedNetEdgeBps: null,
        quoteDecayUsd: null,
        quoteDecayBps: null,
        captureRatio: null,
        captureQuoteEndUsdc: null,
        captureCostUsd: null,
        captureSlot: null,
        captureSlotDrift: null,
        captureVenues: [],
        status: "FAILED",
        failureReason,
      });
    } catch {
      // Preserve the original capture failure; ledger failure is surfaced in the returned payload below.
    }
    const telegram = await dispatchTelegram(db, failed).catch(() => ({ configs: 0, sent: 0, skipped: 0, failed: 1 }));
    return { ok: false, ...failed, telegram };
  }
}

async function scanOnce() {
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const startedAt = new Date().toISOString();
  const economics = await calculateEconomics();
  const qualified = economics.blockers.length === 0 && Number(economics.netPnlUsd) > 0;
  const eventId = `supabase-sol-${crypto.randomUUID()}`;
  const event = {
    runId: startedAt,
    eventId,
    id: eventId,
    timestamp: new Date().toISOString(),
    observedAt: new Date().toISOString(),
    type: qualified ? "OPPORTUNITY_DETECTED" : "REJECTED",
    chain: "SOLANA",
    mode: "SHADOW",
    executionAuthority: false,
    liveLocked: true,
    route: economics.route,
    tokens: ["USDC", "SOL", "USDC"],
    mints: [USDC_MINT, SOL_MINT],
    venues: [...economics.firstVenues, ...economics.secondVenues],
    inputAmountUsd: economics.startUsdc,
    quotedOutputUsd: economics.endUsdc,
    grossEdgeBps: economics.quotedEdgeBps,
    quotedEdgeBps: economics.quotedEdgeBps,
    netEdgeBps: economics.netEdgeBps,
    expectedNetPnlUsd: economics.netPnlUsd,
    decision: qualified ? "SHADOW_QUALIFIED" : "REJECTED",
    reason: qualified ? "positive_expected_net_pnl" : economics.blockers[0] ?? "rejected",
    blockers: economics.blockers,
    quoteLatencyMs: economics.quoteLatencyMs,
    slot: economics.slot,
    slotDrift: economics.slotDrift,
    estimatedCosts: economics.costs,
  };

  await persistObservation(db, event);
  const telegram = await dispatchTelegram(db, event);
  const capture = qualified ? await paperCapture(db, event) : null;
  const result = {
    ok: true,
    source: "supabase_pgcron",
    mode: "SHADOW",
    executionAuthority: false,
    liveLocked: true,
    event,
    telegram,
    capture,
    evidenceErrors: economics.evidenceErrors,
  };
  await persistLatest(db, result);
  return result;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json(200, { ok: true });
  if (!["GET", "POST"].includes(req.method)) return json(405, { ok: false, error: "method_not_allowed" });
  if (!SERVICE_KEY) return json(503, { ok: false, error: "service_key_unavailable" });
  if (!await authorized(req)) return json(403, { ok: false, error: "runner_auth_invalid" });
  try {
    return json(200, await scanOnce());
  } catch (error) {
    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const failure = {
      ok: false,
      source: "supabase_pgcron",
      mode: "SHADOW",
      executionAuthority: false,
      liveLocked: true,
      error: error instanceof Error ? error.message : String(error),
      observedAt: new Date().toISOString(),
    };
    await persistLatest(db, failure).catch(() => null);
    return json(500, failure);
  }
});
