import db from '../db/database.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFuturesBreakoutCycle, futuresBreakoutEngineConfig, getLastFuturesBreakoutCycle } from '../strategies/futuresBreakoutEngine.mjs';
import { syncFuturesGovernorJournal } from './futuresGovernor.mjs';
import { getCurrentPrice } from './priceFeeder.mjs';
import { getTreasuryAsync } from '../trading/treasury.mjs';

const FUTURES_TYPES = ['crypto_futures_breakout_short_micro', 'crypto_futures_breakout_short', 'crypto_futures_breakout_short_alt', 'crypto_futures_breakout_long'];
const __dir = dirname(fileURLToPath(import.meta.url));
const FUTURES_CYCLE_PATH = join(__dir, '..', '..', 'data', 'futures-last-cycle.json');
const FUTURES_BASELINE_KEY = 'futures_pnl_baseline';

function round2(value) {
  return value == null ? null : Math.round(value * 100) / 100;
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

function buildClosedAtClause(baseline) {
  return baseline?.baselineAt ? ` AND closed_at >= '${baseline.baselineAt}'` : '';
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

export async function getFuturesDeskSnapshot({ runCycle = false } = {}) {
  const startedAt = new Date().toISOString();
  const config = futuresBreakoutEngineConfig();
  const cycle = runCycle
    ? await runFuturesBreakoutCycle()
    : getLastFuturesBreakoutCycle() ?? readPersistedCycle();
  if (runCycle && cycle) persistCycle(cycle);
  const governorJournal = cycle?.governorJournal ?? syncFuturesGovernorJournal(config.governor);
  const baseline = readBaseline();
  const treasury = await getTreasuryAsync();
  const openPositions = await buildOpenPositions();
  const closedSummary = buildClosedSummary(baseline);
  const equityCurve = buildEquityCurve(baseline);
  const recentLifecycle = buildRecentLifecycle(baseline);

  return {
    mode: runCycle ? 'run' : 'status',
    generatedAt: new Date().toISOString(),
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
    openPositions,
    closedSummary,
    equityCurve,
    recentLifecycle,
    recentEntries: runCycle ? buildRecentEntries(startedAt) : [],
  };
}
