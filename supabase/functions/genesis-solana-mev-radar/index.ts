import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const RUNNER_TOKEN_SHA256 = "e9f02987e836a6eaf8ef8d7afaed805580cd31264aef5ed86fc3ebb756c59d91";

const JUPITER_QUOTE_URL = "https://lite-api.jup.ag/swap/v1/quote";
const JUPITER_SWAP_INSTRUCTIONS_URL = "https://lite-api.jup.ag/swap/v1/swap-instructions";
const SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
const JITO_TIP_URL = "https://bundles.jito.wtf/api/v1/bundles/tip_floor";
const BINANCE_SOL_URL = "https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT";
const TELEGRAM_API = "https://api.telegram.org";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_SCALE = 1_000_000;
const LAMPORTS_PER_SOL = 1_000_000_000;
const NOTIONAL_GRID = [10, 25, 50, 100, 250] as const;
const TOKENS = [
  { symbol: "SOL", mint: SOL_MINT, dexes: ["HumidiFi", "Flux", "BisonFi", "Quantum", "Raydium CLMM", "Raydium CP"] },
  { symbol: "JUP", mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", dexes: ["Raydium CLMM", "Raydium CP", "Orca V2", "Whirlpool", "Meteora DLMM", "HumidiFi"] },
  { symbol: "WIF", mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", dexes: ["Raydium CLMM", "Raydium CP", "Orca V2", "Whirlpool", "Meteora DLMM", "HumidiFi"] },
  { symbol: "mSOL", mint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", dexes: ["Sanctum Infinity", "Sanctum", "Whirlpool", "Orca V2", "Meteora DLMM", "Raydium CLMM"] },
  { symbol: "JitoSOL", mint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", dexes: ["Sanctum Infinity", "Sanctum", "Whirlpool", "Orca V2", "Meteora DLMM", "Raydium CLMM"] },
  { symbol: "RAY", mint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", dexes: ["Raydium CLMM", "Raydium CP", "Orca V2", "Whirlpool", "Meteora DLMM", "HumidiFi"] },
  { symbol: "PYTH", mint: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3", dexes: ["Raydium CLMM", "Raydium CP", "Orca V2", "Whirlpool", "Meteora DLMM", "HumidiFi"] },
  { symbol: "POPCAT", mint: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr", dexes: ["Raydium CLMM", "Raydium CP", "Orca V2", "Whirlpool", "Meteora DLMM", "HumidiFi"] },
] as const;

const ENGINE_VERSION = "edge_discovery_paper_v2";
const QUOTE_CONCURRENCY = 1;
const DEXES_PER_RUN = 3;
const DEX_ROTATION_MS = 120_000;
const SLIPPAGE_BPS_PER_LEG = 10;
const LATENCY_DEGRADATION_BPS = 5;
const ADVERSE_SELECTION_BPS = 5;
const FAILURE_PROBABILITY_RESERVE = 0.10;
const COMPUTE_UNIT_LIMIT = 1_000_000;
const BASE_FEE_LAMPORTS = 5_000;
const PRIORITY_FEE_PERCENTILE = 0.75;
const MAX_SLOT_DRIFT = 4;
const REQUEST_TIMEOUT_MS = 5_000;
const DECAY_HORIZONS_MS = [250, 500, 1000] as const;
const MIN_CAPTURE_PNL_USD = 0.01;
const OBSERVER_PUBLIC_KEY = Deno.env.get("GENESIS_SOLANA_OBSERVER_PUBLIC_KEY") || "";

type Db = ReturnType<typeof createClient>;
type TokenSpec = typeof TOKENS[number];
type QuoteLeg = { dex: string; quote: any; latencyMs: number; receivedAtMs: number };
type PriorityFeeEvidence = { source: string; localized: boolean; writableAccountCount: number; percentile: number; microLamportsPerCu: number; computeUnitLimit: number; priorityFeeLamports: number; rpcLatencyMs: number; rpcTier: string };
type CostEvidence = { priority: PromiseSettledResult<PriorityFeeEvidence>; jito: PromiseSettledResult<number>; solUsd: number; solPriceSource: string };
type PairEconomics = {
  token: TokenSpec; buyDex: string; sellDex: string; startUsdc: number; endUsdc: number;
  quotedEdgeBps: number; quotedProfitUsd: number; netPnlUsd: number | null; netEdgeBps: number | null;
  totalCostUsd: number | null; costBps: number | null; breakEvenGrossEdgeBps: number | null;
  quoteLatencyMs: number; slot: number | null; slotDrift: number | null;
  blockers: string[]; costs: Record<string, number | null>; evidenceErrors: { priorityFee: string | null; jitoTip: string | null };
  priorityFeeEvidence: PriorityFeeEvidence | null; atomicPreflight: Record<string, unknown>;
};
type ProbeResult = { token: TokenSpec; notionalUsd: number; activeDexes: string[]; candidates: PairEconomics[]; buyQuoteCount: number; pairAttempts: number; errors: string[] };
type GridProbeResult = {
  token: TokenSpec; activeDexes: string[]; candidates: PairEconomics[]; buyQuoteCount: number; pairAttempts: number; errors: string[];
  sizingCurve: Array<{ notionalUsd: number; route: string | null; grossEdgeBps: number | null; netEdgeBps: number | null; netPnlUsd: number | null; totalCostUsd: number | null }>;
};

function json(status: number, body: unknown) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }); }
async function sha256Hex(value: string) { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
async function authorized(req: Request) { const supplied = (req.headers.get("x-genesis-runner-token") || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "").trim(); return Boolean(supplied) && await sha256Hex(supplied) === RUNNER_TOKEN_SHA256; }
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS) { const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) }); if (!response.ok) { const body = await response.text().catch(() => ""); throw new Error(`http_${response.status}${body ? `:${body.slice(0, 120)}` : ""}`); } return await response.json(); }
function quantile(values: number[], p: number) { const clean = values.filter(Number.isFinite).sort((a, b) => a - b); if (!clean.length) return null; return clean[Math.min(clean.length - 1, Math.max(0, Math.ceil(p * clean.length) - 1))]; }
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> { const results: PromiseSettledResult<R>[] = new Array(items.length); let cursor = 0; async function worker() { while (true) { const index = cursor++; if (index >= items.length) return; try { results[index] = { status: "fulfilled", value: await fn(items[index]) }; } catch (reason) { results[index] = { status: "rejected", reason }; } } } await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker())); return results; }
function bps(value: unknown) { const n = Number(value); return Number.isFinite(n) ? `${n >= 0 ? "+" : ""}${n.toFixed(2)} bps` : "—"; }
function money(value: unknown) { const n = Number(value); return Number.isFinite(n) ? `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(4)}` : "—"; }
function usd(value: unknown) { const n = Number(value); return Number.isFinite(n) ? `$${Math.abs(n).toFixed(4)}` : "—"; }
function madridTime(value: unknown) { const date = new Date(String(value ?? "")); if (Number.isNaN(date.getTime())) return String(value ?? "—"); return new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date) + " Madrid"; }
function candidateScore(candidate: PairEconomics) { const pnl = Number(candidate.netPnlUsd); if (Number.isFinite(pnl)) return pnl; const edge = Number(candidate.netEdgeBps); if (Number.isFinite(edge)) return edge / 10_000; return Number(candidate.quotedProfitUsd) || -Infinity; }

