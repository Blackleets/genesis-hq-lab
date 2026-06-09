import db from '../db/database.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFuturesBreakoutCycle, futuresBreakoutEngineConfig, getLastFuturesBreakoutCycle } from '../strategies/futuresBreakoutEngine.mjs';
import { getFuturesGovernorSnapshot, syncFuturesGovernorJournal } from './futuresGovernor.mjs';
import { getCurrentPrice } from './priceFeeder.mjs';
import { getTreasuryAsync } from '../trading/treasury.mjs';

const FUTURES_TYPES = ['crypto_futures_breakout_short_micro', 'crypto_futures_breakout_short', 'crypto_futures_breakout_short_alt', 'crypto_futures_breakout_long'];
const __dir = dirname(fileURLToPath(import.meta.url));
const FUTURES_CYCLE_PATH = join(__dir, '..', '..', 'data', 'futures-last-cycle.json');
const FUTURES_BASELINE_KEY = 'futures_pnl_baseline';
const FUTURES_CYCLE_HISTORY_KEY = 'futures_cycle_history';
const FUTURES_DESK_START_CAPITAL = parseFloat(process.env.FUTURES_DESK_START_CAPITAL ?? '10000');

function round2(value) {
  return value == null ? null : Math.round(value * 100) / 100;
}

function captureSection(warnings, label, fallback, fn) {
  try {
    return fn();
  } catch (error) {
    warnings.push({
      section: label,
      error: error?.message ?? String(error),
      at: new Date().toISOString(),
    });
    return fallback;
  }
}

async function captureSectionAsync(warnings, label, fallback, fn) {
  try {
    return await fn();
  } catch (error) {
    warnings.push({
      section: label,
      error: error?.message ?? String(error),
      at: new Date().toISOString(),
    });
    return fallback;
  }
}

function listToSql(list) {
  return `('${list.join("','")}')`;
}

