// solanaAlpha.ts — PumpFun feeder step for the serverless runner.
//
// Runs once per genesis-runner tick. Pulls recent pump.fun launches from the
// public frontend API, upserts them into solana_tokens, emits momentum signals,
// and advances a stateless paper-trading engine (open/partial-TP/SL/trailing)
// writing solana_paper_trades, solana_equity_snapshots and the cash balance in
// org_state. Every tick reconstructs its state from the DB — no in-memory state.
//
// Isolated from the futures runner: a failure here is swallowed by the caller so
// it never breaks the futures tick.

// deno-lint-ignore-file no-explicit-any

import postgres from "npm:postgres@3.4.5";

const PUMP_API = "https://frontend-api-v3.pump.fun";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const START_BALANCE = 100;          // SOL paper bankroll
const MAX_OPEN = 8;                  // max concurrent paper positions
const MAX_POS_SOL = 2;              // hard cap per position
const POS_FRACTION = 0.05;           // or 5% of balance, whichever is smaller
const FRESH_MS = 30 * 60 * 1000;     // "fresh launch" window
const SIGNAL_COOLDOWN_MS = 30 * 60 * 1000; // don't re-signal same mint within 30m
const BAND_LO = 3;                   // bonding % momentum band
const BAND_HI = 70;
// pump.fun bonding curve: ~793.1M of the 1B supply (6 decimals) sit on the curve.
const INITIAL_REAL_TOKEN_RESERVES = 793_100_000_000_000;

function nowIso() { return new Date().toISOString(); }
function num(v: any, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)); }
function round(v: number, dp = 8) { const f = 10 ** dp; return Math.round(v * f) / f; }

interface Coin {
  mint: string; name: string; symbol: string; creator: string | null;
  createdTs: number; marketCapSol: number; bondingPct: number;
  lastPriceSol: number; tradeCount: number;
}

function mapCoin(raw: any): Coin | null {
  const mint = typeof raw?.mint === "string" ? raw.mint : null;
  if (!mint) return null;
  const vSol = num(raw.virtual_sol_reserves);
  const vTok = num(raw.virtual_token_reserves);
  const lastPriceSol = vTok > 0 ? (vSol / 1e9) / (vTok / 1e6) : 0;
  const realTok = num(raw.real_token_reserves);
  const bondingPct = raw.complete === true
    ? 100
    : clamp(100 * (1 - realTok / INITIAL_REAL_TOKEN_RESERVES), 0, 100);
  return {
    mint,
    name: typeof raw.name === "string" ? raw.name : "",
    symbol: typeof raw.symbol === "string" ? raw.symbol : "???",
    creator: typeof raw.creator === "string" ? raw.creator : null,
    createdTs: num(raw.created_timestamp),
    marketCapSol: round(num(raw.market_cap), 4),
    bondingPct: round(bondingPct, 2),
    lastPriceSol: round(lastPriceSol, 12),
    tradeCount: num(raw.reply_count),
  };
}

async function fetchRecentCoins(limit = 50): Promise<Coin[]> {
  const url = `${PUMP_API}/coins?offset=0&limit=${limit}&sort=created_timestamp&order=DESC&includeNsfw=false`;
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": UA },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`pumpfun_${res.status}`);
  const arr = await res.json();
  if (!Array.isArray(arr)) throw new Error("pumpfun_invalid");
  return arr.map(mapCoin).filter((c): c is Coin => c !== null);
}