async function jupiterDexQuote(inputMint: string, outputMint: string, amountRaw: bigint, dex: string): Promise<QuoteLeg> {
  const params = new URLSearchParams({ inputMint, outputMint, amount: String(amountRaw), slippageBps: String(SLIPPAGE_BPS_PER_LEG), restrictIntermediateTokens: "true", onlyDirectRoutes: "true", dexes: dex, instructionVersion: "V2" });
  const started = Date.now();
  let quote: any;
  try { quote = await fetchJson(`${JUPITER_QUOTE_URL}?${params}`); }
  catch (error) { if (!String((error as any)?.message ?? error).startsWith("http_429")) throw error; await sleep(750); quote = await fetchJson(`${JUPITER_QUOTE_URL}?${params}`); }
  if (!quote?.inAmount || !quote?.outAmount || !Array.isArray(quote?.routePlan)) throw new Error(`invalid_quote:${dex}`);
  return { dex, quote, latencyMs: Date.now() - started, receivedAtMs: Date.now() };
}
function validPublicKey(value: unknown) { return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(value ?? "")); }
function instructionList(body: any) { return [...(body?.computeBudgetInstructions ?? []), ...(body?.setupInstructions ?? []), body?.swapInstruction, body?.cleanupInstruction, ...(body?.otherInstructions ?? [])].filter(Boolean); }
function validateInstruction(value: any) { return validPublicKey(value?.programId) && typeof value?.data === "string" && Array.isArray(value?.accounts) && value.accounts.every((account: any) => validPublicKey(account?.pubkey)); }
async function jupiterSwapInstructions(quote: any) { if (!validPublicKey(OBSERVER_PUBLIC_KEY)) throw new Error("observer_public_key_not_configured"); const body = await fetchJson(JUPITER_SWAP_INSTRUCTIONS_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userPublicKey: OBSERVER_PUBLIC_KEY, quoteResponse: quote, wrapAndUnwrapSol: false, useSharedAccounts: true, dynamicComputeUnitLimit: false, skipUserAccountsRpcCalls: true }) }); if (!body?.swapInstruction || !instructionList(body).every(validateInstruction)) throw new Error("invalid_jupiter_swap_instructions"); return body; }
function writableAccounts(...sets: any[]) { return [...new Set(sets.flatMap((body) => instructionList(body)).flatMap((instruction) => instruction.accounts ?? []).filter((account) => account?.isWritable === true && validPublicKey(account?.pubkey)).map((account) => String(account.pubkey)))].slice(0, 128); }
async function priorityFeeEvidence(accounts: string[] = []) { const started = Date.now(); const body = await fetchJson(SOLANA_RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getRecentPrioritizationFees", params: [accounts] }) }); if (!Array.isArray(body?.result)) throw new Error("priority_fee_unavailable"); const microLamportsPerCu = quantile(body.result.map((row: any) => Number(row?.prioritizationFee)), PRIORITY_FEE_PERCENTILE); if (!Number.isFinite(microLamportsPerCu)) throw new Error("priority_fee_unavailable"); return { source: "solana_getRecentPrioritizationFees", localized: accounts.length > 0, writableAccountCount: accounts.length, percentile: PRIORITY_FEE_PERCENTILE, microLamportsPerCu: Number(microLamportsPerCu), computeUnitLimit: COMPUTE_UNIT_LIMIT, priorityFeeLamports: Math.ceil((Number(microLamportsPerCu) * COMPUTE_UNIT_LIMIT) / 1_000_000), rpcLatencyMs: Date.now() - started, rpcTier: "FREE_ONLY" }; }
async function jitoTipLamports() { const body = await fetchJson(JITO_TIP_URL); const row = Array.isArray(body) ? body[0] : null; const tipSol = Number(row?.ema_landed_tips_50th_percentile ?? row?.landed_tips_50th_percentile); if (!Number.isFinite(tipSol) || tipSol < 0) throw new Error("jito_tip_unavailable"); return Math.ceil(tipSol * LAMPORTS_PER_SOL); }
function usdFromLamports(lamports: number | null, solUsd: number) { return Number.isFinite(lamports) && Number.isFinite(solUsd) ? (Number(lamports) / LAMPORTS_PER_SOL) * solUsd : null; }
async function solUsdEvidence(db: Db) { try { const body = await fetchJson(BINANCE_SOL_URL, {}, 4_000); const price = Number(body?.price); if (Number.isFinite(price) && price > 0) return { price, source: "binance_SOLUSDT" }; } catch {} const { data } = await db.from("solana_arbitrage_observations").select("observed_at,cost_model").order("observed_at", { ascending: false }).limit(20); for (const row of data ?? []) { const baseFeeUsd = Number((row as any)?.cost_model?.baseFeeUsd); if (Number.isFinite(baseFeeUsd) && baseFeeUsd > 0) { const price = baseFeeUsd * LAMPORTS_PER_SOL / BASE_FEE_LAMPORTS; if (Number.isFinite(price) && price > 0) return { price, source: "ledger_base_fee" }; } } throw new Error("sol_usd_unavailable"); }
async function loadCostEvidence(db: Db): Promise<CostEvidence> { const [priority, jito, sol] = await Promise.all([Promise.allSettled([priorityFeeEvidence()]).then((x) => x[0]), Promise.allSettled([jitoTipLamports()]).then((x) => x[0]), solUsdEvidence(db)]); return { priority, jito, solUsd: sol.price, solPriceSource: sol.source }; }

async function evaluatePair(token: TokenSpec, buyDex: string, sellDex: string, notionalUsd: number, evidence: CostEvidence, prefetchedBuy?: QuoteLeg, requireLocalizedEvidence = false): Promise<PairEconomics> {
  const amountRaw = BigInt(Math.round(notionalUsd * USDC_SCALE));
  const buy = prefetchedBuy ?? await jupiterDexQuote(USDC_MINT, token.mint, amountRaw, buyDex);
  const sell = await jupiterDexQuote(token.mint, USDC_MINT, BigInt(buy.quote.outAmount), sellDex);
  const startUsdc = Number(buy.quote.inAmount) / USDC_SCALE;
  const endUsdc = Number(sell.quote.outAmount) / USDC_SCALE;
  if (![startUsdc, endUsdc].every(Number.isFinite) || startUsdc <= 0) throw new Error("invalid_cycle_amounts");
  const quotedProfitUsd = endUsdc - startUsdc;
  const quotedEdgeBps = (quotedProfitUsd / startUsdc) * 10_000;
  const grossPositive = quotedProfitUsd > 0;
  let priority = evidence.priority;
  let accounts: string[] = [];
  let atomicPlanValidated = false;
  if (requireLocalizedEvidence && grossPositive) {
    try {
      const [buyInstructions, sellInstructions] = await Promise.all([jupiterSwapInstructions(buy.quote), jupiterSwapInstructions(sell.quote)]);
      accounts = writableAccounts(buyInstructions, sellInstructions);
      if (!accounts.length) throw new Error("route_writable_accounts_missing");
      priority = { status: "fulfilled", value: await priorityFeeEvidence(accounts) };
      atomicPlanValidated = true;
    } catch (reason) { priority = { status: "rejected", reason }; }
  }
  const slippageReserveUsd = startUsdc * ((SLIPPAGE_BPS_PER_LEG * 2) / 10_000);
  const latencyDegradationUsd = startUsdc * (LATENCY_DEGRADATION_BPS / 10_000);
  const adverseSelectionReserveUsd = startUsdc * (ADVERSE_SELECTION_BPS / 10_000);
  const baseFeeUsd = usdFromLamports(BASE_FEE_LAMPORTS, evidence.solUsd);
  const priorityFeeUsd = usdFromLamports(priority.status === "fulfilled" ? priority.value.priorityFeeLamports : null, evidence.solUsd);
  const jitoTipUsd = usdFromLamports(evidence.jito.status === "fulfilled" ? evidence.jito.value : null, evidence.solUsd);
  const criticalCostsKnown = [baseFeeUsd, priorityFeeUsd, jitoTipUsd].every(Number.isFinite);
  const failureReserveUsd = criticalCostsKnown ? (Number(baseFeeUsd) + Number(priorityFeeUsd) + Number(jitoTipUsd)) * FAILURE_PROBABILITY_RESERVE : null;
  const modeledReserveUsd = slippageReserveUsd + latencyDegradationUsd + adverseSelectionReserveUsd;
  const hardNetworkUsd = Number.isFinite(baseFeeUsd) && Number.isFinite(priorityFeeUsd) ? Number(baseFeeUsd) + Number(priorityFeeUsd) : null;
  const totalCostUsd = criticalCostsKnown ? modeledReserveUsd + Number(baseFeeUsd) + Number(priorityFeeUsd) + Number(jitoTipUsd) + Number(failureReserveUsd) : null;
  const costBps = totalCostUsd == null ? null : (totalCostUsd / startUsdc) * 10_000;
  const netPnlUsd = totalCostUsd == null ? null : quotedProfitUsd - totalCostUsd;
  const netEdgeBps = netPnlUsd == null ? null : (netPnlUsd / startUsdc) * 10_000;
  const firstSlot = Number(buy.quote.contextSlot);
  const secondSlot = Number(sell.quote.contextSlot);
  const slotDrift = Number.isFinite(firstSlot) && Number.isFinite(secondSlot) ? Math.abs(secondSlot - firstSlot) : null;
  const blockers: string[] = [];
  if (!grossPositive) blockers.push("gross_not_positive");
  if (requireLocalizedEvidence && grossPositive && !atomicPlanValidated) blockers.push("atomic_plan_missing");
  if (!criticalCostsKnown) blockers.push("critical_cost_unknown");
  if (slotDrift == null) blockers.push("context_slot_unknown"); else if (slotDrift > MAX_SLOT_DRIFT) blockers.push("slot_drift");
  if (netPnlUsd == null || netPnlUsd <= 0) blockers.push("net_not_positive");
  return {
    token, buyDex, sellDex, startUsdc, endUsdc, quotedEdgeBps, quotedProfitUsd, netPnlUsd, netEdgeBps,
    totalCostUsd, costBps, breakEvenGrossEdgeBps: costBps, quoteLatencyMs: buy.latencyMs + sell.latencyMs,
    slot: Number.isFinite(secondSlot) ? secondSlot : null, slotDrift, blockers,
    costs: { totalUsd: totalCostUsd, conservativeTotalUsd: totalCostUsd, hardNetworkUsd, optionalJitoUsd: jitoTipUsd, modeledReserveUsd, baseFeeUsd, priorityFeeUsd, jitoTipUsd, slippageReserveUsd, latencyDegradationUsd, adverseSelectionReserveUsd, failureReserveUsd },
    evidenceErrors: { priorityFee: priority.status === "rejected" ? String((priority.reason as any)?.message ?? priority.reason) : null, jitoTip: evidence.jito.status === "rejected" ? String((evidence.jito.reason as any)?.message ?? evidence.jito.reason) : null },
    priorityFeeEvidence: priority.status === "fulfilled" ? priority.value : null,
    atomicPreflight: { version: "cents-hunter-atomic-plan-v2", validated: atomicPlanValidated, skippedBecauseGrossNonPositive: requireLocalizedEvidence && !grossPositive, instructionSets: atomicPlanValidated ? 2 : 0, writableAccountCount: accounts.length, balanceRequired: false, transactionSimulationAttempted: false, signs: false, broadcasts: false, executionAuthority: false, liveLocked: true },
  };
}

function activeDexesFor(token: TokenSpec) {
  const rotation = Math.floor(Date.now() / DEX_ROTATION_MS) % token.dexes.length;
  return Array.from({ length: Math.min(DEXES_PER_RUN, token.dexes.length) }, (_, index) => token.dexes[(rotation + index) % token.dexes.length]);
}

async function probeToken(token: TokenSpec, notionalUsd: number, evidence: CostEvidence, activeDexes: readonly string[]): Promise<ProbeResult> {
  const amountRaw = BigInt(Math.round(notionalUsd * USDC_SCALE));
  const errors: string[] = [];
  const buyResults = await mapLimit(activeDexes, QUOTE_CONCURRENCY, (dex) => jupiterDexQuote(USDC_MINT, token.mint, amountRaw, dex));
  const buyQuotes: QuoteLeg[] = [];
  buyResults.forEach((result, i) => { if (result.status === "fulfilled") buyQuotes.push(result.value); else errors.push(`BUY ${activeDexes[i]}:${result.reason instanceof Error ? result.reason.message : String(result.reason)}`); });
  if (!buyQuotes.length) return { token, notionalUsd, activeDexes: [...activeDexes], candidates: [], buyQuoteCount: 0, pairAttempts: 0, errors };
  const tasks: { buy: QuoteLeg; sellDex: string }[] = [];
  for (const buy of buyQuotes) for (const sellDex of activeDexes) if (sellDex !== buy.dex) tasks.push({ buy, sellDex });
  const pairResults = await mapLimit(tasks, QUOTE_CONCURRENCY, ({ buy, sellDex }) => evaluatePair(token, buy.dex, sellDex, notionalUsd, evidence, buy));
  const candidates: PairEconomics[] = [];
  pairResults.forEach((result, i) => { if (result.status === "fulfilled") candidates.push(result.value); else { const task = tasks[i]; errors.push(`${task.buy.dex}->${task.sellDex}:${result.reason instanceof Error ? result.reason.message : String(result.reason)}`); } });
  candidates.sort((a, b) => candidateScore(b) - candidateScore(a));
  return { token, notionalUsd, activeDexes: [...activeDexes], candidates, buyQuoteCount: buyQuotes.length, pairAttempts: tasks.length, errors };
}

async function probeTokenGrid(token: TokenSpec, evidence: CostEvidence): Promise<GridProbeResult> {
  const activeDexes = activeDexesFor(token);
  const candidates: PairEconomics[] = [];
  const errors: string[] = [];
  const sizingCurve: GridProbeResult["sizingCurve"] = [];
  let buyQuoteCount = 0;
  let pairAttempts = 0;
  for (const notionalUsd of NOTIONAL_GRID) {
    const probe = await probeToken(token, notionalUsd, evidence, activeDexes);
    buyQuoteCount += probe.buyQuoteCount;
    pairAttempts += probe.pairAttempts;
    errors.push(...probe.errors.map((error) => `$${notionalUsd}:${error}`));
    candidates.push(...probe.candidates);
    const best = probe.candidates[0] ?? null;
    sizingCurve.push({ notionalUsd, route: best ? `${best.buyDex} → ${best.sellDex}` : null, grossEdgeBps: best?.quotedEdgeBps ?? null, netEdgeBps: best?.netEdgeBps ?? null, netPnlUsd: best?.netPnlUsd ?? null, totalCostUsd: best?.totalCostUsd ?? null });
  }
  candidates.sort((a, b) => candidateScore(b) - candidateScore(a));
  return { token, activeDexes, candidates, buyQuoteCount, pairAttempts, errors, sizingCurve };
}

async function telegramRequest(botToken: string, chatId: string, text: string) { const response = await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }), signal: AbortSignal.timeout(8_000) }); const body = await response.json().catch(() => null) as { ok?: boolean } | null; if (!response.ok || body?.ok !== true) throw new Error(`telegram_${response.status}`); }
function formatRadar(event: any) {
  const qualified = event.type === "OPPORTUNITY_DETECTED";
  const netPositive = Number(event.netEdgeBps) > 0;
  const grossPositive = Number(event.quotedEdgeBps) > 0;
  const statusLine = qualified ? "🧪 PAPER QUALIFIED · capture activado" : netPositive ? "🟢 Neto positivo · todavía bajo umbral de captura" : grossPositive ? "🔬 Spread bruto positivo · midiendo decay 250/500/1000 ms" : "🔭 Sin edge · sigue cazando";
  return [qualified ? "🧬🔥 GENESIS HQ · MEV CANDIDATE" : grossPositive ? "🧬🧪 GENESIS HQ · EDGE TO MEASURE" : "🧬 GENESIS HQ · MEV RADAR", "━━━━━━━━━━━━━━━━━━━━", `🪙 ACTIVO        ${event.asset}`, `🟢 BUY DEX       ${event.buyDex}`, `🟣 SELL DEX      ${event.sellDex}`, `💵 CAPITAL       $${Number(event.inputAmountUsd).toFixed(2)}`, "", `📈 SPREAD BRUTO  ${bps(event.quotedEdgeBps)}`, `🎯 BREAK-EVEN    ${bps(event.breakEvenGrossEdgeBps)}`, `💸 COSTES CONS.  ${usd(event.estimatedCosts?.totalUsd)}`, `${netPositive ? "🟢" : "🔴"} EDGE NETO     ${bps(event.netEdgeBps)}`, `💰 PNL NETO      ${money(event.expectedNetPnlUsd)}`, "", `📐 TAMAÑOS       ${(event.radar?.notionalGrid ?? []).map((n: number) => `$${n}`).join(" · ") || "—"}`, `🏦 DEX SCAN      ${event.radar?.dexesTested ?? "—"}/${event.radar?.configuredDexes ?? "—"}`, `🔁 RUTAS         ${event.radar?.pairAttempts ?? "—"}`, `🌱 GROSS +       ${event.radar?.grossPositiveCount ?? "—"}`, `✅ NET +         ${event.radar?.netPositiveCount ?? "—"}`, `⚡ REQUOTE       ${event.quoteLatencyMs} ms`, `⏱️ SCAN TOTAL    ${event.radar?.scanElapsedMs ?? "—"} ms`, `🧱 SLOT DRIFT    ${event.slotDrift ?? "—"}`, "", statusLine, "👻 SHADOW · 🔒 LIVE LOCKED", "🚫 Sin firma · sin transacción · sin capital real", `🕒 ${madridTime(event.timestamp)}`].join("\n");
}
function formatMeasurement(event: any) { const samples = Array.isArray(event.decayCurve) ? event.decayCurve : []; return ["🔬🧬 GENESIS HQ · EDGE MEASUREMENT", "━━━━━━━━━━━━━━━━━━━━", `🪙 ${event.asset} · ${event.route}`, `💵 $${Number(event.inputAmountUsd).toFixed(2)}`, "", `🎯 FRESH GROSS   ${bps(event.initialGrossEdgeBps)}`, `🛡️ FRESH NET     ${bps(event.initialNetEdgeBps)}`, ...samples.map((s: any) => `⏱️ ${String(s.horizonMs).padStart(4, " ")} ms      gross ${bps(s.grossEdgeBps)} · net ${bps(s.netEdgeBps)} · drift ${s.slotDrift ?? "—"}`), "", `📉 GROSS DECAY   ${bps(event.grossDecayBps)}`, `💰 FINAL NET     ${money(event.capturedNetPnlUsd)}`, `🧠 ${event.survivedGrossPositive ? "SPREAD SOBREVIVE" : "SPREAD DECAÍDO"}`, "", "🔬 MEASUREMENT ONLY · 🧪 PAPER · 🔒 LIVE LOCKED", "🚫 Sin firma · sin transacción · sin capital real", `🕒 ${madridTime(event.timestamp)}`].join("\n"); }
async function dispatchTelegram(db: Db, event: any, kind: "radar" | "measurement") { const { data: configs, error } = await db.rpc("genesis_telegram_configs_for_dispatch"); if (error) throw new Error("telegram_config_store_unavailable"); let sent = 0, skipped = 0, failed = 0; for (const row of configs ?? []) { const config = row?.config && typeof row.config === "object" ? row.config : {}; const notifications = row?.notifications && typeof row.notifications === "object" ? row.notifications : config.notifications ?? {}; const wants = kind === "measurement" ? event.centsCaptured === true && notifications.executions !== false : event.type === "OPPORTUNITY_DETECTED" ? notifications.opportunities !== false : notifications.debug === true; if (!wants) { skipped++; continue; } const botToken = typeof config.botToken === "string" ? config.botToken.trim() : ""; const chatId = config.chatId == null ? "" : String(config.chatId).trim(); if (!botToken || !chatId) { failed++; continue; } const eventId = String(event.eventId ?? event.id ?? "").trim(); if (!eventId) { skipped++; continue; } const { data: existing } = await db.from("genesis_telegram_deliveries").select("event_id").eq("owner_hash", row.owner_hash).eq("event_id", eventId).maybeSingle(); if (existing) { skipped++; continue; } try { await telegramRequest(botToken, chatId, kind === "measurement" ? formatMeasurement(event) : formatRadar(event)); const { error: insertError } = await db.from("genesis_telegram_deliveries").insert({ owner_hash: row.owner_hash, event_id: eventId }); if (insertError && insertError.code !== "23505") throw insertError; sent++; } catch { failed++; } } return { configs: (configs ?? []).length, sent, skipped, failed }; }

