import { query } from './postgres.js';

const CRYPTO_TRADE_TYPES = ['crypto_scalp', 'scalp_v2', 'swing_v1', 'breakout_v1'];
const FUTURES_TRADE_TYPES = [
  'crypto_futures_breakout_short_micro',
  'crypto_futures_breakout_short',
  'crypto_futures_breakout_short_alt',
  'crypto_futures_breakout_long',
];
const ALL_CRYPTO_TYPES = [...CRYPTO_TRADE_TYPES, ...FUTURES_TRADE_TYPES];
const FUTURES_START_CAPITAL = Number.parseFloat(process.env.FUTURES_DESK_START_CAPITAL ?? '10000');
const BINANCE_BASE = process.env.BINANCE_BASE || 'https://data-api.binance.vision/api/v3';

function round2(value) {
  return value == null ? null : Math.round(value * 100) / 100;
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

async function getHostedRunnerHeartbeatFallback() {
  try {
    const res = await query(`
      SELECT value, updated_at
      FROM org_state
      WHERE key = 'external_runner_heartbeat'
      LIMIT 1
    `);
    const row = res.rows[0] ?? null;
    const payload = parseJson(row?.value, null);
    const lastTickAt = payload?.lastTickAt ?? null;
    const msSinceLastTick = lastTickAt
      ? Date.now() - new Date(lastTickAt).getTime()
      : null;
    return {
      source: payload?.source ?? 'external',
      lastTickAt,
      totalCycles: Number(payload?.totalCycles ?? 0),
      claudeEnabled: Boolean(payload?.claudeEnabled),
      lastResult: payload?.lastResult ?? null,
      msSinceLastTick: Number.isFinite(msSinceLastTick) ? msSinceLastTick : null,
      agentAlive: Number.isFinite(msSinceLastTick) ? msSinceLastTick < 10 * 60 * 1000 : false,
      neverStarted: !lastTickAt,
      updatedAt: row?.updated_at ?? null,
    };
  } catch {
    return {
      source: 'external',
      lastTickAt: null,
      totalCycles: 0,
      claudeEnabled: false,
      lastResult: null,
      msSinceLastTick: null,
      agentAlive: false,
      neverStarted: true,
      updatedAt: null,
    };
  }
}

function exitKind(exitReason) {
  switch (exitReason) {
    case 'take_profit': return 'TP';
    case 'stop_loss': return 'SL';
    case 'timeout': return 'TIMEOUT';
    case 'confidence_collapse': return 'CONFIDENCE';
    case null:
    case undefined: return null;
    default: return 'EXIT';
  }
}

async function getCurrentPrice(pair) {
  try {
    const res = await fetch(`${BINANCE_BASE}/ticker/price?symbol=${pair}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const json = await res.json();
    const price = Number.parseFloat(json.price);
    return Number.isFinite(price) ? price : null;
  } catch {
    return null;
  }
}

async function getCurrentPrices(pairs) {
  const unique = Array.from(new Set(pairs.filter(Boolean)));
  const prices = new Map();
  await Promise.all(unique.map(async (pair) => {
    prices.set(pair, await getCurrentPrice(pair));
  }));
  return prices;
}

export async function getCryptoOverviewFallback() {
  const closedRes = await query(`
    SELECT
      COUNT(*)::int AS total,
      COALESCE(SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END), 0)::int AS wins,
      COALESCE(SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END), 0)::int AS losses,
      COALESCE(SUM(pnl), 0)::float8 AS total_pnl,
      COALESCE(MAX(pnl), 0)::float8 AS best_trade,
      COALESCE(MIN(pnl), 0)::float8 AS worst_trade,
      COALESCE(AVG(pnl), 0)::float8 AS avg_pnl,
      COALESCE(SUM(capital_used), 0)::float8 AS total_risked
    FROM trades
    WHERE trade_type = ANY($1::text[]) AND status = 'closed'
  `, [CRYPTO_TRADE_TYPES]);
  const closed = closedRes.rows[0] ?? {};

  const openRes = await query(`
    SELECT
      COUNT(*)::int AS count,
      COALESCE(SUM(capital_used), 0)::float8 AS at_risk
    FROM trades
    WHERE trade_type = ANY($1::text[]) AND status = 'open'
  `, [CRYPTO_TRADE_TYPES]);
  const open = openRes.rows[0] ?? {};

  const byAssetRes = await query(`
    SELECT asset_pair AS pair,
           COUNT(*)::int AS trades,
           COALESCE(SUM(pnl), 0)::float8 AS pnl,
           COALESCE(SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END), 0)::int AS wins
    FROM trades
    WHERE trade_type = ANY($1::text[]) AND status = 'closed'
    GROUP BY asset_pair
    ORDER BY pnl DESC
  `, [CRYPTO_TRADE_TYPES]);

  const positionsRes = await query(`
    SELECT id, asset_pair AS pair, outcome AS side, entry_price, target_price, stop_price,
           capital_used, confidence, opened_at
    FROM trades
    WHERE trade_type = ANY($1::text[]) AND status = 'open'
    ORDER BY opened_at DESC
  `, [CRYPTO_TRADE_TYPES]);

  const recentRes = await query(`
    SELECT id, asset_pair AS pair, outcome AS side, entry_price, exit_price, pnl,
           exit_reason, confidence, opened_at, closed_at
    FROM trades
    WHERE trade_type = ANY($1::text[]) AND status = 'closed'
    ORDER BY closed_at DESC
    LIMIT 25
  `, [CRYPTO_TRADE_TYPES]);

  const total = Number(closed.total ?? 0);
  const wins = Number(closed.wins ?? 0);
  const totalRisked = Number(closed.total_risked ?? 0);
  const totalPnl = Number(closed.total_pnl ?? 0);

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
    paramsMeta: {
      meta: { source: 'vercel_supabase_fallback' },
      updatedAt: new Date().toISOString(),
    },
    pnl: {
      closed: {
        total,
        wins,
        losses: Number(closed.losses ?? 0),
        winRate: total > 0 ? wins / total : 0,
        totalPnl: round2(totalPnl) ?? 0,
        bestTrade: round2(Number(closed.best_trade ?? 0)) ?? 0,
        worstTrade: round2(Number(closed.worst_trade ?? 0)) ?? 0,
        avgPnl: round2(Number(closed.avg_pnl ?? 0)) ?? 0,
        totalRisked: round2(totalRisked) ?? 0,
        roi: totalRisked > 0 ? totalPnl / totalRisked : 0,
      },
      open: {
        count: Number(open.count ?? 0),
        atRisk: round2(Number(open.at_risk ?? 0)) ?? 0,
      },
      byAsset: byAssetRes.rows.map((row) => ({
        pair: row.pair,
        trades: Number(row.trades ?? 0),
        pnl: round2(Number(row.pnl ?? 0)) ?? 0,
        wins: Number(row.wins ?? 0),
        winRate: Number(row.trades ?? 0) > 0 ? Number(row.wins ?? 0) / Number(row.trades) : 0,
      })),
    },
    positions: positionsRes.rows.map((row) => ({
      id: row.id,
      pair: row.pair,
      side: row.side,
      entry_price: Number(row.entry_price),
      target_price: Number(row.target_price),
      stop_price: Number(row.stop_price),
      capital_used: Number(row.capital_used),
      confidence: Number(row.confidence ?? 0),
      opened_at: row.opened_at,
    })),
    recent: recentRes.rows.map((row) => ({
      id: row.id,
      pair: row.pair,
      side: row.side,
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

export async function getTradeStoriesFallback(limit = 40, pair = null) {
  const sql = `
    SELECT id, asset_pair, outcome, agent_id, trade_type, capital_used, leverage,
           entry_price, exit_price, target_price, stop_price,
           pnl, confidence, reason, evidence, exit_reason, opened_at, closed_at, status
    FROM trades
    WHERE trade_type = ANY($1::text[])
      ${pair ? 'AND asset_pair = $2' : ''}
    ORDER BY COALESCE(closed_at, opened_at) DESC
    LIMIT $${pair ? '3' : '2'}
  `;
  const params = pair ? [ALL_CRYPTO_TYPES, pair, Math.min(120, Math.max(1, limit))] : [ALL_CRYPTO_TYPES, Math.min(120, Math.max(1, limit))];
  const res = await query(sql, params);
  return res.rows.map((row) => ({
    id: row.id,
    pair: row.asset_pair ?? '',
    side: row.outcome === 'SHORT' ? 'SHORT' : 'LONG',
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
    reason: row.reason ?? '',
    evidence: parseJson(row.evidence, []),
    exit_reason: row.exit_reason ?? null,
    exit_kind: exitKind(row.exit_reason),
    opened_at: row.opened_at,
    closed_at: row.closed_at ?? null,
    status: row.status ?? 'open',
  }));
}

export async function getCommentaryFallback(limit = 40) {
  const eventRes = await query(`
    SELECT ts, category, reason, subsystem, severity, metadata
    FROM operator_events
    ORDER BY ts DESC
    LIMIT $1
  `, [Math.min(120, Math.max(1, limit))]);

  if (eventRes.rows.length > 0) {
    return eventRes.rows.map((row) => {
      const meta = parseJson(row.metadata, {});
      const detail = typeof meta.detail === 'string'
        ? meta.detail
        : typeof meta.note === 'string'
          ? meta.note
          : row.subsystem ?? 'fallback';
      return {
        ts: row.ts,
        type: row.category ?? 'INFO',
        text: row.reason ?? 'monitoring',
        detail,
        severity: row.severity ?? 'info',
        source: 'deterministic',
      };
    });
  }

  const trades = await getTradeStoriesFallback(Math.min(8, limit));
  return trades.map((trade) => ({
    ts: trade.closed_at ?? trade.opened_at,
    type: trade.status === 'closed' ? 'TRADE_CLOSED' : 'TRADE_OPEN',
    text: trade.status === 'closed'
      ? `${trade.pair} ${trade.exit_kind ?? 'EXIT'} ${trade.pnl == null ? '' : `${trade.pnl >= 0 ? '+' : ''}$${Math.abs(trade.pnl).toFixed(2)}`}`.trim()
      : `${trade.pair} ${trade.side} monitoring`,
    detail: trade.reason ?? 'monitoring',
    severity: trade.pnl != null && trade.pnl < 0 ? 'warning' : 'info',
    source: 'deterministic',
  }));
}

function defaultFuturesConfig() {
  return {
    breakoutPeriod: Number.parseInt(process.env.FUTURES_BREAKOUT_SHORT_CORE_PERIOD ?? '34', 10),
    regimeSmaPeriod: 55,
    tpPct: Number.parseFloat(process.env.FUTURES_BREAKOUT_TP_PCT ?? '0.12'),
    slPct: Number.parseFloat(process.env.FUTURES_BREAKOUT_SL_PCT ?? '0.03'),
    minExpectedNetUsd: Number.parseFloat(process.env.FUTURES_BREAKOUT_MIN_EXPECTED_NET_USD ?? '18'),
    minRewardRisk: Number.parseFloat(process.env.FUTURES_BREAKOUT_MIN_REWARD_RISK ?? '1.8'),
    timeoutHours: 4,
    maxMargin: Number.parseFloat(process.env.FUTURES_BREAKOUT_SHORT_CORE_MARGIN ?? '250'),
    leverage: Number.parseFloat(process.env.FUTURES_BREAKOUT_SHORT_CORE_LEVERAGE ?? '4'),
    governor: {
      windowDays: 14,
      degradeMinSamples: 8,
      pauseMinSamples: 12,
      evaluatedAt: new Date().toISOString(),
      supervisor: {
        maxDailyLoss: 0,
        maxConsecutiveLosses: 0,
        cooldownHours: 0,
      },
      profiles: [
        {
          id: 'short_micro',
          tradeType: FUTURES_TRADE_TYPES[0],
          trades: 0,
          wins: 0,
          winRate: null,
          totalPnl: 0,
          avgPnl: 0,
          expectancy: 0,
          profitFactor: null,
          maxDrawdown: 0,
          rankScore: 0,
          mode: 'learning',
          capitalMultiplier: 1,
          leverageMultiplier: 1,
          reason: 'fallback_snapshot',
          supervisor: {
            dailyTrades: 0,
            dailyPnl: 0,
            consecutiveLosses: 0,
            cooldownUntil: null,
            mode: 'live',
            reason: null,
          },
        },
        {
          id: 'short_core',
          tradeType: FUTURES_TRADE_TYPES[1],
          trades: 0,
          wins: 0,
          winRate: null,
          totalPnl: 0,
          avgPnl: 0,
          expectancy: 0,
          profitFactor: null,
          maxDrawdown: 0,
          rankScore: 0,
          mode: 'learning',
          capitalMultiplier: 1,
          leverageMultiplier: 1,
          reason: 'fallback_snapshot',
          supervisor: {
            dailyTrades: 0,
            dailyPnl: 0,
            consecutiveLosses: 0,
            cooldownUntil: null,
            mode: 'live',
            reason: null,
          },
        },
        {
          id: 'short_alt',
          tradeType: FUTURES_TRADE_TYPES[2],
          trades: 0,
          wins: 0,
          winRate: null,
          totalPnl: 0,
          avgPnl: 0,
          expectancy: 0,
          profitFactor: null,
          maxDrawdown: 0,
          rankScore: 0,
          mode: 'learning',
          capitalMultiplier: 1,
          leverageMultiplier: 1,
          reason: 'fallback_snapshot',
          supervisor: {
            dailyTrades: 0,
            dailyPnl: 0,
            consecutiveLosses: 0,
            cooldownUntil: null,
            mode: 'live',
            reason: null,
          },
        },
        {
          id: 'long_probe',
          tradeType: FUTURES_TRADE_TYPES[3],
          trades: 0,
          wins: 0,
          winRate: null,
          totalPnl: 0,
          avgPnl: 0,
          expectancy: 0,
          profitFactor: null,
          maxDrawdown: 0,
          rankScore: 0,
          mode: 'learning',
          capitalMultiplier: 1,
          leverageMultiplier: 1,
          reason: 'fallback_snapshot',
          supervisor: {
            dailyTrades: 0,
            dailyPnl: 0,
            consecutiveLosses: 0,
            cooldownUntil: null,
            mode: 'live',
            reason: null,
          },
        },
      ],
    },
    profiles: [
      {
        id: 'short_micro',
        enabled: true,
        agentId: 'futures_breakout_short_micro',
        tradeType: FUTURES_TRADE_TYPES[0],
        tier: 'fast',
        interval: '5m',
        breakoutPeriod: Number.parseInt(process.env.FUTURES_BREAKOUT_SHORT_MICRO_PERIOD ?? '20', 10),
        maxMargin: Number.parseFloat(process.env.FUTURES_BREAKOUT_SHORT_MICRO_MARGIN ?? '150'),
        timeoutHours: 2,
        minExpectedNetUsd: Number.parseFloat(process.env.FUTURES_BREAKOUT_MIN_EXPECTED_NET_USD ?? '18'),
        minRewardRisk: Number.parseFloat(process.env.FUTURES_BREAKOUT_MIN_REWARD_RISK ?? '1.8'),
        pairs: (process.env.FUTURES_BREAKOUT_SHORT_MICRO_PAIRS ?? 'BTCUSDT,ETHUSDT').split(','),
      },
      {
        id: 'short_core',
        enabled: true,
        agentId: 'futures_breakout_short_core',
        tradeType: FUTURES_TRADE_TYPES[1],
        tier: 'mid',
        interval: '1h',
        breakoutPeriod: Number.parseInt(process.env.FUTURES_BREAKOUT_SHORT_CORE_PERIOD ?? '34', 10),
        maxMargin: Number.parseFloat(process.env.FUTURES_BREAKOUT_SHORT_CORE_MARGIN ?? '250'),
        timeoutHours: 4,
        minExpectedNetUsd: Number.parseFloat(process.env.FUTURES_BREAKOUT_MIN_EXPECTED_NET_USD ?? '18'),
        minRewardRisk: Number.parseFloat(process.env.FUTURES_BREAKOUT_MIN_REWARD_RISK ?? '1.8'),
        pairs: (process.env.FUTURES_BREAKOUT_SHORT_PAIRS ?? 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT').split(','),
      },
      {
        id: 'short_alt',
        enabled: true,
        agentId: 'futures_breakout_short_alt',
        tradeType: FUTURES_TRADE_TYPES[2],
        tier: 'alt',
        interval: '15m',
        breakoutPeriod: Number.parseInt(process.env.FUTURES_BREAKOUT_SHORT_ALT_PERIOD ?? '12', 10),
        maxMargin: Number.parseFloat(process.env.FUTURES_BREAKOUT_SHORT_ALT_MARGIN ?? '200'),
        timeoutHours: 3,
        minExpectedNetUsd: Number.parseFloat(process.env.FUTURES_BREAKOUT_MIN_EXPECTED_NET_USD ?? '18'),
        minRewardRisk: Number.parseFloat(process.env.FUTURES_BREAKOUT_MIN_REWARD_RISK ?? '1.8'),
        pairs: (process.env.FUTURES_BREAKOUT_SHORT_ALT_PAIRS ?? 'XRPUSDT,DOGEUSDT').split(','),
      },
      {
        id: 'long_probe',
        enabled: true,
        agentId: 'futures_breakout_long_probe',
        tradeType: FUTURES_TRADE_TYPES[3],
        tier: 'slow',
        interval: '4h',
        breakoutPeriod: Number.parseInt(process.env.FUTURES_BREAKOUT_LONG_PROBE_PERIOD ?? '55', 10),
        maxMargin: Number.parseFloat(process.env.FUTURES_BREAKOUT_LONG_PROBE_MARGIN ?? '220'),
        timeoutHours: 6,
        minExpectedNetUsd: Number.parseFloat(process.env.FUTURES_BREAKOUT_MIN_EXPECTED_NET_USD ?? '18'),
        minRewardRisk: Number.parseFloat(process.env.FUTURES_BREAKOUT_MIN_REWARD_RISK ?? '1.8'),
        pairs: (process.env.FUTURES_BREAKOUT_LONG_PAIRS ?? 'BTCUSDT,ETHUSDT').split(','),
      },
    ],
  };
}

function mapRun(row) {
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

export async function getSupervisorLatestFallback() {
  const latestRes = await query(`
    SELECT * FROM intelligence_runs
    WHERE scope = 'futures_supervisor' AND status IN ('draft', 'recommended')
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const latestAttemptRes = await query(`
    SELECT * FROM intelligence_runs
    WHERE scope = 'futures_supervisor'
    ORDER BY created_at DESC
    LIMIT 1
  `);
  return {
    scope: 'futures_supervisor',
    latest: mapRun(latestRes.rows[0] ?? null),
    latestAttempt: mapRun(latestAttemptRes.rows[0] ?? null),
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

export async function getFuturesDeskFallback() {
  const config = defaultFuturesConfig();
  const openRes = await query(`
    SELECT id, trade_type, agent_id, asset_pair, outcome, entry_price, shares, capital_used,
           notional_usd, leverage, target_price, stop_price, liquidation_price, opened_at
    FROM trades
    WHERE status = 'open' AND trade_type = ANY($1::text[])
    ORDER BY opened_at DESC
  `, [FUTURES_TRADE_TYPES]);
  const prices = await getCurrentPrices(openRes.rows.map((row) => row.asset_pair));
  const openPositions = openRes.rows.map((row) => {
    const markPrice = prices.get(row.asset_pair) ?? null;
    const shares = Number(row.shares ?? 0);
    const entry = Number(row.entry_price ?? 0);
    const grossMarkPnl = markPrice == null
      ? null
      : row.outcome === 'LONG'
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

  const closedSummaryRes = await query(`
    SELECT trade_type AS "tradeType",
           COUNT(*)::int AS "closedTrades",
           COALESCE(SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END), 0)::int AS wins,
           COALESCE(SUM(pnl), 0)::float8 AS "totalPnl",
           COALESCE(AVG(pnl), 0)::float8 AS "avgPnl"
    FROM trades
    WHERE status = 'closed' AND trade_type = ANY($1::text[])
    GROUP BY trade_type
    ORDER BY trade_type
  `, [FUTURES_TRADE_TYPES]);
  const closedSummary = closedSummaryRes.rows.map((row) => ({
    tradeType: row.tradeType,
    closedTrades: Number(row.closedTrades ?? 0),
    wins: Number(row.wins ?? 0),
    winRate: Number(row.closedTrades ?? 0) > 0 ? Number(row.wins ?? 0) / Number(row.closedTrades) : null,
    totalPnl: round2(Number(row.totalPnl ?? 0)) ?? 0,
    avgPnl: round2(Number(row.avgPnl ?? 0)) ?? 0,
  }));
  const realizedPnl = closedSummary.reduce((sum, row) => sum + (row.totalPnl ?? 0), 0);
  const reservedMargin = openPositions.reduce((sum, row) => sum + (row.capitalUsed ?? 0), 0);
  const unrealizedPnl = openPositions.reduce((sum, row) => sum + (row.grossMarkPnlApproxUsd ?? 0), 0);
  const equity = FUTURES_START_CAPITAL + realizedPnl + unrealizedPnl;
  const available = equity - reservedMargin;

  const equityCurveRes = await query(`
    SELECT id, asset_pair, pnl, closed_at
    FROM trades
    WHERE status = 'closed' AND closed_at IS NOT NULL AND trade_type = ANY($1::text[])
    ORDER BY closed_at ASC
  `, [FUTURES_TRADE_TYPES]);
  let cumulative = 0;
  const equityCurve = equityCurveRes.rows.slice(-40).map((row) => {
    cumulative += Number(row.pnl ?? 0);
    return {
      ts: row.closed_at,
      tradeId: row.id,
      pair: row.asset_pair,
      pnl: round2(Number(row.pnl ?? 0)) ?? 0,
      equity: round2(cumulative) ?? 0,
    };
  });

  const lifecycleRes = await query(`
    SELECT id, trade_type, asset_pair, outcome, status, pnl, reason, exit_reason, opened_at, closed_at
    FROM trades
    WHERE trade_type = ANY($1::text[])
    ORDER BY COALESCE(closed_at, opened_at) DESC
    LIMIT 12
  `, [FUTURES_TRADE_TYPES]);
  const recentLifecycle = lifecycleRes.rows.map((row) => ({
    id: row.id,
    tradeType: row.trade_type,
    pair: row.asset_pair,
    side: row.outcome,
    event: row.status === 'closed' ? 'closed' : 'opened',
    eventAt: row.closed_at ?? row.opened_at,
    pnl: row.pnl == null ? null : round2(Number(row.pnl)),
    reason: row.status === 'closed' ? (row.exit_reason ?? row.reason) : row.reason,
    status: row.status,
  }));

  const todayRes = await query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'closed' AND closed_at >= CURRENT_DATE)::int AS closed_trades,
      COALESCE(SUM(CASE WHEN status = 'closed' AND closed_at >= CURRENT_DATE AND pnl > 0 THEN 1 ELSE 0 END), 0)::int AS wins,
      COALESCE(SUM(CASE WHEN status = 'closed' AND closed_at >= CURRENT_DATE AND pnl < 0 THEN 1 ELSE 0 END), 0)::int AS losses,
      COALESCE(SUM(CASE WHEN status = 'closed' AND closed_at >= CURRENT_DATE THEN pnl ELSE 0 END), 0)::float8 AS total_pnl,
      COALESCE(AVG(CASE WHEN status = 'closed' AND closed_at >= CURRENT_DATE THEN pnl END), 0)::float8 AS avg_pnl,
      COUNT(*) FILTER (WHERE status = 'open')::int AS open_count
    FROM trades
    WHERE trade_type = ANY($1::text[])
  `, [FUTURES_TRADE_TYPES]);
  const today = todayRes.rows[0] ?? {};

  const recentEntriesRes = await query(`
    SELECT id, trade_type, agent_id, asset_pair, outcome, entry_price, capital_used, leverage, opened_at, reason
    FROM trades
    WHERE trade_type = ANY($1::text[])
    ORDER BY opened_at DESC
    LIMIT 20
  `, [FUTURES_TRADE_TYPES]);

  const profileStatsRes = await query(`
    SELECT trade_type,
           COUNT(*) FILTER (WHERE status = 'closed')::int AS closed_trades,
           COALESCE(SUM(CASE WHEN status = 'closed' AND pnl > 0 THEN 1 ELSE 0 END), 0)::int AS wins,
           COALESCE(SUM(CASE WHEN status = 'closed' AND pnl < 0 THEN 1 ELSE 0 END), 0)::int AS losses,
           COALESCE(SUM(CASE WHEN status = 'closed' THEN pnl ELSE 0 END), 0)::float8 AS total_pnl,
           COALESCE(AVG(CASE WHEN status = 'closed' THEN pnl END), 0)::float8 AS expectancy
    FROM trades
    WHERE trade_type = ANY($1::text[])
    GROUP BY trade_type
  `, [FUTURES_TRADE_TYPES]);
  const pairStatsRes = await query(`
    SELECT trade_type, asset_pair,
           COUNT(*) FILTER (WHERE status = 'closed')::int AS closed_trades,
           COALESCE(SUM(CASE WHEN status = 'closed' AND pnl > 0 THEN 1 ELSE 0 END), 0)::int AS wins,
           COALESCE(SUM(CASE WHEN status = 'closed' AND pnl < 0 THEN 1 ELSE 0 END), 0)::int AS losses,
           COALESCE(SUM(CASE WHEN status = 'closed' THEN pnl ELSE 0 END), 0)::float8 AS total_pnl,
           COALESCE(AVG(CASE WHEN status = 'closed' THEN pnl END), 0)::float8 AS avg_pnl,
           MIN(opened_at) AS first_opened_at,
           MAX(closed_at) AS last_closed_at
    FROM trades
    WHERE trade_type = ANY($1::text[])
    GROUP BY trade_type, asset_pair
  `, [FUTURES_TRADE_TYPES]);
  const pairsByType = new Map();
  for (const row of pairStatsRes.rows) {
    const key = row.trade_type;
    const list = pairsByType.get(key) ?? [];
    list.push({
      pair: row.asset_pair,
      closedTrades: Number(row.closed_trades ?? 0),
      wins: Number(row.wins ?? 0),
      losses: Number(row.losses ?? 0),
      winRate: Number(row.closed_trades ?? 0) > 0 ? Number(row.wins ?? 0) / Number(row.closed_trades) : null,
      totalPnl: round2(Number(row.total_pnl ?? 0)) ?? 0,
      avgPnl: round2(Number(row.avg_pnl ?? 0)) ?? 0,
      profitFactor: null,
      firstOpenedAt: row.first_opened_at,
      lastClosedAt: row.last_closed_at,
    });
    pairsByType.set(key, list);
  }
  const profileScoreboard = profileStatsRes.rows.map((row) => ({
    tradeType: row.trade_type,
    closedTrades: Number(row.closed_trades ?? 0),
    wins: Number(row.wins ?? 0),
    losses: Number(row.losses ?? 0),
    winRate: Number(row.closed_trades ?? 0) > 0 ? Number(row.wins ?? 0) / Number(row.closed_trades) : null,
    totalPnl: round2(Number(row.total_pnl ?? 0)) ?? 0,
    expectancy: round2(Number(row.expectancy ?? 0)),
    profitFactor: null,
    maxDrawdown: null,
    rankScore: round2(Number(row.total_pnl ?? 0)),
    mode: 'learning',
    capitalMultiplier: 1,
    leverageMultiplier: 1,
    pairs: pairsByType.get(row.trade_type) ?? [],
  }));

  return {
    ok: true,
    mode: 'status',
    generatedAt: new Date().toISOString(),
    warnings: [{
      section: 'fallback',
      error: 'Render backend unavailable; serving replicated Supabase snapshot from Vercel.',
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
      openCount: Number(today.open_count ?? 0),
      closedTrades: Number(today.closed_trades ?? 0),
      wins: Number(today.wins ?? 0),
      losses: Number(today.losses ?? 0),
      winRate: Number(today.closed_trades ?? 0) > 0 ? Number(today.wins ?? 0) / Number(today.closed_trades) : null,
      totalPnl: round2(Number(today.total_pnl ?? 0)) ?? 0,
      avgPnl: round2(Number(today.avg_pnl ?? 0)) ?? 0,
    },
    cycleHistory: [],
    profileScoreboard,
    learningCohorts: {
      strongest: [],
      weakest: [],
    },
    supervisor: await getSupervisorLatestFallback(),
    recentEntries: recentEntriesRes.rows.map((row) => ({
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
    })),
  };
}

export async function getDiagnosticsFallback() {
  const countsRes = await query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'open')::int AS open,
      COUNT(*) FILTER (WHERE status = 'closed')::int AS closed,
      COALESCE(SUM(CASE WHEN status = 'closed' AND pnl > 0 THEN 1 ELSE 0 END), 0)::int AS wins,
      COALESCE(SUM(CASE WHEN status = 'closed' THEN pnl ELSE 0 END), 0)::float8 AS total_pnl
    FROM trades
    WHERE trade_type = ANY($1::text[])
  `, [ALL_CRYPTO_TYPES]);
  const counts = countsRes.rows[0] ?? {};
  const closed = Number(counts.closed ?? 0);
  const wins = Number(counts.wins ?? 0);
  const recentScansRes = await query(`
    SELECT ts, reason, subsystem
    FROM operator_events
    WHERE category = 'SCAN'
    ORDER BY ts DESC
    LIMIT 12
  `);

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
      total: Number(counts.total ?? 0),
      open: Number(counts.open ?? 0),
      closed,
      wins,
      winRate: closed > 0 ? wins / closed : null,
      totalPnl: round2(Number(counts.total_pnl ?? 0)) ?? 0,
      bestEngine: null,
      trainingDay: 1,
      confidenceAccuracy: null,
    },
    mode: 'fallback_snapshot',
    recentScans: recentScansRes.rows.map((row) => ({
      ts: row.ts,
      reason: row.reason,
      subsystem: row.subsystem,
    })),
    scanSnapshot: { at: null, assets: [] },
    regimePerformance: [],
    autopsy: null,
    llm: {
      provider: 'fallback',
      usedByLiveScalp: false,
      usedByLegacyCryptoLoop: false,
      configured: false,
      available: null,
      fallbackActive: true,
      verification: 'verified',
      lastProviderError: null,
      checkedAt: new Date().toISOString(),
      lastModel: null,
      note: 'Vercel fallback snapshot from Supabase while Render is unavailable.',
    },
  };
}

