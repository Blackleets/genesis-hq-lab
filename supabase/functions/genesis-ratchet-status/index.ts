declare const Deno: any;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
const STATUS_VERSION = 'profit_ratchet_status_v1';
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

function n(value: unknown) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function round(value: number | null, digits = 4) {
  if (value == null || !Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
function median(values: number[]) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

async function rest(path: string) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok) throw new Error(`rest_${response.status}:${await response.text()}`);
  return await response.json();
}

function mapRow(row: any) {
  const mfe = Math.max(0, n(row.mfe_net_usd) ?? 0);
  const current = n(row.current_net_pnl_usd);
  const realized = n(row.realized_net_pnl_usd);
  const protectedFloor = Math.max(0, n(row.max_protected_profit_usd) ?? 0);
  const activePnl = realized ?? current;
  const giveback = activePnl == null ? null : Math.max(0, mfe - activePnl);
  const capture = activePnl == null || mfe <= 0 ? null : activePnl / mfe;
  return {
    tradeId: row.trade_id,
    strategyVersionId: row.strategy_version_id,
    runnerVersion: row.runner_version,
    exitPolicyVersion: row.exit_policy_version,
    pair: row.asset_pair,
    side: row.side,
    entryRegime: row.entry_regime,
    entrySession: row.entry_session,
    leverage: n(row.leverage),
    notionalUsd: n(row.notional_usd),
    initialStopPrice: n(row.initial_stop_price),
    currentRatchetStop: n(row.last_ratchet_stop_price),
    mfeNetUsd: mfe,
    maeObservedNetUsd: n(row.mae_observed_net_usd),
    protectedFloorUsd: protectedFloor,
    currentNetPnlUsd: current,
    realizedNetPnlUsd: realized,
    givebackUsd: giveback,
    captureEfficiency: capture,
    givebackPctMfe: mfe > 0 && giveback != null ? giveback / mfe : null,
    protectedProfitEfficiency: n(row.protected_profit_efficiency),
    ratchetActivated: row.ratchet_activated === true,
    ratchetRaiseCount: Number(row.ratchet_raise_count || 0),
    ratchetSaveExit: row.ratchet_save_exit === true,
    winnerLost: row.winner_lost === true,
    counterfactualWithoutRatchetProven: row.counterfactual_without_ratchet_proven === true,
    counterfactualNote: row.counterfactual_note,
    marketStrength: row.activation_strength || row.last_strength || row.close_strength || null,
    regime: row.activation_regime || row.last_regime || row.close_regime || row.entry_regime || null,
    momentum20: n(row.last_momentum20 ?? row.close_momentum20 ?? row.activation_momentum20),
    orderBookImbalance: n(row.last_order_book_imbalance ?? row.close_order_book_imbalance ?? row.activation_order_book_imbalance),
    atrPct: n(row.last_atr_pct ?? row.close_atr_pct ?? row.activation_atr_pct),
    activationAt: row.activation_at,
    lastContextAt: row.last_context_at,
    closeContextAt: row.close_context_at,
    closeContextSource: row.close_context_source,
    exitReason: row.exit_reason,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    observationCount: Number(row.observation_count || 0),
    telemetryScope: row.telemetry_scope,
  };
}

function summary(rows: any[]) {
  const closed = rows.filter((row) => row.closedAt && row.realizedNetPnlUsd != null);
  const mfes = closed.map((row) => row.mfeNetUsd).filter(Number.isFinite);
  const captures = closed.map((row) => row.captureEfficiency).filter(Number.isFinite);
  const givebacks = closed.map((row) => row.givebackUsd).filter(Number.isFinite);
  const realized = closed.map((row) => row.realizedNetPnlUsd).filter(Number.isFinite);
  const significant = closed.filter((row) => row.mfeNetUsd >= 5);
  const winnerLost = significant.filter((row) => row.winnerLost);
  const activated = closed.filter((row) => row.ratchetActivated);
  const saves = closed.filter((row) => row.ratchetSaveExit);
  const pnl = realized.reduce((sum, value) => sum + value, 0);
  return {
    closed: closed.length,
    realizedPnl: round(pnl),
    expectancy: closed.length ? round(pnl / closed.length) : null,
    avgMfe: round(mean(mfes)),
    medianMfe: round(median(mfes)),
    avgCaptureEfficiency: round(mean(captures), 6),
    medianCaptureEfficiency: round(median(captures), 6),
    avgGivebackUsd: round(mean(givebacks)),
    winnerLostCount: winnerLost.length,
    winnerLostRate: significant.length ? round(winnerLost.length / significant.length, 6) : null,
    ratchetActivationRate: closed.length ? round(activated.length / closed.length, 6) : null,
    ratchetSaveExits: saves.length,
    observedRatchetSaveExitRate: activated.length ? round(saves.length / activated.length, 6) : null,
    counterfactualWithoutRatchet: 'NOT_DEMONSTRABLE_FROM_OBSERVED_PATH',
    earlyDiagnosticReady: closed.length >= 10,
    strongerReviewReady: closed.length >= 20,
    automaticTuning: false,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method !== 'GET') return json({ ok: false, error: 'method_not_allowed' }, 405);
  try {
    const select = [
      'trade_id','strategy_version_id','runner_version','exit_policy_version','asset_pair','side','entry_regime','entry_session','leverage','notional_usd',
      'initial_stop_price','last_ratchet_stop_price','mfe_net_usd','mae_observed_net_usd','max_protected_profit_usd','current_net_pnl_usd','realized_net_pnl_usd',
      'protected_profit_efficiency','ratchet_activated','ratchet_raise_count','ratchet_save_exit','winner_lost','counterfactual_without_ratchet_proven','counterfactual_note',
      'activation_at','activation_strength','activation_regime','activation_momentum20','activation_order_book_imbalance','activation_atr_pct',
      'last_context_at','last_strength','last_regime','last_momentum20','last_order_book_imbalance','last_atr_pct',
      'close_context_at','close_strength','close_regime','close_momentum20','close_order_book_imbalance','close_atr_pct','close_context_source',
      'exit_reason','opened_at','closed_at','observation_count','telemetry_scope'
    ].join(',');
    const rows = await rest(`futures_ratchet_telemetry?strategy_version_id=like.*%3Av9&select=${encodeURIComponent(select)}&order=opened_at.desc&limit=160`);
    const telemetry = (Array.isArray(rows) ? rows : []).map(mapRow);
    const open = telemetry.filter((row) => !row.closedAt);
    const closed = telemetry.filter((row) => Boolean(row.closedAt));
    return json({
      ok: true,
      statusVersion: STATUS_VERSION,
      strategyScope: 'v9_only',
      exitPolicyScope: 'adaptive_profit_ratchet_v1',
      paperOnly: true,
      liveOrders: false,
      open,
      closed,
      summary: summary(telemetry),
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return json({ ok: false, statusVersion: STATUS_VERSION, paperOnly: true, liveOrders: false, error: error instanceof Error ? error.message : 'status_failed' }, 500);
  }
});