async function persistObservation(db: Db, event: any) { const { error } = await db.from("solana_arbitrage_observations").insert({ event_id: event.eventId, observed_at: event.observedAt, source: "supabase_mev_radar_v2", route: event.route, venues: event.venues, input_usd: event.inputAmountUsd, quoted_output_usdc: event.quotedOutputUsd, quoted_edge_bps: event.quotedEdgeBps, net_edge_bps: event.netEdgeBps, expected_net_pnl_usd: event.expectedNetPnlUsd, total_cost_usd: event.estimatedCosts?.totalUsd ?? null, quote_latency_ms: event.quoteLatencyMs, slot: event.slot, slot_drift: event.slotDrift, decision: event.decision, reason: event.reason, blockers: event.blockers, cost_model: event.estimatedCosts, mode: "SHADOW", execution_authority: false, live_locked: true, raw_event: event }); if (error) throw new Error(`observation_store_failed:${error.code}`); }
async function persistMeasurement(db: Db, event: any, measurement: any) { const { error } = await db.from("solana_paper_captures").insert({ opportunity_event_id: event.eventId, captured_at: measurement.timestamp, route: event.route, expected_net_pnl_usd: event.expectedNetPnlUsd, expected_net_edge_bps: event.netEdgeBps, captured_net_pnl_usd: measurement.capturedNetPnlUsd, captured_net_edge_bps: measurement.capturedNetEdgeBps, quote_decay_usd: measurement.quoteDecayUsd, quote_decay_bps: measurement.netDecayBps, capture_ratio: measurement.captureRatio, initial_quote_end_usdc: event.quotedOutputUsd, capture_quote_end_usdc: measurement.captureQuoteEndUsdc, initial_cost_usd: event.estimatedCosts?.totalUsd ?? null, capture_cost_usd: measurement.captureCostUsd, initial_slot: event.slot, capture_slot: measurement.captureSlot, slot_drift: measurement.captureSlotDrift, venues: event.venues, capture_venues: event.venues, status: measurement.centsCaptured === true ? "CAPTURED" : "DECAYED", failure_reason: null, mode: "PAPER", execution_authority: false, live_locked: true, raw_capture: measurement }); if (error) throw new Error(`measurement_store_failed:${error.code}`); }
async function persistLatest(db: Db, payload: unknown) { await db.from("org_state").upsert({ key: "solana_mev_venue_radar_v2", value: JSON.stringify(payload), updated_at: new Date().toISOString() }, { onConflict: "key" }); }