export async function getMarketIntelligenceFallback() {
  const tradesRes = await query(`
    SELECT pnl, outcome, closed_at
    FROM trades
    WHERE trade_type = ANY($1::text[]) AND status = 'closed'
    ORDER BY closed_at DESC
    LIMIT 30
  `, [ALL_CRYPTO_TYPES]);
  const recent = tradesRes.rows;
  const wins = recent.filter((row) => Number(row.pnl ?? 0) > 0).length;
  const losses = recent.filter((row) => Number(row.pnl ?? 0) < 0).length;
  const recentWinRate = recent.length > 0 ? wins / recent.length : null;

  const btc = await getCurrentPrice('BTCUSDT');
  const now = btc ?? 0;
  const old = await (async () => {
    try {
      const res = await fetch(`${BINANCE_BASE}/klines?symbol=BTCUSDT&interval=1h&limit=2`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const json = await res.json();
      return json?.[0] ? Number.parseFloat(json[0][1]) : null;
    } catch {
      return null;
    }
  })();
  const change = now && old ? ((now - old) / old) * 100 : 0;

  return {
    momentum: change > 0.35 ? 'Bullish' : change < -0.35 ? 'Bearish' : 'Neutral',
    volatility: 'Medium',
    trend: recentWinRate == null ? 'Unknown' : recentWinRate >= 0.55 ? 'Strong' : recentWinRate >= 0.4 ? 'Mixed' : 'Weak',
    regime: 'Scalp',
    recommendation: recentWinRate == null ? 'WAIT' : recentWinRate >= 0.55 ? 'WATCH' : 'WAIT',
    confidence: { score: recentWinRate == null ? 0 : Math.max(0, Math.min(1, recentWinRate)), band: 'fallback' },
    risk: { band: recentWinRate != null && recentWinRate < 0.4 ? 'ELEVATED' : 'HEALTHY', score: 0.5, safeMode: false },
    activity: {
      signalsLast3h: 0,
      longs: recent.filter((row) => row.outcome === 'LONG').length,
      shorts: recent.filter((row) => row.outcome === 'SHORT').length,
      recentWinRate,
    },
  };
}

export async function getHealthFallback() {
  const futures = await getFuturesDeskFallback();
  const runner = await getHostedRunnerHeartbeatFallback();
  const openTrades = futures.openPositions.length;
  return {
    ok: true,
    service: 'genesis-hq-lab-fallback',
    now: new Date().toISOString(),
    futuresMode: true,
    futuresCapital: futures.futuresCapital,
    agent: {
      capital: futures.futuresCapital.equity ?? FUTURES_START_CAPITAL,
      isPaused: false,
      openTrades,
      lastTickAt: runner.lastTickAt,
      agentAlive: runner.agentAlive,
      totalCycles: runner.totalCycles,
      claudeEnabled: runner.claudeEnabled,
    },
  };
}

export async function getSystemHealthFallback() {
  const futures = await getFuturesDeskFallback();
  const health = await getHealthFallback();
  const runner = await getHostedRunnerHeartbeatFallback();
  const totalTradesRes = await query(`SELECT COUNT(*)::int AS total FROM trades`);
  const lessonsRes = await query(`SELECT COUNT(*)::int AS total FROM lessons`);
  return {
    ok: true,
    timestamp: new Date().toISOString(),
    probeMs: 0,
    websocket: { connectedClients: 0, active: false },
    database: { ok: true, totalTrades: Number(totalTradesRes.rows[0]?.total ?? 0), tables: 5 },
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
      openTrades: health.agent.openTrades,
      lastTickAt: runner.lastTickAt,
      agentAlive: runner.agentAlive,
      msSinceLastTick: runner.msSinceLastTick,
      totalCycles: runner.totalCycles,
      claudeEnabled: runner.claudeEnabled,
      neverStarted: runner.neverStarted,
    },
    kalshi: { ok: false, hasApiKey: false, wsConnected: false, mode: 'fallback' },
    optimizer: { ok: false, mode: 'fallback' },
    learning: {
      ok: true,
      lessons: Number(lessonsRes.rows[0]?.total ?? 0),
      activeVetoes: 0,
      agentsTracked: 0,
      lastConsensusDecision: null,
      lastConsensusAt: null,
      outcomeEngine: null,
    },
    founderMode: {
      ok: true,
      mode: 'fallback_snapshot',
      focus: 'supabase contingency',
      goal: 'keep read-only visibility alive while Render is down',
      deptMarkets: 'standby',
      deptCrypto: 'monitoring',
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
      totalTrades: futures.closedSummary.reduce((sum, row) => sum + row.closedTrades, 0),
      stalePositionCount: 0,
      unrealizedDegraded: false,
      pnlFresh: true,
      unrealizedPnl: futures.futuresCapital.unrealizedPnl,
      drawdownProtection: null,
      startupReconciliation: null,
      confidenceEngine: null,
      globalRisk: {
        score: 0.5,
        band: 'WATCH',
        safeMode: false,
        activeFlags: ['render_unavailable'],
        dimensions: {},
        lastRefreshAt: new Date().toISOString(),
      },
    },
    issues: [{
      severity: 'warn',
      system: 'backend',
      message: 'Render unavailable. Serving replicated Supabase snapshot from Vercel.',
    }],
  };
}
