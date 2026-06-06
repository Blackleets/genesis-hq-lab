// truthLayer.mjs — canonical runtime state for Genesis HQ.
//
// Single source of truth aggregation layer.
// Called by /api/system/health to produce a complete system snapshot.
//
// Does NOT replace existing API endpoints.
// Aggregates their outputs into one structured response
// so frontend and monitoring can see the full picture at a glance.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import db from './db/database.mjs';
import { getTreasury } from './trading/treasury.mjs';
import { getOpenTrades } from './memory/tradingMemory.mjs';
import { getOrgState } from './command/orgState.mjs';
import { getKalshiStatus } from './kalshi/adapter.mjs';
import { getOptimizerHeartbeat } from './crypto/cryptoAnalytics.mjs';
import { getAgentPerformance } from './memory/decisionAccuracyEngine.mjs';
import { getRecentConsensus } from './memory/consensusEngine.mjs';
import { detectStalePositions, getPnLFreshness, getRealizedPnl } from './memory/pnlEngine.mjs';

// ── Structured logger for desync events ──────────────────────────────────────

const _log = {
  warn(tag, msg, data = {}) {
    console.warn(`[truth:${tag}] ${msg}`, Object.keys(data).length ? data : '');
  },
  error(tag, msg, err) {
    console.error(`[truth:${tag}] ${msg}:`, err?.message ?? err);
  },
};

// ── Individual health probes ──────────────────────────────────────────────────

function probeDatabase() {
  try {
    const count = db.prepare(`SELECT COUNT(*) AS n FROM trades`).get()?.n ?? 0;
    const tableCount = db.prepare(
      `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'`
    ).get()?.n ?? 0;
    return { ok: true, tables: tableCount, totalTrades: count };
  } catch (err) {
    _log.error('db', 'SQLite probe failed', err);
    return { ok: false, error: err.message };
  }
}

function probeTreasury() {
  try {
    const treasury = getTreasury();
    return {
      ok: true,
      total: treasury.total,
      available: treasury.available,
      inTrades: treasury.inTrades ?? 0,
      isPaused: treasury.isPaused ?? false,
      drawdownPct: treasury.drawdownPct ?? 0,
    };
  } catch (err) {
    _log.error('treasury', 'Treasury probe failed', err);
    return { ok: false, error: err.message };
  }
}

function probeAgentRunner() {
  try {
    const openTrades = getOpenTrades().length;

    // Read heartbeat written by agentRunner on each cycle
    let heartbeat = null;
    try {
      const hbPath = join(process.cwd(), 'data', 'memory', 'agent_heartbeat.json');
      if (existsSync(hbPath)) {
        heartbeat = JSON.parse(readFileSync(hbPath, 'utf8'));
      }
    } catch { /* heartbeat not written yet */ }

    const lastTickAt = heartbeat?.lastTickAt ?? null;
    const msSinceLastTick = lastTickAt
      ? Date.now() - new Date(lastTickAt).getTime()
      : null;
    const agentAlive = msSinceLastTick !== null && msSinceLastTick < 10 * 60_000;

    if (lastTickAt && !agentAlive) {
      _log.warn('agent', 'Agent runner appears stalled', {
        lastTickAt,
        msSinceLastTick,
      });
    }

    return {
      ok: agentAlive || lastTickAt === null,  // null = first boot, not stalled
      openTrades,
      lastTickAt,
      agentAlive,
      msSinceLastTick,
      totalCycles: heartbeat?.totalCycles ?? 0,
      claudeEnabled: heartbeat?.claudeEnabled ?? false,
      neverStarted: lastTickAt === null,
    };
  } catch (err) {
    _log.error('agent', 'Agent runner probe failed', err);
    return { ok: false, error: err.message };
  }
}

function probeKalshi() {
  try {
    const status = getKalshiStatus();
    return {
      ok: true,
      hasApiKey: status.hasApiKey ?? false,
      wsConnected: status.wsConnected ?? false,
      mode: status.mode ?? 'unknown',
    };
  } catch (err) {
    _log.error('kalshi', 'Kalshi probe failed', err);
    return { ok: false, error: err.message };
  }
}