async function measureDecay(db: Db, event: any, token: TokenSpec, buyDex: string, sellDex: string, notionalUsd: number) {
  const start = Date.now(); const samples: any[] = []; let last: PairEconomics | null = null;
  for (const horizonMs of DECAY_HORIZONS_MS) { const waitMs = Math.max(0, horizonMs - (Date.now() - start)); if (waitMs) await sleep(waitMs); try { const evidence = await loadCostEvidence(db); const fresh = await evaluatePair(token, buyDex, sellDex, notionalUsd, evidence, undefined, true); last = fresh; samples.push({ horizonMs, measuredAtMs: Date.now(), grossEdgeBps: fresh.quotedEdgeBps, netEdgeBps: fresh.netEdgeBps, netPnlUsd: fresh.netPnlUsd, endUsdc: fresh.endUsdc, totalCostUsd: fresh.totalCostUsd, quoteLatencyMs: fresh.quoteLatencyMs, slot: fresh.slot, slotDrift: fresh.slotDrift, blockers: fresh.blockers }); } catch (error) { samples.push({ horizonMs, error: error instanceof Error ? error.message : String(error) }); } }
  const valid = samples.filter((s) => Number.isFinite(Number(s.grossEdgeBps))); if (!valid.length || !last) throw new Error("decay_measurement_failed"); const final = valid[valid.length - 1];
  const expectedNet = Number(event.expectedNetPnlUsd), capturedNet = Number(final.netPnlUsd), expectedNetEdge = Number(event.netEdgeBps), capturedNetEdge = Number(final.netEdgeBps); const measurementId = `mev-measure-${crypto.randomUUID()}`;
  const measurement = { eventId: measurementId, id: measurementId, type: "MEV_EDGE_MEASUREMENT", timestamp: new Date().toISOString(), asset: event.asset, route: event.route, inputAmountUsd: event.inputAmountUsd, initialGrossEdgeBps: Number(event.quotedEdgeBps), initialNetEdgeBps: expectedNetEdge, decayCurve: valid, grossDecayBps: Number(event.quotedEdgeBps) - Number(final.grossEdgeBps), netDecayBps: expectedNetEdge - capturedNetEdge, quoteDecayBps: expectedNetEdge - capturedNetEdge, quoteDecayUsd: expectedNet - capturedNet, captureRatio: expectedNet > 0 ? capturedNet / expectedNet : null, capturedNetPnlUsd: capturedNet, capturedNetEdgeBps: capturedNetEdge, captureQuoteEndUsdc: Number(final.endUsdc), captureCostUsd: Number(final.totalCostUsd), captureSlot: final.slot ?? null, captureSlotDrift: final.slotDrift ?? null, survivedGrossPositive: Number(final.grossEdgeBps) > 0, centsCaptured: capturedNet >= MIN_CAPTURE_PNL_USD && capturedNetEdge > 0, minimumCapturePnlUsd: MIN_CAPTURE_PNL_USD, priorityFeeEvidence: last.priorityFeeEvidence, atomicPreflight: last.atomicPreflight, mode: "PAPER", executionAuthority: false, liveLocked: true, measurementOnly: true, noTransaction: true };
  await persistMeasurement(db, event, measurement); (measurement as any).telegram = await dispatchTelegram(db, measurement, "measurement"); return measurement;
}
function currentProbe() { const tick = Math.floor(Date.now() / DEX_ROTATION_MS); return { tokenIndex: tick % TOKENS.length }; }

