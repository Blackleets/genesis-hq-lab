declare const Deno: any;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
const STATUS_VERSION = 'v4';
const RUNTIME_KEY = 'quant_validation_runtime_v1';
const CHALLENGER_KEY = 'quant_challenger_lab_v1';
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
function mean(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function std(values: number[]) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / (values.length - 1));
}
function summarize(rows: any[]) {
  const closed = rows.filter((trade) => trade.status === 'closed' && Number.isFinite(Number(trade.pnl)));
  const pnl = closed.map((trade) => Number(trade.pnl));
  const wins = pnl.filter((value) => value > 0), losses = pnl.filter((value) => value < 0);
  const grossProfit = wins.reduce((sum, value) => sum + value, 0), grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0)), realizedPnl = pnl.reduce((sum, value) => sum + value, 0);
  const avgWin = wins.length ? grossProfit / wins.length : null, avgLoss = losses.length ? grossLoss / losses.length : null, expectancy = closed.length ? realizedPnl / closed.length : null;
  const pnlStd = std(pnl), downsideStd = std(pnl.filter((value) => value < 0));
  const tStat = closed.length >= 2 && pnlStd > 0 && expectancy != null ? expectancy / (pnlStd / Math.sqrt(closed.length)) : null;
  const sharpeProxy = pnlStd > 0 && expectancy != null ? expectancy / pnlStd : null, sortinoProxy = downsideStd > 0 && expectancy != null ? expectancy / downsideStd : null;
  const ordered = [...closed].sort((a, b) => (Date.parse(a.closedAt ?? a.openedAt ?? '') || 0) - (Date.parse(b.closedAt ?? b.openedAt ?? '') || 0));
  let curve = 0, peak = 0, maxDrawdown = 0, lossStreak = 0, maxLossStreak = 0;
  for (const trade of ordered) {
    const value = Number(trade.pnl); curve += value; peak = Math.max(peak, curve); maxDrawdown = Math.max(maxDrawdown, peak - curve);
    if (value < 0) { lossStreak++; maxLossStreak = Math.max(maxLossStreak, lossStreak); } else lossStreak = 0;
  }
  return {
    trades: rows.length, closed: closed.length, wins: wins.length, losses: losses.length, winRate: closed.length ? wins.length / closed.length : null,
    realizedPnl: round(realizedPnl), grossProfit: round(grossProfit), grossLoss: round(grossLoss), profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 4) : null,
    avgWin: avgWin == null ? null : round(avgWin), avgLoss: avgLoss == null ? null : round(avgLoss), payoffRatio: avgWin != null && avgLoss != null && avgLoss > 0 ? round(avgWin / avgLoss, 4) : null,
    expectancy: expectancy == null ? null : round(expectancy, 4), maxDrawdown: round(maxDrawdown), sharpeProxy: sharpeProxy == null ? null : round(sharpeProxy, 4),
    sortinoProxy: sortinoProxy == null ? null : round(sortinoProxy, 4), tStat: tStat == null ? null : round(tStat, 4), maxLossStreak,
  };
}
function breakdown(rows: any[], field: 'entryRegime' | 'entrySession') {
  const groups: Record<string, any[]> = {};
  for (const row of rows) { const key = String(row[field] || 'UNATTRIBUTED'); (groups[key] ||= []).push(row); }
  return Object.fromEntries(Object.entries(groups).map(([key, sample]) => [key, summarize(sample)]));
}
async function rest(path: string) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HEADERS, signal: AbortSignal.timeout(6_000) });
  if (!response.ok) throw new Error(`rest_${response.status}:${await response.text()}`);
  return await response.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method !== 'GET') return json({ ok: false, error: 'method_not_allowed' }, 405);
  try {
    const [stateRows, runtimeRows, challengerRows, tradeRows, strategyRows, snapshotRows] = await Promise.all([
      rest('org_state?key=eq.external_runner_heartbeat&select=value,updated_at&limit=1'),
      rest(`org_state?key=eq.${RUNTIME_KEY}&select=value,updated_at&limit=1`),
      rest(`org_state?key=eq.${CHALLENGER_KEY}&select=value,updated_at&limit=1`),
      rest(`trades?trade_type=in.(${FUTURES_TYPES.join(',')})&select=id,asset_pair,outcome,status,mode,entry_price,exit_price,target_price,stop_price,pnl,opened_at,closed_at,exit_reason,trade_type,leverage,capital_used,strategy_version_id,entry_regime,entry_session,runner_version,validation_status&order=opened_at.desc&limit=160`),
      rest('strategy_versions?select=id,strategy_id,profile_id,version,trade_type,status,parent_version_id,params,created_at,activated_at,retired_at,updated_at&order=created_at.desc&limit=40'),
      rest('strategy_validation_snapshots?select=strategy_version_id,evaluated_at,sample_closed,wins,losses,win_rate,realized_pnl,profit_factor,expectancy,payoff_ratio,max_drawdown_usd,max_drawdown_pct,sharpe_proxy,sortino_proxy,t_stat,max_loss_streak,regime_breakdown,session_breakdown,gates,verdict,reason,policy_version,runner_version&order=evaluated_at.desc&limit=40'),
    ]);
    const row = stateRows?.[0], heartbeat: any = parseJson(row?.value, null), runtimeRow = runtimeRows?.[0], validationRuntime: any = parseJson(runtimeRow?.value, null);
    const challengerRow = challengerRows?.[0], challengerLab: any = parseJson(challengerRow?.value, null);
    const lastTickAt = heartbeat?.lastTickAt ?? null, msSinceLastTick = lastTickAt ? Date.now() - Date.parse(lastTickAt) : null;
    const recentTrades = (Array.isArray(tradeRows) ? tradeRows : []).map((trade: any) => ({
      id: String(trade.id), pair: trade.asset_pair ?? '', side: trade.outcome === 'SHORT' ? 'SHORT' : 'LONG', status: trade.status === 'open' ? 'open' : 'closed', mode: 'paper',
      entryPrice: trade.entry_price == null ? null : Number(trade.entry_price), exitPrice: trade.exit_price == null ? null : Number(trade.exit_price), targetPrice: trade.target_price == null ? null : Number(trade.target_price), stopPrice: trade.stop_price == null ? null : Number(trade.stop_price),
      pnl: trade.pnl == null ? null : Number(trade.pnl), openedAt: trade.opened_at ?? null, closedAt: trade.closed_at ?? null, exitReason: trade.exit_reason ?? null, tradeType: trade.trade_type ?? null,
      leverage: trade.leverage == null ? null : Number(trade.leverage), capitalUsed: trade.capital_used == null ? null : Number(trade.capital_used), strategyVersionId: trade.strategy_version_id ?? null,
      entryRegime: trade.entry_regime ?? null, entrySession: trade.entry_session ?? null, runnerVersion: trade.runner_version ?? null, validationStatus: trade.validation_status ?? null,
    }));
    const openPositions = recentTrades.filter((trade: any) => trade.status === 'open'), overall = summarize(recentTrades);
    const cohorts = Object.fromEntries(Object.entries(PROFILE_BY_TYPE).map(([tradeType, profile]) => [profile, summarize(recentTrades.filter((trade: any) => trade.tradeType === tradeType))]));
    const currentVersions = (Array.isArray(strategyRows) ? strategyRows : []).filter((version: any) => version.version === 'v8');
    const versionCohorts = Object.fromEntries(currentVersions.map((version: any) => {
      const sample = recentTrades.filter((trade: any) => trade.strategyVersionId === version.id);
      return [version.profile_id, { strategyVersionId: version.id, strategyId: version.strategy_id, version: version.version, status: version.status, ...summarize(sample), regimeBreakdown: breakdown(sample, 'entryRegime'), sessionBreakdown: breakdown(sample, 'entrySession') }];
    }));
    const latestSnapshotByVersion: Record<string, any> = {};
    for (const snapshot of Array.isArray(snapshotRows) ? snapshotRows : []) if (!latestSnapshotByVersion[snapshot.strategy_version_id]) latestSnapshotByVersion[snapshot.strategy_version_id] = snapshot;
    return json({
      ok: true, statusVersion: STATUS_VERSION, source: heartbeat?.source ?? 'unknown', runnerVersion: heartbeat?.runnerVersion ?? heartbeat?.lastResult?.runnerVersion ?? null,
      validationEngineVersion: heartbeat?.validationEngineVersion ?? heartbeat?.lastResult?.validationEngineVersion ?? null, lastTickAt, totalCycles: Number(heartbeat?.totalCycles ?? 0),
      agentAlive: Number.isFinite(msSinceLastTick) && msSinceLastTick < 10 * 60 * 1000, msSinceLastTick: Number.isFinite(msSinceLastTick) ? msSinceLastTick : null,
      paperOnly: heartbeat?.paperOnly === true, liveOrders: heartbeat?.liveOrders === true, lastResult: heartbeat?.lastResult ?? null, openTrades: openPositions.length, openPositions, recentTrades,
      stats: {
        sampleTrades: overall.trades, sampleClosed: overall.closed, openPositions: openPositions.length, sampleRealizedPnl: overall.realizedPnl, sampleWinRate: overall.winRate,
        profitFactor: overall.profitFactor, expectancy: overall.expectancy, avgWin: overall.avgWin, avgLoss: overall.avgLoss, payoffRatio: overall.payoffRatio, maxDrawdown: overall.maxDrawdown,
        sharpeProxy: overall.sharpeProxy, sortinoProxy: overall.sortinoProxy, tStat: overall.tStat, maxLossStreak: overall.maxLossStreak, grossProfit: overall.grossProfit, grossLoss: overall.grossLoss,
        cohorts, versionCohorts, windowLimit: 160,
      },
      validationEngine: {
        ok: validationRuntime?.ok === true, engineVersion: validationRuntime?.engineVersion ?? null, policy: validationRuntime?.policy ?? null, validations: validationRuntime?.validations ?? {},
        familyEvidence: validationRuntime?.familyEvidence ?? {}, blockedProfiles: validationRuntime?.blockedProfiles ?? [], evaluatedAt: validationRuntime?.evaluatedAt ?? runtimeRow?.updated_at ?? null,
        strategyVersions: currentVersions, latestSnapshots: latestSnapshotByVersion,
      },
      challengerLab: challengerLab ? {
        ok: challengerLab?.ok === true,
        engineVersion: challengerLab?.engineVersion ?? null,
        mode: challengerLab?.mode ?? null,
        executionAuthority: challengerLab?.executionAuthority === true,
        paperOnly: challengerLab?.paperOnly === true,
        liveOrders: challengerLab?.liveOrders === true,
        survivorCount: Number(challengerLab?.survivorCount ?? 0),
        profiles: challengerLab?.profiles ?? {},
        antiOverfitPolicy: challengerLab?.antiOverfitPolicy ?? null,
        completedAt: challengerLab?.completedAt ?? challengerRow?.updated_at ?? null,
      } : null,
      updatedAt: row?.updated_at ?? null,
    });
  } catch (error) {
    return json({ ok: false, statusVersion: STATUS_VERSION, error: error instanceof Error ? error.message : 'status_failed' }, 500);
  }
});
