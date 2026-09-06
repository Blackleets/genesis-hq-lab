const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
const FUTURES_TYPES = [
  'crypto_futures_breakout_short_micro',
  'crypto_futures_breakout_short',
  'crypto_futures_breakout_short_alt',
  'crypto_futures_breakout_long',
];
const PROFILE_BY_TYPE: Record<string, string> = {
  crypto_futures_breakout_short_micro: 'short_micro',
  crypto_futures_breakout_short: 'short_core',
  crypto_futures_breakout_short_alt: 'short_alt',
  crypto_futures_breakout_long: 'long_probe',
};
const HEADERS = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,OPTIONS',
    },
  });
}
function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}
function round(value: number, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
function summarize(rows: any[]) {
  const closed = rows.filter((trade) => trade.status === 'closed' && Number.isFinite(trade.pnl));
  const wins = closed.filter((trade) => Number(trade.pnl) > 0);
  const losses = closed.filter((trade) => Number(trade.pnl) < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + Number(trade.pnl), 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + Number(trade.pnl), 0));
  const realizedPnl = closed.reduce((sum, trade) => sum + Number(trade.pnl), 0);
  const avgWin = wins.length ? grossProfit / wins.length : null;
  const avgLoss = losses.length ? grossLoss / losses.length : null;
  const ordered = [...closed].sort((a, b) => {
    const aTime = Date.parse(a.closedAt ?? a.openedAt ?? '') || 0;
    const bTime = Date.parse(b.closedAt ?? b.openedAt ?? '') || 0;
    return aTime - bTime;
  });
  let curve = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const trade of ordered) {
    curve += Number(trade.pnl);
    peak = Math.max(peak, curve);
    maxDrawdown = Math.max(maxDrawdown, peak - curve);
  }
  return {
    trades: rows.length,
    closed: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? wins.length / closed.length : null,
    realizedPnl: round(realizedPnl),
    grossProfit: round(grossProfit),
    grossLoss: round(grossLoss),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 4) : null,
    avgWin: avgWin == null ? null : round(avgWin),
    avgLoss: avgLoss == null ? null : round(avgLoss),
    payoffRatio: avgWin != null && avgLoss != null && avgLoss > 0 ? round(avgWin / avgLoss, 4) : null,
    expectancy: closed.length ? round(realizedPnl / closed.length, 4) : null,
    maxDrawdown: round(maxDrawdown),
  };
}
async function rest(path: string) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok) throw new Error(`rest_${response.status}`);
  return await response.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method !== 'GET') return json({ ok: false, error: 'method_not_allowed' }, 405);
  try {
    const [stateRows, tradeRows] = await Promise.all([
      rest('org_state?key=eq.external_runner_heartbeat&select=value,updated_at&limit=1'),
      rest(`trades?trade_type=in.(${FUTURES_TYPES.join(',')})&select=id,asset_pair,outcome,status,mode,entry_price,exit_price,target_price,stop_price,pnl,opened_at,closed_at,exit_reason,trade_type,leverage,capital_used&order=opened_at.desc&limit=80`),
    ]);

    const row = stateRows?.[0];
    const heartbeat: any = parseJson(row?.value, null);
    const lastTickAt = heartbeat?.lastTickAt ?? null;
    const msSinceLastTick = lastTickAt ? Date.now() - Date.parse(lastTickAt) : null;
    const recentTrades = (Array.isArray(tradeRows) ? tradeRows : []).map((trade: any) => ({
      id: String(trade.id), pair: trade.asset_pair ?? '', side: trade.outcome === 'SHORT' ? 'SHORT' : 'LONG',
      status: trade.status === 'open' ? 'open' : 'closed', mode: 'paper',
      entryPrice: trade.entry_price == null ? null : Number(trade.entry_price),
      exitPrice: trade.exit_price == null ? null : Number(trade.exit_price),
      targetPrice: trade.target_price == null ? null : Number(trade.target_price),
      stopPrice: trade.stop_price == null ? null : Number(trade.stop_price),
      pnl: trade.pnl == null ? null : Number(trade.pnl), openedAt: trade.opened_at ?? null,
      closedAt: trade.closed_at ?? null, exitReason: trade.exit_reason ?? null, tradeType: trade.trade_type ?? null,
      leverage: trade.leverage == null ? null : Number(trade.leverage), capitalUsed: trade.capital_used == null ? null : Number(trade.capital_used),
    }));
    const openPositions = recentTrades.filter((trade: any) => trade.status === 'open');
    const overall = summarize(recentTrades);
    const cohorts = Object.fromEntries(Object.entries(PROFILE_BY_TYPE).map(([tradeType, profile]) => [
      profile,
      summarize(recentTrades.filter((trade: any) => trade.tradeType === tradeType)),
    ]));

    return json({
      ok: true, source: heartbeat?.source ?? 'unknown', lastTickAt,
      totalCycles: Number(heartbeat?.totalCycles ?? 0),
      agentAlive: Number.isFinite(msSinceLastTick) && msSinceLastTick < 10 * 60 * 1000,
      msSinceLastTick: Number.isFinite(msSinceLastTick) ? msSinceLastTick : null,
      paperOnly: heartbeat?.paperOnly === true, liveOrders: heartbeat?.liveOrders === true,
      lastResult: heartbeat?.lastResult ?? null,
      openTrades: openPositions.length,
      openPositions,
      recentTrades,
      stats: {
        sampleTrades: overall.trades,
        sampleClosed: overall.closed,
        openPositions: openPositions.length,
        sampleRealizedPnl: overall.realizedPnl,
        sampleWinRate: overall.winRate,
        profitFactor: overall.profitFactor,
        expectancy: overall.expectancy,
        avgWin: overall.avgWin,
        avgLoss: overall.avgLoss,
        payoffRatio: overall.payoffRatio,
        maxDrawdown: overall.maxDrawdown,
        grossProfit: overall.grossProfit,
        grossLoss: overall.grossLoss,
        cohorts,
        windowLimit: 80,
      },
      updatedAt: row?.updated_at ?? null,
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'status_failed' }, 500);
  }
});