function probeOptimizer() {
  try {
    const hb = getOptimizerHeartbeat();
    return { ok: true, ...hb };
  } catch (err) {
    _log.error('optimizer', 'Optimizer probe failed', err);
    return { ok: false, error: err.message };
  }
}

function probeLearning() {
  try {
    const lessonCount = db.prepare(`SELECT COUNT(*) AS n FROM lessons`).get()?.n ?? 0;
    const vetoCount   = db.prepare(`SELECT COUNT(*) AS n FROM mistake_patterns WHERE active = 1`).get()?.n ?? 0;
    const performance = getAgentPerformance();
    const lastConsensus = getRecentConsensus(1)[0] ?? null;

    return {
      ok: true,
      lessons: lessonCount,
      activeVetoes: vetoCount,
      agentsTracked: performance.length,
      lastConsensusDecision: lastConsensus?.decision ?? null,
      lastConsensusAt: lastConsensus?.timestamp ?? null,
    };
  } catch (err) {
    _log.error('learning', 'Learning probe failed', err);
    return { ok: false, error: err.message };
  }
}

function probeFounderMode() {
  try {
    const state = getOrgState();
    return {
      ok: true,
      mode: state.mode ?? 'unknown',
      focus: state.focus ?? null,
      goal: state.goal ?? null,
      deptMarkets: state.deptMarkets ?? 'active',
      deptCrypto: state.deptCrypto ?? 'active',
    };
  } catch (err) {
    _log.error('founder', 'Founder mode probe failed', err);
    return { ok: false, error: err.message };
  }
}

// ── Execution diagnostics probe ───────────────────────────────────────────────

function probeExecution() {
  try {
    const stalePositions = detectStalePositions(48);
    const freshness = getPnLFreshness();
    const realized = getRealizedPnl();
    const treasury = getTreasury();

    // Flag if unrealized PnL is unavailable (open positions with no price)
    const unrealizedDegraded = treasury.pnlDegraded === true;

    if (stalePositions.length > 0) {
      for (const p of stalePositions) {
        _log.warn('stale_position', `Trade ${p.id} open for ${p.ageHours}h — may be orphaned`, { id: p.id, ageHours: p.ageHours });
      }
    }

    return {
      ok: true,
      realizedPnl: realized.totalPnl,
      winRate: realized.winRate,
      totalTrades: realized.total,
      stalePositionCount: stalePositions.length,
      stalePositions,
      pnlLastSettledAt: freshness.lastSettledAt,
      pnlFresh: freshness.fresh,
      unrealizedDegraded,
      unrealizedPnl: treasury.unrealizedPnl,
    };
  } catch (err) {
    _log.error('execution', 'Execution diagnostics probe failed', err);
    return { ok: false, error: err.message };
  }
}

// ── Stale data detection ──────────────────────────────────────────────────────

function detectStaleState(checks) {
  const issues = [];

  if (!checks.agentRunner.agentAlive && !checks.agentRunner.neverStarted) {
    issues.push({
      severity: 'warn',
      system: 'agent_runner',
      message: 'Agent runner has not ticked in >10 minutes',
      data: { lastTickAt: checks.agentRunner.lastTickAt },
    });
  }

  if (!checks.kalshi.hasApiKey) {
    issues.push({
      severity: 'info',
      system: 'kalshi',
      message: 'Kalshi API key not set — Kalshi markets unavailable',
    });
  }

  if (checks.treasury.isPaused) {
    issues.push({
      severity: 'info',
      system: 'treasury',
      message: 'Trading is paused',
    });
  }

  if (checks.database.ok && checks.database.totalTrades === 0) {
    issues.push({
      severity: 'info',
      system: 'database',
      message: 'No trades in database — system never executed a trade',
    });
  }

  if (checks.executionDiagnostics?.stalePositionCount > 0) {
    issues.push({
      severity: 'warn',
      system: 'execution',
      message: `${checks.executionDiagnostics.stalePositionCount} position(s) open >48h without resolution — possible orphans`,
    });
  }

  if (checks.executionDiagnostics?.unrealizedDegraded && checks.agentRunner.openTrades > 0) {
    issues.push({
      severity: 'info',
      system: 'execution',
      message: 'Unrealized PnL unavailable — open positions exist but live prices not cached',
    });
  }

  if (checks.executionDiagnostics?.pnlFresh === false) {
    issues.push({
      severity: 'info',
      system: 'execution',
      message: 'No trade settled in >24h — PnL data may be stale',
    });
  }

  // Log issues to server console
  for (const issue of issues) {
    if (issue.severity === 'warn') {
      _log.warn('stale', issue.message, issue.data ?? {});
    }
  }

  return issues;
}