function readPersistedCycle() {
  try {
    return JSON.parse(readFileSync(FUTURES_CYCLE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function persistCycle(cycle) {
  try {
    mkdirSync(dirname(FUTURES_CYCLE_PATH), { recursive: true });
    writeFileSync(FUTURES_CYCLE_PATH, JSON.stringify(cycle, null, 2), 'utf8');
  } catch {
    // Non-fatal: the live cycle still returns to caller even if persistence fails.
  }
}

function readBaseline() {
  try {
    const row = db.prepare(`SELECT value FROM org_state WHERE key = ?`).get(FUTURES_BASELINE_KEY);
    return row?.value ? JSON.parse(row.value) : null;
  } catch {
    return null;
  }
}

export function resetFuturesPnlBaseline({ resetBy = 'operator', note = 'Futures PnL reporting baseline reset' } = {}) {
  const baseline = {
    baselineAt: new Date().toISOString(),
    resetBy,
    note,
  };

  db.prepare(`
    INSERT OR REPLACE INTO org_state (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
  `).run(FUTURES_BASELINE_KEY, JSON.stringify(baseline));

  return baseline;
}

function buildClosedAtClause(baseline) {
  return baseline?.baselineAt ? ` AND closed_at >= '${baseline.baselineAt}'` : '';
}

function readCycleHistory(limit = 12) {
  try {
    const row = db.prepare(`SELECT value FROM org_state WHERE key = ?`).get(FUTURES_CYCLE_HISTORY_KEY);
    if (!row?.value) return [];
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed.slice(-limit).reverse() : [];
  } catch {
    return [];
  }
}

async function buildOpenPositions() {
  const rows = db.prepare(`
    SELECT id, trade_type, agent_id, asset_pair, outcome, entry_price, shares, capital_used,
           notional_usd, leverage, target_price, stop_price, liquidation_price, opened_at
    FROM trades
    WHERE status = 'open' AND trade_type IN ${listToSql(FUTURES_TYPES)}
    ORDER BY opened_at DESC
  `).all();

  return Promise.all(rows.map(async (row) => {
    const markPrice = await getCurrentPrice(row.asset_pair);
    const grossMarkPnl = markPrice == null
      ? null
      : row.outcome === 'LONG'
        ? (markPrice - row.entry_price) * row.shares
        : (row.entry_price - markPrice) * row.shares;

    return {
      id: row.id,
      tradeType: row.trade_type,
      agentId: row.agent_id,
      pair: row.asset_pair,
      side: row.outcome,
      openedAt: row.opened_at,
      entryPrice: round2(row.entry_price),
      markPrice: round2(markPrice),
      grossMarkPnlApproxUsd: round2(grossMarkPnl),
      capitalUsed: round2(row.capital_used),
      notionalUsd: round2(row.notional_usd),
      leverage: row.leverage,
      targetPrice: round2(row.target_price),
      stopPrice: round2(row.stop_price),
      liquidationPrice: round2(row.liquidation_price),
    };
  }));
}

function buildFuturesCapital(openPositions, closedSummary) {
  const reservedMargin = round2(openPositions.reduce((sum, row) => sum + (row.capitalUsed ?? 0), 0)) ?? 0;
  const unrealizedPnl = round2(openPositions.reduce((sum, row) => sum + (row.grossMarkPnlApproxUsd ?? 0), 0)) ?? 0;
  const realizedPnl = round2(closedSummary.reduce((sum, row) => sum + (row.totalPnl ?? 0), 0)) ?? 0;
  const netPnl = round2(realizedPnl + unrealizedPnl) ?? 0;
  const equity = round2(FUTURES_DESK_START_CAPITAL + netPnl) ?? FUTURES_DESK_START_CAPITAL;
  const available = round2(equity - reservedMargin) ?? 0;
  return {
    startCapital: round2(FUTURES_DESK_START_CAPITAL),
    reservedMargin,
    realizedPnl,
    unrealizedPnl,
    netPnl,
    equity,
    available,
    openPositions: openPositions.length,
  };
}

function buildClosedSummary(baseline) {
  return db.prepare(`
    SELECT trade_type AS tradeType,
           COUNT(*) AS closedTrades,
           SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) AS wins,
           COALESCE(SUM(pnl), 0) AS totalPnl,
           COALESCE(AVG(pnl), 0) AS avgPnl
    FROM trades
    WHERE status = 'closed' AND trade_type IN ${listToSql(FUTURES_TYPES)}${buildClosedAtClause(baseline)}
    GROUP BY trade_type
    ORDER BY trade_type
  `).all().map((row) => ({
    tradeType: row.tradeType,
    closedTrades: row.closedTrades,
    wins: row.wins,
    winRate: row.closedTrades > 0 ? round2(row.wins / row.closedTrades) : null,
    totalPnl: round2(row.totalPnl),
    avgPnl: round2(row.avgPnl),
  }));
}

function buildRecentEntries(sinceIso) {
  return db.prepare(`
    SELECT id, trade_type, agent_id, asset_pair, outcome, entry_price, capital_used, leverage, opened_at, reason
    FROM trades
    WHERE trade_type IN ${listToSql(FUTURES_TYPES)} AND opened_at >= ?
    ORDER BY opened_at DESC
    LIMIT 20
  `).all(sinceIso).map((row) => ({
    id: row.id,
    tradeType: row.trade_type,
    agentId: row.agent_id,
    pair: row.asset_pair,
    side: row.outcome,
    entryPrice: round2(row.entry_price),
    capitalUsed: round2(row.capital_used),
    leverage: row.leverage,
    openedAt: row.opened_at,
    reason: row.reason,
  }));
}

function buildEquityCurve(baseline, limit = 40) {
  const rows = db.prepare(`
    SELECT id, asset_pair, pnl, closed_at
    FROM trades
    WHERE status = 'closed'
      AND closed_at IS NOT NULL
      AND trade_type IN ${listToSql(FUTURES_TYPES)}${buildClosedAtClause(baseline)}
    ORDER BY closed_at ASC
  `).all();

  let cumulative = 0;
  const curve = rows.map((row) => {
    cumulative += row.pnl ?? 0;
    return {
      ts: row.closed_at,
      tradeId: row.id,
      pair: row.asset_pair,
      pnl: round2(row.pnl ?? 0),
      equity: round2(cumulative),
    };
  });

  return curve.slice(-limit);
}

function buildRecentLifecycle(baseline, limit = 12) {
  return db.prepare(`
    SELECT id, trade_type, asset_pair, outcome, status, pnl, reason, exit_reason, opened_at, closed_at
    FROM trades
    WHERE trade_type IN ${listToSql(FUTURES_TYPES)}
      ${baseline?.baselineAt ? `AND COALESCE(closed_at, opened_at) >= '${baseline.baselineAt}'` : ''}
    ORDER BY COALESCE(closed_at, opened_at) DESC
    LIMIT ?
  `).all(limit).map((row) => ({
    id: row.id,
    tradeType: row.trade_type,
    pair: row.asset_pair,
    side: row.outcome,
    event: row.status === 'closed' ? 'closed' : 'opened',
    eventAt: row.closed_at ?? row.opened_at,
    pnl: row.pnl == null ? null : round2(row.pnl),
    reason: row.status === 'closed' ? (row.exit_reason ?? row.reason) : row.reason,
    status: row.status,
  }));
}

function buildTodaySummary(baseline) {
  const where = baseline?.baselineAt
    ? `AND closed_at >= MAX(datetime('now', 'start of day'), '${baseline.baselineAt}')`
    : `AND closed_at >= datetime('now', 'start of day')`;

  const closed = db.prepare(`
    SELECT
      COUNT(*) AS closedTrades,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) AS wins,
      COALESCE(SUM(pnl), 0) AS totalPnl,
      COALESCE(AVG(pnl), 0) AS avgPnl
    FROM trades
    WHERE status = 'closed'
      AND trade_type IN ${listToSql(FUTURES_TYPES)}
      ${where}
  `).get();

  const opens = db.prepare(`
    SELECT COUNT(*) AS openCount
    FROM trades
    WHERE status = 'open'
      AND trade_type IN ${listToSql(FUTURES_TYPES)}
      AND opened_at >= datetime('now', 'start of day')
  `).get();

  const winRate = (closed?.closedTrades ?? 0) > 0
    ? round2((closed.wins ?? 0) / closed.closedTrades)
    : null;

  return {
    openCount: opens?.openCount ?? 0,
    closedTrades: closed?.closedTrades ?? 0,
    wins: closed?.wins ?? 0,
    losses: Math.max(0, (closed?.closedTrades ?? 0) - (closed?.wins ?? 0)),
    winRate,
    totalPnl: round2(closed?.totalPnl ?? 0),
    avgPnl: round2(closed?.avgPnl ?? 0),
  };
}

function buildProfileScoreboard(baseline) {
  const governor = getFuturesGovernorSnapshot();
  const governorByTradeType = new Map(governor.profiles.map((profile) => [profile.tradeType, profile]));
  const rows = db.prepare(`
    SELECT
      trade_type AS tradeType,
      asset_pair AS pair,
      COUNT(*) AS closedTrades,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) AS wins,
      COALESCE(SUM(pnl), 0) AS totalPnl,
      COALESCE(AVG(pnl), 0) AS avgPnl,
      COALESCE(SUM(CASE WHEN pnl > 0 THEN pnl ELSE 0 END), 0) AS grossProfit,
      COALESCE(ABS(SUM(CASE WHEN pnl < 0 THEN pnl ELSE 0 END)), 0) AS grossLoss,
      MIN(opened_at) AS firstOpenedAt,
      MAX(closed_at) AS lastClosedAt
    FROM trades
    WHERE status = 'closed'
      AND pnl IS NOT NULL
      AND trade_type IN ${listToSql(FUTURES_TYPES)}${buildClosedAtClause(baseline)}
    GROUP BY trade_type, asset_pair
    ORDER BY totalPnl DESC, closedTrades DESC
  `).all();

  const byProfile = new Map();
  for (const row of rows) {
    if (!byProfile.has(row.tradeType)) byProfile.set(row.tradeType, []);
    const profitFactor = (row.grossLoss ?? 0) > 0
      ? row.grossProfit / row.grossLoss
      : (row.grossProfit ?? 0) > 0 ? Infinity : null;
    byProfile.get(row.tradeType).push({
      pair: row.pair,
      closedTrades: row.closedTrades,
      wins: row.wins,
      losses: Math.max(0, row.closedTrades - row.wins),
      winRate: row.closedTrades > 0 ? round2(row.wins / row.closedTrades) : null,
      totalPnl: round2(row.totalPnl),
      avgPnl: round2(row.avgPnl),
      profitFactor: profitFactor == null || profitFactor === Infinity ? profitFactor : round2(profitFactor),
      firstOpenedAt: row.firstOpenedAt,
      lastClosedAt: row.lastClosedAt,
    });
  }

  return Array.from(byProfile.entries()).map(([tradeType, pairs]) => {
    const governorProfile = governorByTradeType.get(tradeType);
    const summary = pairs.reduce((acc, pair) => ({
      closedTrades: acc.closedTrades + pair.closedTrades,
      wins: acc.wins + pair.wins,
      losses: acc.losses + pair.losses,
      totalPnl: acc.totalPnl + (pair.totalPnl ?? 0),
    }), { closedTrades: 0, wins: 0, losses: 0, totalPnl: 0 });

    return {
      tradeType,
      closedTrades: summary.closedTrades,
      wins: summary.wins,
      losses: summary.losses,
      winRate: summary.closedTrades > 0 ? round2(summary.wins / summary.closedTrades) : null,
      totalPnl: round2(summary.totalPnl),
      expectancy: governorProfile?.expectancy ?? null,
      profitFactor: governorProfile?.profitFactor ?? null,
      maxDrawdown: governorProfile?.maxDrawdown ?? null,
      rankScore: governorProfile?.rankScore ?? null,
      mode: governorProfile?.mode ?? 'learning',
      capitalMultiplier: governorProfile?.capitalMultiplier ?? 1,
      leverageMultiplier: governorProfile?.leverageMultiplier ?? 1,
      pairs,
    };
  }).sort((a, b) => (b.totalPnl ?? 0) - (a.totalPnl ?? 0));
}

export async function getFuturesDeskSnapshot({ runCycle = false } = {}) {
  const startedAt = new Date().toISOString();
  const warnings = [];
  const config = captureSection(warnings, 'config', {
    breakoutPeriod: null,
    regimeSmaPeriod: null,
    tpPct: null,
    slPct: null,
    minExpectedNetUsd: null,
    minRewardRisk: null,
    timeoutHours: null,
    maxMargin: null,
    leverage: null,
    governor: { profiles: [], journal: [] },
    profiles: [],
  }, () => futuresBreakoutEngineConfig());
  const cycle = runCycle
    ? await captureSectionAsync(warnings, 'cycle.run', null, () => runFuturesBreakoutCycle())
    : captureSection(warnings, 'cycle.status', null, () => getLastFuturesBreakoutCycle() ?? readPersistedCycle());
  if (runCycle && cycle) persistCycle(cycle);
  const governorJournal = captureSection(
    warnings,
    'governorJournal',
    cycle?.governorJournal ?? [],
    () => cycle?.governorJournal ?? syncFuturesGovernorJournal(config.governor),
  );
  const baseline = captureSection(warnings, 'baseline', null, () => readBaseline());
  const treasury = await captureSectionAsync(warnings, 'treasury', {
    total: 10000,
    available: 10000,
    inTrades: 0,
    unrealizedPnl: 0,
    netWorth: 10000,
    drawdownPct: 0,
    isPaused: false,
  }, () => getTreasuryAsync());
  const openPositions = await captureSectionAsync(warnings, 'openPositions', [], () => buildOpenPositions());
  const closedSummary = captureSection(warnings, 'closedSummary', [], () => buildClosedSummary(baseline));
  const futuresCapital = captureSection(warnings, 'futuresCapital', {
    startCapital: round2(FUTURES_DESK_START_CAPITAL),
    reservedMargin: 0,
    realizedPnl: 0,
    unrealizedPnl: 0,
    netPnl: 0,
    equity: round2(FUTURES_DESK_START_CAPITAL),
    available: round2(FUTURES_DESK_START_CAPITAL),
    openPositions: 0,
  }, () => buildFuturesCapital(openPositions, closedSummary));
  const equityCurve = captureSection(warnings, 'equityCurve', [], () => buildEquityCurve(baseline));
  const recentLifecycle = captureSection(warnings, 'recentLifecycle', [], () => buildRecentLifecycle(baseline));
  const today = captureSection(warnings, 'today', {
    openCount: 0,
    closedTrades: 0,
    wins: 0,
    losses: 0,
    winRate: null,
    totalPnl: 0,
    avgPnl: 0,
  }, () => buildTodaySummary(baseline));
  const cycleHistory = captureSection(warnings, 'cycleHistory', [], () => readCycleHistory());
  const profileScoreboard = captureSection(warnings, 'profileScoreboard', [], () => buildProfileScoreboard(baseline));
  const recentEntries = runCycle
    ? captureSection(warnings, 'recentEntries', [], () => buildRecentEntries(startedAt))
    : [];

  return {
    mode: runCycle ? 'run' : 'status',
    generatedAt: new Date().toISOString(),
    warnings,
    config,
    cycle,
    governorJournal,
    baseline,
    treasury: {
      total: round2(treasury.total),
      available: round2(treasury.available),
      inTrades: round2(treasury.inTrades),
      unrealizedPnl: round2(treasury.unrealizedPnl),
      netWorth: round2(treasury.netWorth),
      drawdownPct: round2(treasury.drawdownPct),
      isPaused: treasury.isPaused,
    },
    futuresCapital,
    openPositions,
    closedSummary,
    equityCurve,
    recentLifecycle,
    today,
    cycleHistory,
    profileScoreboard,
    recentEntries,
  };
}
