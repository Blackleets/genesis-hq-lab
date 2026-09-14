import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.2.10";

const GITHUB_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_AUDIENCE = "genesis-telegram-dispatch";
const GITHUB_REPOSITORY = "Blackleets/genesis-hq-lab";
const GITHUB_REF = "refs/heads/feat/genesis-life-os";
const GITHUB_WORKFLOW = `${GITHUB_REPOSITORY}/.github/workflows/solana-arbitrage-observation.yml@${GITHUB_REF}`;
const GITHUB_JWKS = createRemoteJWKSet(new URL(`${GITHUB_ISSUER}/.well-known/jwks`));

const SESSION_TOKEN_RE = /^[0-9a-f]{64}$/;
const BOT_RE = /^\d{5,16}:[A-Za-z0-9_-]{20,}$/;
const CHAT_RE = /^(?:-?\d{5,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/;
const TELEGRAM_API = "https://api.telegram.org";
const ALLOWED_EVENTS = new Set(["OPPORTUNITY_DETECTED", "CAPTURE_MEASURED", "SIMULATION_FAILED", "FAILED", "REJECTED"]);
const DEFAULT_NOTIFICATIONS = Object.freeze({ important: true, opportunities: true, executions: true, dailySummary: true, debug: false });

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
function bearer(req: Request) { return (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim(); }
async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
async function verifyGithubOidc(token: string) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, GITHUB_JWKS, { issuer: GITHUB_ISSUER, audience: GITHUB_AUDIENCE });
    if (payload.repository !== GITHUB_REPOSITORY) return null;
    if (payload.ref !== GITHUB_REF) return null;
    if (payload.workflow_ref !== GITHUB_WORKFLOW) return null;
    return payload;
  } catch { return null; }
}
async function ownerFromSession(token: string, db: ReturnType<typeof createClient>) {
  if (!SESSION_TOKEN_RE.test(token)) return null;
  const tokenHash = await sha256Hex(token);
  const { data, error } = await db.from("genesis_auth_sessions").select("address,chain,role,expires_at").eq("token_hash", tokenHash).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (error || !data) return null;
  const address = data.chain === "evm" ? String(data.address).toLowerCase() : String(data.address);
  return { ownerHash: (await sha256Hex(address)).slice(0, 16), address, role: data.role };
}
function normalizePreferences(value: unknown) {
  const v = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return { important: v.important !== false, opportunities: v.opportunities !== false, executions: v.executions !== false, dailySummary: v.dailySummary !== false, debug: v.debug === true };
}
function maskChatId(chatId: string) { return chatId.length > 5 ? `${chatId.slice(0, 2)}•••${chatId.slice(-3)}` : "•••••"; }
function validateInput(botToken: unknown, chatId: unknown) {
  const token = typeof botToken === "string" ? botToken.trim() : "";
  const chat = typeof chatId === "string" || typeof chatId === "number" ? String(chatId).trim() : "";
  if (!BOT_RE.test(token)) throw new Error("invalid_bot_token");
  if (!CHAT_RE.test(chat)) throw new Error("invalid_chat_id");
  return { botToken: token, chatId: chat };
}
async function telegramRequest(botToken: string, method: string, payload: unknown) {
  const response = await fetch(`${TELEGRAM_API}/bot${botToken}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8_000) });
  const body = await response.json().catch(() => null) as { ok?: boolean; result?: unknown; description?: string } | null;
  if (!response.ok || body?.ok !== true) throw new Error(`telegram_${response.status}`);
  return body.result;
}
async function testTelegramConnection(botToken: string, chatId: string) {
  await telegramRequest(botToken, "getMe", {});
  const text = ["🔥 GENESIS HQ CONNECTED", "", "Telegram notifications are active.", "", "Solana Engine: ONLINE · SHADOW/PAPER", "Futures Engine: PAPER", "LIVE: LOCKED", "", "Genesis will report qualified opportunities and execution results here."].join("\n");
  await telegramRequest(botToken, "sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
}
function amount(value: unknown, digits = 4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${number >= 0 ? "+" : "-"}$${Math.abs(number).toFixed(digits)}`;
}
function bps(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number >= 0 ? "+" : ""}${number.toFixed(2)} bps` : "—";
}
function notificationLevel(event: Record<string, unknown>) {
  if (event.type === "OPPORTUNITY_DETECTED") return "opportunities";
  if (event.type === "CAPTURE_MEASURED") return "executions";
  if (event.type === "FAILED" || event.type === "SIMULATION_FAILED") return "important";
  if (event.type === "REJECTED") return "debug";
  return "debug";
}
function formatEvent(event: Record<string, unknown>) {
  const route = typeof event.route === "string" ? event.route : "USDC → SOL → USDC";
  const tokens = Array.isArray(event.tokens) ? event.tokens.map(String).join(" → ") : "USDC → SOL → USDC";
  const type = String(event.type ?? "EVENT");
  if (type === "OPPORTUNITY_DETECTED") {
    const estimatedCosts = event.estimatedCosts && typeof event.estimatedCosts === "object" ? event.estimatedCosts as Record<string, unknown> : {};
    const simulationResult = event.simulationResult && typeof event.simulationResult === "object" ? event.simulationResult as Record<string, unknown> : {};
    return ["🔥 GENESIS · SOLANA OPPORTUNITY", "", `Route:\n${route}`, "", `Pair:\n${tokens}`, "", `Capital:\n$${Number(event.inputAmountUsd ?? 0).toFixed(2)}`, "", `Gross Edge:\n${bps(event.grossEdgeBps ?? event.quotedEdgeBps)}`, "", `Estimated Costs:\n${amount(-Math.abs(Number(estimatedCosts.totalUsd ?? 0)))}`, "", `Net Edge:\n${bps(event.netEdgeBps)}`, "", `Expected Net:\n${amount(event.expectedNetPnlUsd)}`, "", `Simulation:\n${simulationResult.success ? "PASSED" : "PENDING"}`, "", `Decision:\n${String(event.decision ?? "PENDING")}`, "", String(event.timestamp ?? event.observedAt ?? new Date().toISOString())].join("\n");
  }
  if (type === "CAPTURE_MEASURED") {
    return ["⚡ GENESIS · PAPER CAPTURE", "", `Route:\n${route}`, "", `Expected:\n${amount(event.expectedNetPnlUsd)}`, "", `Captured:\n${amount(event.capturedNetPnlUsd)}`, "", `Slippage:\n${bps(event.actualSlippageBps)}`, "", `Fees:\n${amount(-Math.abs(Number(event.actualFeesUsd ?? 0)))}`, "", `Net PnL:\n${amount(event.capturedNetPnlUsd)}`, "", `Capture Ratio:\n${Number.isFinite(Number(event.captureRatio)) ? `${(Number(event.captureRatio) * 100).toFixed(1)}%` : "—"}`, "", String(event.timestamp ?? event.observedAt ?? new Date().toISOString())].join("\n");
  }
  if (type === "REJECTED") {
    return ["🛰️ GENESIS · SOLANA SCAN", "", `Route:\n${route}`, "", `Capital:\n$${Number(event.inputAmountUsd ?? 0).toFixed(2)}`, "", `Quoted Edge:\n${bps(event.quotedEdgeBps)}`, "", `Net Edge:\n${bps(event.netEdgeBps)}`, "", `Expected Net:\n${amount(event.expectedNetPnlUsd)}`, "", "Decision:\nREJECTED", "", `Reason:\n${String(event.reason ?? "not_profitable")}`, "", "LIVE: LOCKED · SHADOW/PAPER", "", String(event.timestamp ?? event.observedAt ?? new Date().toISOString())].join("\n");
  }
  return `GENESIS · SOLANA ${type.replaceAll("_", " ")}\n${route}\n${String(event.reason ?? "")}`.trim();
}
function safeEvent(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return event.chain === "SOLANA" && event.executionAuthority === false && event.liveLocked === true && ALLOWED_EVENTS.has(String(event.type ?? ""));
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "invalid_json" }); }
  const action = typeof body.action === "string" ? body.action : "";
  const token = bearer(req);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY");
  if (!url || !serviceKey) return json(503, { ok: false, error: "supabase_server_credentials_unavailable" });
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  if (action === "dispatch") {
    if (!(await verifyGithubOidc(token))) return json(401, { ok: false, error: "invalid_github_oidc" });
    const events = Array.isArray(body.events) ? body.events.filter(safeEvent) : [];
    const { data: configs, error: configError } = await db.rpc("genesis_telegram_configs_for_dispatch");
    if (configError) return json(503, { ok: false, error: "telegram_config_store_unavailable" });
    await db.from("genesis_telegram_deliveries").delete().lt("sent_at", new Date(Date.now() - 30 * 86400_000).toISOString());
    let sent = 0, skipped = 0, failed = 0;
    for (const row of configs ?? []) {
      const config = row.config && typeof row.config === "object" ? row.config as Record<string, unknown> : {};
      const preferences = normalizePreferences(row.notifications ?? config.notifications);
      let valid;
      try { valid = validateInput(config.botToken, config.chatId); } catch { failed += events.length; continue; }
      for (const event of events) {
        const eventId = String(event.eventId ?? event.id ?? "").trim();
        if (!eventId) { skipped += 1; continue; }
        const level = notificationLevel(event);
        if (!(preferences as Record<string, boolean>)[level]) { skipped += 1; continue; }
        const { data: existing } = await db.from("genesis_telegram_deliveries").select("event_id").eq("owner_hash", row.owner_hash).eq("event_id", eventId).maybeSingle();
        if (existing) { skipped += 1; continue; }
        try {
          await telegramRequest(valid.botToken, "sendMessage", { chat_id: valid.chatId, text: formatEvent(event), disable_web_page_preview: true });
          const { error: insertError } = await db.from("genesis_telegram_deliveries").insert({ owner_hash: row.owner_hash, event_id: eventId });
          if (insertError && insertError.code !== "23505") throw insertError;
          sent += 1;
        } catch { failed += 1; }
      }
    }
    return json(200, { ok: true, configs: (configs ?? []).length, events: events.length, sent, skipped, failed });
  }

  const owner = await ownerFromSession(token, db);
  if (!owner) return json(401, { ok: false, error: "invalid_genesis_session" });
  const ownerHash = owner.ownerHash;
  if (typeof body.ownerHash === "string" && body.ownerHash !== ownerHash) return json(403, { ok: false, error: "owner_mismatch" });
  if (action === "status") {
    const { data, error } = await db.from("genesis_telegram_configs").select("verified_at,chat_id_masked,notifications,active").eq("owner_hash", ownerHash).maybeSingle();
    if (error) return json(503, { ok: false, error: "telegram_config_store_unavailable" });
    return json(200, { ok: true, telegram: data ? { configured: true, connected: Boolean(data.active && data.verified_at), verifiedAt: data.verified_at, chatIdMasked: data.chat_id_masked, notifications: normalizePreferences(data.notifications) } : { configured: false, connected: false, verifiedAt: null, chatIdMasked: null, notifications: normalizePreferences(DEFAULT_NOTIFICATIONS) } });
  }
  if (action === "delete") {
    const { error } = await db.rpc("genesis_telegram_config_delete", { p_owner_hash: ownerHash });
    if (error) return json(503, { ok: false, error: "telegram_config_delete_failed" });
    return json(200, { ok: true, telegram: { configured: false, connected: false, verifiedAt: null, chatIdMasked: null, notifications: normalizePreferences(DEFAULT_NOTIFICATIONS) } });
  }
  if (action === "save") {
    let valid;
    try { valid = validateInput(body.botToken, body.chatId); } catch (error) { return json(400, { ok: false, error: error instanceof Error ? error.message : "invalid_telegram_config" }); }
    const notifications = normalizePreferences(body.notifications);
    try { await testTelegramConnection(valid.botToken, valid.chatId); } catch { return json(502, { ok: false, error: "telegram_test_failed", message: "Telegram rechazó la conexión. Revisa el token, el Chat ID y que hayas iniciado el chat con el bot." }); }
    const verifiedAt = new Date().toISOString();
    const chatIdMasked = maskChatId(valid.chatId);
    const secretJson = JSON.stringify({ ...valid, notifications });
    const { data, error } = await db.rpc("genesis_telegram_config_upsert", { p_owner_hash: ownerHash, p_secret_json: secretJson, p_chat_id_masked: chatIdMasked, p_notifications: notifications, p_verified_at: verifiedAt });
    if (error) { console.error("genesis_telegram_config_upsert", error.code); return json(503, { ok: false, error: "telegram_config_store_unavailable" }); }
    return json(200, { ok: true, telegram: data });
  }
  return json(400, { ok: false, error: "invalid_action" });
});
