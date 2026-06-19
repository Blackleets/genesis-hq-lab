// genesis-alerts — Telegram alert system for Genesis HQ
// Triggered by keep-render-awake.yml every 10 minutes.
// Sends alerts when: drawdown > 15%, loss streak >= 4, runner offline > 30 min.
// Throttles to one alert per condition per hour to avoid spam.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const TELEGRAM_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const RUNNER_TOKEN = Deno.env.get("GENESIS_RUNNER_TOKEN")?.trim() ?? "";
const START_CAPITAL = Number.parseFloat(Deno.env.get("FUTURES_DESK_START_CAPITAL") ?? "10000");

const FUTURES_TYPES = [
  "crypto_futures_breakout_short_micro",
  "crypto_futures_breakout_short",
  "crypto_futures_breakout_short_alt",
  "crypto_futures_breakout_long",
];

const ALERT_THROTTLE_MS = 60 * 60 * 1000; // 1 hour between same alert type

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
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

async function auth(req: Request): Promise<boolean> {
  if (!RUNNER_TOKEN) return true; // unconfigured = open (dev mode)
  const token =
    req.headers.get("x-genesis-runner-token")?.trim() ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ??
    "";
  return timingSafeEqual(token, RUNNER_TOKEN);
}

async function sendTelegram(text: string): Promise<boolean> {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML" }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function getOrgState(key: string): Promise<string | null> {
  const { data } = await supabase.from("org_state").select("value").eq("key", key).limit(1).single();
  return data?.value ?? null;
}