async function runRadar() {
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const scanStartedMs = Date.now();
  const { tokenIndex } = currentProbe();
  const evidence = await loadCostEvidence(db);
  const probeErrors: string[] = [];
  let probe: GridProbeResult | null = null;
  let fallbackUsed = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = TOKENS[(tokenIndex + attempt) % TOKENS.length];
    const result = await probeTokenGrid(token, evidence);
    probeErrors.push(...result.errors.map((error) => `${token.symbol}:${error}`));
    if (result.candidates.length) { probe = result; fallbackUsed = attempt > 0; break; }
  }
  if (!probe || !probe.candidates.length) throw new Error(`no_cross_dex_candidates:${probeErrors.slice(0, 10).join("|")}`);

  const scannedBest = probe.candidates[0];
  const token = probe.token;
  const selectedNotionalUsd = scannedBest.startUsdc;
  const freshEvidence = await loadCostEvidence(db);
  const fresh = await evaluatePair(token, scannedBest.buyDex, scannedBest.sellDex, selectedNotionalUsd, freshEvidence, undefined, true);
  const qualified = fresh.blockers.length === 0 && Number(fresh.netPnlUsd) >= MIN_CAPTURE_PNL_USD;
  const grossPositiveCount = probe.candidates.filter((candidate) => Number(candidate.quotedEdgeBps) > 0).length;
  const netPositiveCount = probe.candidates.filter((candidate) => Number(candidate.netPnlUsd) > 0).length;
  const eventId = `mev-radar-v2-${crypto.randomUUID()}`;
  const event = {
    eventId, id: eventId, timestamp: new Date().toISOString(), observedAt: new Date().toISOString(), type: qualified ? "OPPORTUNITY_DETECTED" : "REJECTED",
    chain: "SOLANA", mode: "SHADOW", executionAuthority: false, liveLocked: true, asset: token.symbol, assetMint: token.mint,
    buyDex: fresh.buyDex, sellDex: fresh.sellDex, route: `${token.symbol}: ${fresh.buyDex} → ${fresh.sellDex}`, venues: [fresh.buyDex, fresh.sellDex], tokens: ["USDC", token.symbol, "USDC"],
    inputAmountUsd: fresh.startUsdc, quotedOutputUsd: fresh.endUsdc, quotedEdgeBps: fresh.quotedEdgeBps, breakEvenGrossEdgeBps: fresh.breakEvenGrossEdgeBps,
    netEdgeBps: fresh.netEdgeBps, expectedNetPnlUsd: fresh.netPnlUsd, estimatedCosts: fresh.costs, priorityFeeEvidence: fresh.priorityFeeEvidence, atomicPreflight: fresh.atomicPreflight,
    minimumCapturePnlUsd: MIN_CAPTURE_PNL_USD, quoteLatencyMs: fresh.quoteLatencyMs, slot: fresh.slot, slotDrift: fresh.slotDrift, blockers: fresh.blockers,
    decision: qualified ? "SHADOW_QUALIFIED" : Number(fresh.quotedEdgeBps) > 0 ? "GROSS_POSITIVE_MEASURE" : "REJECTED",
    reason: qualified ? "positive_cross_dex_net_edge" : Number(fresh.quotedEdgeBps) > 0 ? "gross_positive_measurement_only" : fresh.blockers[0] ?? "rejected",
    radar: {
      engineVersion: ENGINE_VERSION, configuredDexes: token.dexes.length, dexesTested: probe.activeDexes.length, activeDexes: probe.activeDexes,
      buyQuotes: probe.buyQuoteCount, pairAttempts: probe.pairAttempts, pairsEvaluated: probe.candidates.length, selectedNotionalUsd,
      fallbackUsed, primaryAsset: TOKENS[tokenIndex].symbol, assetRotation: TOKENS.map((t) => t.symbol), notionalGrid: NOTIONAL_GRID,
      sizingCurve: probe.sizingCurve, grossPositiveCount, netPositiveCount, solUsd: freshEvidence.solUsd, solPriceSource: freshEvidence.solPriceSource,
      scanElapsedMs: Date.now() - scanStartedMs, requotedBeforeDecision: true, quoteConcurrency: QUOTE_CONCURRENCY,
      earlyRejectGrossNonPositive: true,
      scannedBest: { route: `${scannedBest.buyDex} → ${scannedBest.sellDex}`, notionalUsd: scannedBest.startUsdc, grossEdgeBps: scannedBest.quotedEdgeBps, breakEvenGrossEdgeBps: scannedBest.breakEvenGrossEdgeBps, netEdgeBps: scannedBest.netEdgeBps, netPnlUsd: scannedBest.netPnlUsd, slotDrift: scannedBest.slotDrift },
      top5: probe.candidates.slice(0, 5).map((candidate) => ({ route: `${candidate.buyDex} → ${candidate.sellDex}`, notionalUsd: candidate.startUsdc, grossEdgeBps: candidate.quotedEdgeBps, breakEvenGrossEdgeBps: candidate.breakEvenGrossEdgeBps, netEdgeBps: candidate.netEdgeBps, netPnlUsd: candidate.netPnlUsd })),
      quoteErrors: probeErrors.slice(0, 20),
    },
  };
  await persistObservation(db, event);
  const telegram = await dispatchTelegram(db, event, "radar");
  let measurement = null;
  if (Number(fresh.quotedEdgeBps) > 0 && fresh.slotDrift != null) {
    try { measurement = await measureDecay(db, event, token, fresh.buyDex, fresh.sellDex, selectedNotionalUsd); }
    catch (error) { measurement = { ok: false, type: "MEV_EDGE_MEASUREMENT_FAILED", error: error instanceof Error ? error.message : String(error), measurementOnly: true, liveLocked: true }; }
  }
  const result = { ok: true, source: "supabase_mev_radar_v2", engineVersion: ENGINE_VERSION, mode: "SHADOW", executionAuthority: false, liveLocked: true, event, telegram, measurement, evidenceErrors: fresh.evidenceErrors };
  await persistLatest(db, result);
  return result;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json(200, { ok: true });
  if (!["GET", "POST"].includes(req.method)) return json(405, { ok: false, error: "method_not_allowed" });
  if (!SERVICE_KEY) return json(503, { ok: false, error: "service_key_unavailable" });
  if (!await authorized(req)) return json(403, { ok: false, error: "runner_auth_invalid" });
  try { return json(200, await runRadar()); }
  catch (error) {
    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const failure = { ok: false, source: "supabase_mev_radar_v2", engineVersion: ENGINE_VERSION, mode: "SHADOW", executionAuthority: false, liveLocked: true, error: error instanceof Error ? error.message : String(error), observedAt: new Date().toISOString() };
    await persistLatest(db, failure).catch(() => null);
    return json(500, failure);
  }
});