// ── Main export: full system truth snapshot ───────────────────────────────────

/**
 * Gather canonical runtime state from all subsystems.
 * wsClientCount — pass in from the HTTP server (cannot import wsClients here).
 *
 * Returns a structured object safe to serialize as JSON.
 */
export function getSystemTruth(wsClientCount = 0) {
  const startMs = Date.now();

  const checks = {
    database:             probeDatabase(),
    treasury:             probeTreasury(),
    agentRunner:          probeAgentRunner(),
    kalshi:               probeKalshi(),
    optimizer:            probeOptimizer(),
    learning:             probeLearning(),
    founderMode:          probeFounderMode(),
    executionDiagnostics: probeExecution(),
  };

  const issues = detectStaleState(checks);

  const overallOk =
    checks.database.ok &&
    checks.treasury.ok;  // only hard-fail on DB or treasury

  return {
    ok: overallOk,
    timestamp: new Date().toISOString(),
    probeMs: Date.now() - startMs,
    websocket: {
      connectedClients: wsClientCount,
      active: wsClientCount > 0,
    },
    ...checks,
    issues,
    // ── Canonical execution state ─────────────────────────────────────────
    execution: {
      capital: checks.treasury.total ?? 0,
      available: checks.treasury.available ?? 0,
      openTrades: checks.agentRunner.openTrades ?? 0,
      isPaused: checks.treasury.isPaused ?? false,
      drawdownPct: checks.treasury.drawdownPct ?? 0,
      agentAlive: checks.agentRunner.agentAlive ?? false,
      lastTickAt: checks.agentRunner.lastTickAt ?? null,
      // PnL diagnostics
      realizedPnl: checks.executionDiagnostics?.realizedPnl ?? null,
      winRate: checks.executionDiagnostics?.winRate ?? null,
      totalTrades: checks.executionDiagnostics?.totalTrades ?? 0,
      stalePositionCount: checks.executionDiagnostics?.stalePositionCount ?? 0,
      unrealizedDegraded: checks.executionDiagnostics?.unrealizedDegraded ?? false,
      pnlFresh: checks.executionDiagnostics?.pnlFresh ?? null,
      unrealizedPnl: checks.executionDiagnostics?.unrealizedPnl ?? null,
    },
    // ── Canonical learning state ──────────────────────────────────────────
    learning: {
      lessons: checks.learning.lessons ?? 0,
      activeVetoes: checks.learning.activeVetoes ?? 0,
      agentsTracked: checks.learning.agentsTracked ?? 0,
      lastConsensusDecision: checks.learning.lastConsensusDecision ?? null,
    },
  };
}

// ── Structured log helpers (exported for use in other server modules) ─────────

export const truthLog = {
  desync(system, message, data = {}) {
    console.warn(`[truth:desync:${system}] ${message}`, data);
  },
  stale(system, message, data = {}) {
    console.warn(`[truth:stale:${system}] ${message}`, data);
  },
  missing(system, message) {
    console.error(`[truth:missing:${system}] ${message}`);
  },
  syncFailed(system, message, err) {
    console.error(`[truth:sync_failed:${system}] ${message}:`, err?.message ?? err);
  },
};