async function setOrgState(key: string, value: string) {
  await supabase.from("org_state").upsert(
    { key, value, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
}

async function wasRecentlySent(alertKey: string): Promise<boolean> {
  const raw = await getOrgState(`alert_sent_at:${alertKey}`);
  if (!raw) return false;
  const sentAt = new Date(raw.replace(/^"/, "").replace(/"$/, "")).getTime();
  return Date.now() - sentAt < ALERT_THROTTLE_MS;
}

async function markSent(alertKey: string) {
  await setOrgState(`alert_sent_at:${alertKey}`, new Date().toISOString());
}

async function checkRunnerOffline(): Promise<{ triggered: boolean; msSince: number | null }> {
  const raw = await getOrgState("external_runner_heartbeat");
  if (!raw) return { triggered: false, msSince: null };
  try {
    const payload = JSON.parse(raw);
    const lastTickAt = payload?.lastTickAt;
    if (!lastTickAt) return { triggered: false, msSince: null };
    const ms = Date.now() - new Date(lastTickAt).getTime();
    return { triggered: ms > 30 * 60 * 1000, msSince: ms };
  } catch {
    return { triggered: false, msSince: null };
  }
}

async function checkDrawdown(): Promise<{ triggered: boolean; pct: number; equity: number }> {
  const { data: closedRows } = await supabase
    .from("trades")
    .select("pnl")
    .in("trade_type", FUTURES_TYPES)
    .eq("status", "closed");

  const { data: openRows } = await supabase
    .from("trades")
    .select("capital_used")
    .in("trade_type", FUTURES_TYPES)
    .eq("status", "open");

  const realizedPnl = (closedRows ?? []).reduce((sum, r) => sum + Number(r.pnl ?? 0), 0);
  const reservedMargin = (openRows ?? []).reduce((sum, r) => sum + Number(r.capital_used ?? 0), 0);
  const equity = START_CAPITAL + realizedPnl - reservedMargin;
  const pct = equity < START_CAPITAL ? ((START_CAPITAL - equity) / START_CAPITAL) * 100 : 0;
  return { triggered: pct > 15, pct: Math.round(pct * 10) / 10, equity: Math.round(equity * 100) / 100 };
}

async function checkLossStreak(): Promise<{ triggered: boolean; streak: number }> {
  const { data: rows } = await supabase
    .from("trades")
    .select("pnl")
    .in("trade_type", FUTURES_TYPES)
    .eq("status", "closed")
    .order("closed_at", { ascending: false })
    .limit(20);

  if (!rows?.length) return { triggered: false, streak: 0 };
  let streak = 0;
  for (const row of rows) {
    if (Number(row.pnl ?? 0) < 0) streak++;
    else break;
  }
  return { triggered: streak >= 4, streak };
}

async function checkDailySummary(): Promise<{ triggered: boolean; sent: boolean }> {
  const nowUtc = new Date();
  const hourUtc = nowUtc.getUTCHours();
  const minUtc = nowUtc.getUTCMinutes();
  // Only fire between 09:00 and 09:15 UTC
  if (hourUtc !== 9 || minUtc > 15) return { triggered: false, sent: false };

  const key = "daily_summary";
  const todayKey = `alert_sent_at:${key}:${nowUtc.toISOString().slice(0, 10)}`;
  const alreadySent = await getOrgState(todayKey);
  if (alreadySent) return { triggered: true, sent: false };

  const todayStart = new Date(nowUtc);
  todayStart.setUTCHours(0, 0, 0, 0);

  const { data: todayTrades } = await supabase
    .from("trades")
    .select("pnl,outcome,trade_type")
    .in("trade_type", FUTURES_TYPES)
    .eq("status", "closed")
    .gte("closed_at", todayStart.toISOString());

  const { data: allClosed } = await supabase
    .from("trades")
    .select("pnl,capital_used")
    .in("trade_type", FUTURES_TYPES)
    .eq("status", "closed");

  const { data: openRows } = await supabase
    .from("trades")
    .select("capital_used")
    .in("trade_type", FUTURES_TYPES)
    .eq("status", "open");

  const today = todayTrades ?? [];
  const todayWins = today.filter((r) => Number(r.pnl ?? 0) > 0).length;
  const todayPnl = today.reduce((s, r) => s + Number(r.pnl ?? 0), 0);
  const winRate = today.length > 0 ? Math.round((todayWins / today.length) * 100) : 0;

  const allPnl = (allClosed ?? []).reduce((s, r) => s + Number(r.pnl ?? 0), 0);
  const reserved = (openRows ?? []).reduce((s, r) => s + Number(r.capital_used ?? 0), 0);
  const equity = START_CAPITAL + allPnl - reserved;
  const drawdownPct = equity < START_CAPITAL ? ((START_CAPITAL - equity) / START_CAPITAL) * 100 : 0;

  const grossWins = (allClosed ?? []).filter((r) => Number(r.pnl ?? 0) > 0).reduce((s, r) => s + Number(r.pnl ?? 0), 0);
  const grossLosses = Math.abs((allClosed ?? []).filter((r) => Number(r.pnl ?? 0) < 0).reduce((s, r) => s + Number(r.pnl ?? 0), 0));
  const pf = grossLosses > 0 ? (grossWins / grossLosses).toFixed(2) : grossWins > 0 ? "∞" : "—";

  const dateLabel = nowUtc.toLocaleDateString("es-MX", { day: "numeric", month: "short", timeZone: "UTC" });
  const statusEmoji = equity >= START_CAPITAL ? "🟢" : drawdownPct > 15 ? "🔴" : "🟡";
  const pnlStr = `${allPnl >= 0 ? "+" : ""}$${allPnl.toFixed(2)}`;
  const todayStr = `${todayPnl >= 0 ? "+" : ""}$${todayPnl.toFixed(2)}`;

  const msg =
    `📊 <b>RESUMEN DIARIO · ${dateLabel}</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `Hoy: ${today.length} trades · ✅ ${todayWins} / ❌ ${today.length - todayWins}\n` +
    `Win Rate: ${winRate}% · PnL: <b>${todayStr}</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `💼 Equity: <b>$${equity.toFixed(2)}</b> (start: $${START_CAPITAL})\n` +
    `PnL total: ${pnlStr}\n` +
    `📉 Drawdown: ${drawdownPct.toFixed(1)}%\n` +
    `🔁 Profit Factor: ${pf}\n` +
    `Abiertas: ${openRows?.length ?? 0}\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `${statusEmoji} Sistema operativo · <i>PAPER</i>`;

  const ok = await sendTelegram(msg);
  if (ok) await setOrgState(todayKey, new Date().toISOString());
  return { triggered: true, sent: ok };
}

async function runAlerts() {
  const alerts: string[] = [];
  const sent: string[] = [];
  const skipped: string[] = [];

  const [offline, drawdown, lossStreak] = await Promise.all([
    checkRunnerOffline(),
    checkDrawdown(),
    checkLossStreak(),
  ]);

  // Runner offline alert
  if (offline.triggered) {
    const key = "runner_offline";
    if (await wasRecentlySent(key)) {
      skipped.push(key);
    } else {
      const minAgo = offline.msSince ? Math.round(offline.msSince / 60000) : "?";
      const msg = `⚠️ <b>GENESIS RUNNER OFFLINE</b>\nSin tick hace <b>${minAgo} minutos</b>.\nRevisar pg_cron y keep-awake workflow.`;
      if (await sendTelegram(msg)) {
        await markSent(key);
        sent.push(key);
        alerts.push(msg);
      }
    }
  }

  // Drawdown alert
  if (drawdown.triggered) {
    const key = "drawdown_critical";
    if (await wasRecentlySent(key)) {
      skipped.push(key);
    } else {
      const msg = `🔴 <b>DRAWDOWN CRÍTICO: ${drawdown.pct}%</b>\nEquity actual: <b>$${drawdown.equity}</b> (start: $${START_CAPITAL})\nLímite: 15%. Posiciones en riesgo.`;
      if (await sendTelegram(msg)) {
        await markSent(key);
        sent.push(key);
        alerts.push(msg);
      }
    }
  }

  // Loss streak alert
  if (lossStreak.triggered) {
    const key = "loss_streak";
    if (await wasRecentlySent(key)) {
      skipped.push(key);
    } else {
      const msg = `🟡 <b>RACHA DE PÉRDIDAS: ${lossStreak.streak} seguidas</b>\nEl governor debería estar degradando el perfil. Revisar si el sistema está pausando correctamente.`;
      if (await sendTelegram(msg)) {
        await markSent(key);
        sent.push(key);
        alerts.push(msg);
      }
    }
  }

  const dailySummary = await checkDailySummary();

  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    conditions: {
      runnerOffline: { triggered: offline.triggered, msSince: offline.msSince },
      drawdown: { triggered: drawdown.triggered, pct: drawdown.pct, equity: drawdown.equity },
      lossStreak: { triggered: lossStreak.triggered, streak: lossStreak.streak },
      dailySummary,
    },
    telegram: { sent, skipped, configured: Boolean(TELEGRAM_TOKEN && TELEGRAM_CHAT_ID) },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "GET" && req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!await auth(req)) return json({ ok: false, error: "unauthorized" }, 401);
  try {
    return json(await runAlerts());
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "alerts_failed" }, 500);
  }
});