async function fetchCoinPrice(mint: string): Promise<number | null> {
  try {
    const res = await fetch(`${PUMP_API}/coins/${mint}`, {
      headers: { accept: "application/json", "user-agent": UA },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return null;
    const c = mapCoin(await res.json());
    return c ? c.lastPriceSol : null;
  } catch {
    return null;
  }
}

// ── schema bootstrap ─────────────────────────────────────────────────────────
// The Vercel/GitHub Postgres secrets are empty placeholders, so the migration
// can't run from CI. Instead the edge function creates its own tables using
// SUPABASE_DB_URL (auto-injected into every edge function). Idempotent; runs
// once per cold start. NOTIFY pgrst makes the new tables visible to PostgREST
// (which the read routes in genesis-fallback use).
let schemaReady = false;

const SOLANA_DDL = `
CREATE TABLE IF NOT EXISTS solana_tokens (
  mint text PRIMARY KEY, name text, symbol text, creator text, created_ts bigint,
  market_cap_sol double precision DEFAULT 0, bonding_curve_pct double precision DEFAULT 0,
  volume_sol_1h double precision DEFAULT 0, trade_count integer DEFAULT 0,
  unique_wallets integer DEFAULT 0, risk_score integer DEFAULT 50, risk_flags text DEFAULT '[]',
  status text DEFAULT 'active', last_price_sol double precision DEFAULT 0,
  first_seen timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS solana_paper_trades (
  id text PRIMARY KEY, token_mint text NOT NULL, token_symbol text DEFAULT '???', side text DEFAULT 'LONG',
  entry_price_sol double precision NOT NULL, current_price_sol double precision, exit_price_sol double precision,
  size_sol double precision NOT NULL, tokens double precision NOT NULL, status text DEFAULT 'open',
  sl_pct double precision DEFAULT 0.10, tp1_pct double precision DEFAULT 0.25, tp2_pct double precision DEFAULT 0.50,
  tp3_pct double precision DEFAULT 1.00, tp1_hit integer DEFAULT 0, tp2_hit integer DEFAULT 0, tp3_hit integer DEFAULT 0,
  trailing_stop_pct double precision DEFAULT 0.15, peak_price_sol double precision, remaining_tokens double precision,
  realized_sol double precision DEFAULT 0, signal_reason text, opened_at timestamptz DEFAULT now(),
  closed_at timestamptz, pnl_sol double precision, pnl_pct double precision
);
CREATE TABLE IF NOT EXISTS solana_signals (
  id text PRIMARY KEY, token_mint text NOT NULL, token_symbol text DEFAULT '???', signal_type text NOT NULL,
  confidence integer DEFAULT 50, reason text, wallet_count integer DEFAULT 0, risk_score integer DEFAULT 50,
  acted_on integer DEFAULT 0, trade_id text, created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS solana_wallets (
  address text PRIMARY KEY, label text DEFAULT 'unknown', score integer DEFAULT 50, total_trades integer DEFAULT 0,
  wins integer DEFAULT 0, losses integer DEFAULT 0, avg_entry_bonding_pct double precision DEFAULT 0,
  avg_profit_x double precision DEFAULT 1, total_volume_sol double precision DEFAULT 0,
  first_seen timestamptz DEFAULT now(), last_active timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS solana_equity_snapshots (
  id bigserial PRIMARY KEY, balance_sol double precision NOT NULL, open_value_sol double precision DEFAULT 0,
  total_sol double precision NOT NULL, ts timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_solana_tokens_updated ON solana_tokens (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_solana_signals_created ON solana_signals (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_solana_paper_status ON solana_paper_trades (status);
INSERT INTO solana_equity_snapshots (balance_sol, open_value_sol, total_sol)
SELECT 100, 0, 100 WHERE NOT EXISTS (SELECT 1 FROM solana_equity_snapshots);
NOTIFY pgrst, 'reload schema';
`;

async function ensureSolanaSchema() {
  if (schemaReady) return;
  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) { schemaReady = true; return; } // assume already migrated elsewhere
  const sql = postgres(dbUrl, { ssl: "require", max: 1, idle_timeout: 5, connect_timeout: 8 });
  try {
    await sql.unsafe(SOLANA_DDL);
    schemaReady = true;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// ── main step ──────────────────────────────────────────────────────────────

export async function runSolanaAlphaTick(supabase: any) {
  await ensureSolanaSchema(); // self-create tables on first run (SUPABASE_DB_URL)
  const coins = await fetchRecentCoins(50); // throws on network/Cloudflare; caller swallows
  const now = Date.now();

  // Prior token state (for momentum detection + price marks on in-batch tokens).
  const mints = coins.map((c) => c.mint);
  const priorRows = mints.length
    ? await selErr(supabase.from("solana_tokens").select("mint,market_cap_sol,last_price_sol").in("mint", mints))
    : [];
  const prior = new Map<string, { mc: number; price: number }>();
  for (const r of priorRows) prior.set(r.mint, { mc: num(r.market_cap_sol), price: num(r.last_price_sol) });

  // 1) Upsert tokens.
  const tokenRows = coins.map((c) => ({
    mint: c.mint, name: c.name, symbol: c.symbol, creator: c.creator,
    created_ts: c.createdTs, market_cap_sol: c.marketCapSol,
    bonding_curve_pct: c.bondingPct, last_price_sol: c.lastPriceSol,
    trade_count: c.tradeCount, status: "active", updated_at: nowIso(),
  }));
  if (tokenRows.length) {
    const { error } = await supabase.from("solana_tokens").upsert(tokenRows, { onConflict: "mint" });
    if (error) throw new Error(`upsert_tokens_${error.message}`);
  }

  // 2) Signals — fresh launch, bonding in band, market cap rising. Cooldown-deduped.
  const recentSigRows = await selErr(
    supabase.from("solana_signals").select("token_mint,created_at")
      .gte("created_at", new Date(now - SIGNAL_COOLDOWN_MS).toISOString()),
  );
  const recentlySignaled = new Set(recentSigRows.map((r: any) => r.token_mint));

  const newSignals: any[] = [];
  for (const c of coins) {
    if (recentlySignaled.has(c.mint)) continue;
    const fresh = c.createdTs > 0 && now - c.createdTs < FRESH_MS;
    const inBand = c.bondingPct >= BAND_LO && c.bondingPct <= BAND_HI;
    const before = prior.get(c.mint);
    const rising = !before || before.mc <= 0 ? fresh : c.marketCapSol > before.mc * 1.03;
    if (fresh && inBand && rising) {
      const confidence = clamp(Math.round(40 + c.bondingPct * 0.6 + (rising && before ? 15 : 0)), 30, 95);
      newSignals.push({
        id: crypto.randomUUID(),
        token_mint: c.mint, token_symbol: c.symbol, signal_type: "momentum_launch",
        confidence, reason: `fresh launch · bonding ${c.bondingPct.toFixed(1)}% · mcap ${c.marketCapSol.toFixed(2)} SOL`,
        wallet_count: 0, risk_score: clamp(Math.round(80 - c.bondingPct), 10, 90),
        acted_on: 0, created_at: nowIso(),
      });
    }
  }
  if (newSignals.length) {
    const { error } = await supabase.from("solana_signals").insert(newSignals);
    if (error) throw new Error(`insert_signals_${error.message}`);
  }

  // 3) Paper engine tick.
  const priceOf = new Map<string, number>();
  for (const c of coins) if (c.lastPriceSol > 0) priceOf.set(c.mint, c.lastPriceSol);

  let balance = await readBalance(supabase);

  const openTrades = await selErr(
    supabase.from("solana_paper_trades").select("*").eq("status", "open").order("opened_at", { ascending: false }),
  );

  // Mark prices for open positions whose token isn't in the recent feed.
  for (const t of openTrades) {
    if (!priceOf.has(t.token_mint)) {
      const p = await fetchCoinPrice(t.token_mint);
      if (p && p > 0) priceOf.set(t.token_mint, p);
    }
  }

  // 3a) Manage open positions.
  let openValue = 0;
  for (const t of openTrades) {
    const price = priceOf.get(t.token_mint) ?? num(t.current_price_sol, num(t.entry_price_sol));
    const r = managePosition(t, price);
    balance += r.proceeds;
    if (r.patch) {
      const { error } = await supabase.from("solana_paper_trades").update(r.patch).eq("id", t.id);
      if (error) throw new Error(`update_trade_${error.message}`);
    }
    if (r.stillOpen) openValue += r.remainingTokens * price;
  }

  // 3b) Open new positions from un-acted BUY signals.
  const openMints = new Set(openTrades.filter((t) => t.status === "open").map((t) => t.token_mint));
  let openCount = openTrades.length; // closed ones this tick free up slots next tick; keep simple
  const actionable = await selErr(
    supabase.from("solana_signals").select("*").eq("acted_on", 0)
      .eq("signal_type", "momentum_launch").order("created_at", { ascending: false }).limit(20),
  );
  for (const sig of actionable) {
    if (openCount >= MAX_OPEN) break;
    if (openMints.has(sig.token_mint)) { await markActed(supabase, sig.id, null); continue; }
    const price = priceOf.get(sig.token_mint);
    if (!price || price <= 0) continue;
    const size = Math.min(MAX_POS_SOL, balance * POS_FRACTION);
    if (size < 0.5 || balance < size) break;
    const tokens = size / price;
    const id = crypto.randomUUID();
    const { error } = await supabase.from("solana_paper_trades").insert({
      id, token_mint: sig.token_mint, token_symbol: sig.token_symbol, side: "LONG",
      entry_price_sol: price, current_price_sol: price, size_sol: round(size, 6),
      tokens, remaining_tokens: tokens, peak_price_sol: price, status: "open",
      realized_sol: 0, signal_reason: sig.reason, opened_at: nowIso(),
    });
    if (error) throw new Error(`open_trade_${error.message}`);
    balance -= size;
    openValue += tokens * price;
    openMints.add(sig.token_mint);
    openCount++;
    await markActed(supabase, sig.id, id);
  }

  // 4) Persist balance + equity snapshot.
  balance = round(Math.max(balance, 0), 6);
  openValue = round(openValue, 6);
  await writeBalance(supabase, balance);
  const { error: eqErr } = await supabase.from("solana_equity_snapshots").insert({
    balance_sol: balance, open_value_sol: openValue, total_sol: round(balance + openValue, 6), ts: nowIso(),
  });
  if (eqErr) throw new Error(`equity_${eqErr.message}`);

  return {
    ok: true,
    tokens: coins.length,
    signals: newSignals.length,
    openPositions: openCount,
    balanceSol: balance,
    totalSol: round(balance + openValue, 6),
  };
}

// ── position management ──────────────────────────────────────────────────────

function managePosition(t: any, price: number) {
  const entry = num(t.entry_price_sol);
  const origTokens = num(t.tokens);
  let remaining = num(t.remaining_tokens, origTokens);
  let realized = num(t.realized_sol);
  let peak = Math.max(num(t.peak_price_sol, entry), price);
  let tp1 = num(t.tp1_hit), tp2 = num(t.tp2_hit), tp3 = num(t.tp3_hit);
  const sl = num(t.sl_pct, 0.10), trail = num(t.trailing_stop_pct, 0.15);
  const tp1p = num(t.tp1_pct, 0.25), tp2p = num(t.tp2_pct, 0.50), tp3p = num(t.tp3_pct, 1.00);
  let proceeds = 0;
  let closeReason: string | null = null;

  const sell = (fracOfOriginal: number) => {
    const sold = Math.min(remaining, origTokens * fracOfOriginal);
    if (sold <= 0) return;
    const got = sold * price;
    remaining -= sold; realized += got; proceeds += got;
  };

  if (price > 0 && entry > 0) {
    // Bank gains on the way up.
    if (!tp1 && price >= entry * (1 + tp1p)) { sell(0.40); tp1 = 1; }
    if (!tp2 && price >= entry * (1 + tp2p)) { sell(0.35); tp2 = 1; }
    if (!tp3 && price >= entry * (1 + tp3p)) { sell(1.0); tp3 = 1; closeReason = "tp3"; }
    // Protective exits.
    if (!closeReason && price <= entry * (1 - sl)) { sell(1.0); closeReason = "stop_loss"; }
    if (!closeReason && tp1 && price <= peak * (1 - trail)) { sell(1.0); closeReason = "trailing_stop"; }
  }

  const closed = remaining <= origTokens * 1e-6 || closeReason !== null;
  if (closed) {
    const pnl = realized - num(t.size_sol);
    return {
      proceeds, stillOpen: false, remainingTokens: 0,
      patch: {
        status: "closed", current_price_sol: price, exit_price_sol: price,
        remaining_tokens: 0, realized_sol: round(realized, 8),
        tp1_hit: tp1, tp2_hit: tp2, tp3_hit: tp3, peak_price_sol: peak,
        pnl_sol: round(pnl, 8), pnl_pct: round(num(t.size_sol) > 0 ? (pnl / num(t.size_sol)) * 100 : 0, 4),
        closed_at: nowIso(),
      },
    };
  }
  const unrealized = realized + remaining * price - num(t.size_sol);
  return {
    proceeds, stillOpen: true, remainingTokens: remaining,
    patch: {
      current_price_sol: price, remaining_tokens: round(remaining, 8), realized_sol: round(realized, 8),
      tp1_hit: tp1, tp2_hit: tp2, tp3_hit: tp3, peak_price_sol: peak,
      pnl_sol: round(unrealized, 8), pnl_pct: round(num(t.size_sol) > 0 ? (unrealized / num(t.size_sol)) * 100 : 0, 4),
    },
  };
}

// ── small DB helpers ─────────────────────────────────────────────────────────

async function selErr(promise: any): Promise<any[]> {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return (data ?? []) as any[];
}

async function markActed(supabase: any, signalId: string, tradeId: string | null) {
  await supabase.from("solana_signals").update({ acted_on: 1, trade_id: tradeId }).eq("id", signalId);
}

async function readBalance(supabase: any): Promise<number> {
  const rows = await selErr(supabase.from("org_state").select("value").eq("key", "solana_paper_balance").limit(1));
  if (!rows.length) return START_BALANCE;
  const raw = rows[0].value;
  // value is stored as a JSON-stringified number (e.g. "100.5"); Number() handles both.
  const n = Number(typeof raw === "string" ? raw.replace(/^"|"$/g, "") : raw);
  return Number.isFinite(n) ? n : START_BALANCE;
}

async function writeBalance(supabase: any, balance: number) {
  const { error } = await supabase.from("org_state").upsert(
    { key: "solana_paper_balance", value: JSON.stringify(balance), updated_at: nowIso() },
    { onConflict: "key" },
  );
  if (error) throw new Error(`balance_${error.message}`);
}
