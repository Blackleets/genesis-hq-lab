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

function formatScan(event: any) {
  const title = event.type === "OPPORTUNITY_DETECTED" ? "🔥 GENESIS · SOLANA OPPORTUNITY" : "🛰️ GENESIS · SOLANA SCAN";
  return [
    title,
    "",
    `Route:\n${event.route}`,
    "",
    `Capital:\n$${Number(event.inputAmountUsd).toFixed(2)}`,
    "",
    `Quoted Edge:\n${bps(event.quotedEdgeBps)}`,
    "",
    `Net Edge:\n${bps(event.netEdgeBps)}`,
    "",
    `Expected Net:\n${money(event.expectedNetPnlUsd)}`,
    "",
    `Decision:\n${event.decision}`,
    "",
    `Reason:\n${event.reason}`,
    "",
    "LIVE: LOCKED · SHADOW/PAPER",
    "",
    event.timestamp,
  ].join("\n");
}

async function persistLatest(db: ReturnType<typeof createClient>, payload: unknown) {
  await db.from("org_state").upsert({
    key: "solana_arbitrage_supabase_observer_v1",
    value: JSON.stringify(payload),
    updated_at: new Date().toISOString(),
  }, { onConflict: "key" });
}

async function dispatchTelegram(db: ReturnType<typeof createClient>, event: any) {
  const { data: configs, error } = await db.rpc("genesis_telegram_configs_for_dispatch");
  if (error) throw new Error("telegram_config_store_unavailable");
  let sent = 0, skipped = 0, failed = 0;
  for (const row of configs ?? []) {
    const config = row?.config && typeof row.config === "object" ? row.config : {};
    const notifications = row?.notifications && typeof row.notifications === "object" ? row.notifications : config.notifications ?? {};
    const wants = event.type === "OPPORTUNITY_DETECTED" ? notifications.opportunities !== false : notifications.debug === true;
    if (!wants) { skipped++; continue; }
    const botToken = typeof config.botToken === "string" ? config.botToken.trim() : "";
    const chatId = config.chatId == null ? "" : String(config.chatId).trim();
    if (!botToken || !chatId) { failed++; continue; }
    const { data: existing } = await db.from("genesis_telegram_deliveries").select("event_id").eq("owner_hash", row.owner_hash).eq("event_id", event.eventId).maybeSingle();
    if (existing) { skipped++; continue; }
    try {
      await telegramRequest(botToken, chatId, formatScan(event));
      const { error: insertError } = await db.from("genesis_telegram_deliveries").insert({ owner_hash: row.owner_hash, event_id: event.eventId });
      if (insertError && insertError.code !== "23505") throw insertError;
      sent++;
    } catch {
      failed++;
    }
  }
  return { configs: (configs ?? []).length, sent, skipped, failed };
}

async function scanOnce() {
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const startedAt = new Date().toISOString();
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
  const netPnlUsd = criticalCostsKnown
    ? quotedProfitUsd - slippageReserveUsd - latencyDegradationUsd - adverseSelectionReserveUsd - Number(baseFeeUsd) - Number(priorityFeeUsd) - Number(jitoTipUsd) - Number(failureReserveUsd)
    : null;
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
  const qualified = blockers.length === 0 && Number(netPnlUsd) > 0;
  const event = {
    runId: startedAt,
    eventId: `supabase-sol-${crypto.randomUUID()}`,
    id: `supabase-sol-${crypto.randomUUID()}`,
    timestamp: new Date().toISOString(),
    observedAt: new Date().toISOString(),
    type: qualified ? "OPPORTUNITY_DETECTED" : "REJECTED",
    chain: "SOLANA",
    mode: "SHADOW",
    executionAuthority: false,
    liveLocked: true,
    route,
    tokens: ["USDC", "SOL", "USDC"],
    mints: [USDC_MINT, SOL_MINT],
    venues: [...firstVenues, ...secondVenues],
    inputAmountUsd: startUsdc,
    quotedOutputUsd: endUsdc,
    grossEdgeBps: quotedEdgeBps,
    quotedEdgeBps,
    netEdgeBps,
    expectedNetPnlUsd: netPnlUsd,
    decision: qualified ? "SHADOW_QUALIFIED" : "REJECTED",
    reason: qualified ? "positive_expected_net_pnl" : blockers[0] ?? "rejected",
    blockers,
    quoteLatencyMs: first.latencyMs + second.latencyMs,
    slot: Number.isFinite(secondSlot) ? secondSlot : null,
    slotDrift,
    estimatedCosts: {
      totalUsd: netPnlUsd == null ? null : quotedProfitUsd - netPnlUsd,
      baseFeeUsd,
      priorityFeeUsd,
      jitoTipUsd,
      slippageReserveUsd,
      latencyDegradationUsd,
      adverseSelectionReserveUsd,
      failureReserveUsd,
    },
  };

  const telegram = await dispatchTelegram(db, event);
  const result = {
    ok: true,
    source: "supabase_pgcron",
    mode: "SHADOW",
    executionAuthority: false,
    liveLocked: true,
    event,
    telegram,
    evidenceErrors: {
      priorityFee: priority.status === "rejected" ? String(priority.reason?.message ?? priority.reason) : null,
      jitoTip: jito.status === "rejected" ? String(jito.reason?.message ?? jito.reason) : null,
    },
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
